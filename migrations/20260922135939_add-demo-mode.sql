-- Modo demo: cuentas descartables y aisladas para probar el sistema sin alta.
--
-- Con el registro público cerrado, la única forma de entrar sin credenciales es
-- el botón "Probar demo". La function `demo` crea un usuario real con el cliente
-- admin y le copia el corpus de demostración; a partir de ahí es un usuario
-- común, con sus propias filas y las mismas políticas RLS que cualquier otro.
--
-- El corpus vive en tablas plantilla (demo_files / demo_documents) sin dueño:
-- se embebe una sola vez y cada visitante recibe una copia. Generar embeddings
-- por visitante costaría dinero y daría exactamente los mismos vectores.

-- ------------------------------------------------------------- límites -----

-- Cupo diario de una cuenta demo. Más alto que el de un usuario normal porque
-- quien prueba el sistema no debería quedarse sin preguntas a mitad de camino.
CREATE OR REPLACE FUNCTION public.limit_demo_questions_per_day()
RETURNS INT LANGUAGE sql IMMUTABLE AS $$ SELECT 50 $$;

-- Techo de gasto del modo demo entero. Sin esto, el cupo por cuenta no acota
-- nada: cualquiera puede pedir cuentas nuevas y multiplicar el consumo.
CREATE OR REPLACE FUNCTION public.limit_demo_questions_per_day_global()
RETURNS INT LANGUAGE sql IMMUTABLE AS $$ SELECT 300 $$;

-- Freno al ritmo de creación de cuentas, para que un script no llene la base.
CREATE OR REPLACE FUNCTION public.limit_demo_sessions_per_hour()
RETURNS INT LANGUAGE sql IMMUTABLE AS $$ SELECT 20 $$;

-- Cuánto vive una cuenta demo antes de que la limpieza la borre.
CREATE OR REPLACE FUNCTION public.limit_demo_lifetime_hours()
RETURNS INT LANGUAGE sql IMMUTABLE AS $$ SELECT 24 $$;

-- ------------------------------------------------- corpus de demostración ---

-- Espejo de ingested_files / documents sin owner_id: es la plantilla, no las
-- filas de nadie. El UNIQUE en name es lo que permite mapear cada archivo con
-- su copia al aprovisionar, sin arrastrar ids.
CREATE TABLE public.demo_files (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  bytes BIGINT NOT NULL CHECK (bytes >= 0),
  chunks INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.demo_documents (
  id BIGSERIAL PRIMARY KEY,
  file_id BIGINT NOT NULL REFERENCES public.demo_files(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  source TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  chunk_index INT NOT NULL DEFAULT 0,
  embedding_model TEXT NOT NULL DEFAULT 'openai/text-embedding-3-small'
);

CREATE INDEX demo_documents_file_idx ON public.demo_documents (file_id);

-- Nunca se buscan por similitud, solo se copian: no necesitan índice HNSW.
ALTER TABLE public.demo_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demo_documents ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.demo_files FROM anon, authenticated;
REVOKE ALL ON public.demo_documents FROM anon, authenticated;

-- --------------------------------------------------------- cuentas demo ----

-- Marca qué usuarios son demo. El FK con CASCADE hace que borrar al usuario
-- limpie la marca sola, así que la limpieza no puede dejar filas colgadas.
CREATE TABLE public.demo_sessions (
  owner_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX demo_sessions_created_idx ON public.demo_sessions (created_at);

ALTER TABLE public.demo_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.demo_sessions FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_demo(p_owner UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.demo_sessions WHERE owner_id = p_owner);
$$;

REVOKE EXECUTE ON FUNCTION public.is_demo(UUID) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------- cupo según el usuario ---

-- consume_question cambia de firma de hecho (el límite ya no es una constante),
-- así que hay que recrearla en vez de reemplazarla.
DROP FUNCTION IF EXISTS public.consume_question(UUID);

CREATE FUNCTION public.consume_question(p_owner UUID)
RETURNS TABLE (allowed BOOLEAN, used INT, max_per_day INT, log_id BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_is_demo BOOLEAN := public.is_demo(p_owner);
  v_limit INT := CASE
    WHEN v_is_demo THEN public.limit_demo_questions_per_day()
    ELSE public.limit_questions_per_day()
  END;
  v_used INT;
  v_demo_total INT;
  v_id BIGINT;
BEGIN
  -- Serializa por usuario: el segundo pedido espera a que el primero registre.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('consume_question:' || p_owner::TEXT));

  SELECT COUNT(*)::INT INTO v_used
  FROM public.question_log
  WHERE owner_id = p_owner
    AND asked_at >= pg_catalog.date_trunc('day', pg_catalog.now());

  IF v_used >= v_limit THEN
    RETURN QUERY SELECT FALSE, v_used, v_limit, NULL::BIGINT;
    RETURN;
  END IF;

  IF v_is_demo THEN
    -- Siempre se toma después del lock por usuario: un orden fijo entre los dos
    -- locks es lo que evita que dos demos concurrentes se abracen.
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext('consume_question:demo-global'));

    SELECT COUNT(*)::INT INTO v_demo_total
    FROM public.question_log q
    JOIN public.demo_sessions s ON s.owner_id = q.owner_id
    WHERE q.asked_at >= pg_catalog.date_trunc('day', pg_catalog.now());

    IF v_demo_total >= public.limit_demo_questions_per_day_global() THEN
      RETURN QUERY SELECT FALSE, v_used, v_limit, NULL::BIGINT;
      RETURN;
    END IF;
  END IF;

  INSERT INTO public.question_log (owner_id)
  VALUES (p_owner)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT TRUE, v_used + 1, v_limit, v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_question(UUID)
  FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------ aprovisionamiento ---

-- Copia el corpus plantilla a un usuario recién creado. La llama la function
-- `demo` con el cliente admin, justo después de dar de alta al usuario.
CREATE OR REPLACE FUNCTION public.provision_demo_user(p_owner UUID)
RETURNS TABLE (files INT, chunks INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_files INT := 0;
  v_chunks INT := 0;
  v_recent INT;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('provision_demo_user'));

  SELECT COUNT(*)::INT INTO v_recent
  FROM public.demo_sessions
  WHERE created_at >= pg_catalog.now() - pg_catalog.make_interval(hours => 1);

  IF v_recent >= public.limit_demo_sessions_per_hour() THEN
    RAISE EXCEPTION 'demo_rate_limited'
      USING ERRCODE = 'too_many_connections';
  END IF;

  INSERT INTO public.demo_sessions (owner_id) VALUES (p_owner);

  INSERT INTO public.ingested_files (owner_id, name, bytes, chunks)
  SELECT p_owner, f.name, f.bytes, f.chunks
  FROM public.demo_files f;

  GET DIAGNOSTICS v_files = ROW_COUNT;

  -- El join por nombre es válido porque el usuario acaba de nacer: no tiene
  -- ningún otro archivo con el que confundirse.
  INSERT INTO public.documents (
    content, source, embedding, chunk_index, embedding_model, owner_id, file_id
  )
  SELECT d.content, d.source, d.embedding, d.chunk_index, d.embedding_model,
         p_owner, nf.id
  FROM public.demo_documents d
  JOIN public.demo_files f ON f.id = d.file_id
  JOIN public.ingested_files nf
    ON nf.owner_id = p_owner AND nf.name = f.name;

  GET DIAGNOSTICS v_chunks = ROW_COUNT;

  RETURN QUERY SELECT v_files, v_chunks;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.provision_demo_user(UUID)
  FROM PUBLIC, anon, authenticated;

-- Las cuentas demo vencidas. Borrar al usuario arrastra por CASCADE sus
-- documentos, archivos, chats, cupo consumido y la marca de demo_sessions.
CREATE OR REPLACE FUNCTION public.expired_demo_owners()
RETURNS TABLE (owner_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT s.owner_id
  FROM public.demo_sessions s
  WHERE s.created_at < pg_catalog.now()
    - pg_catalog.make_interval(hours => public.limit_demo_lifetime_hours())
  ORDER BY s.created_at;
$$;

REVOKE EXECUTE ON FUNCTION public.expired_demo_owners()
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- uso ------

-- Suma is_demo para que la interfaz sepa en qué modo está, y toma el cupo de
-- la misma fuente que consume_question para que no puedan discrepar.
DROP FUNCTION IF EXISTS public.my_usage();

CREATE FUNCTION public.my_usage()
RETURNS TABLE (
  questions_used INT,
  questions_limit INT,
  bytes_used BIGINT,
  bytes_limit BIGINT,
  file_bytes_limit BIGINT,
  is_demo BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    (SELECT COUNT(*)::INT FROM public.question_log
      WHERE owner_id = auth.uid()
        AND asked_at >= pg_catalog.date_trunc('day', pg_catalog.now())),
    CASE
      WHEN public.is_demo(auth.uid()) THEN public.limit_demo_questions_per_day()
      ELSE public.limit_questions_per_day()
    END,
    COALESCE((SELECT SUM(bytes) FROM public.ingested_files
      WHERE owner_id = auth.uid()), 0)::BIGINT,
    public.limit_storage_bytes(),
    public.limit_file_bytes(),
    public.is_demo(auth.uid());
$$;

REVOKE EXECUTE ON FUNCTION public.my_usage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_usage() TO authenticated;
