-- Autenticación, historial persistente por usuario y cuotas de uso.
--
-- Reparto de responsabilidades:
--   * conversations / messages  -> los escribe el navegador con el token del
--     usuario; RLS los aísla por dueño.
--   * documents / ingested_files / question_log -> los escriben solo las edge
--     functions con el cliente admin, después de validar la cuota. El usuario
--     puede leer los suyos y borrar sus archivos, nunca inventar filas.

-- ---------------------------------------------------------------- límites ---

-- Los límites viven acá y en ningún otro lado, para que la UI que los muestra
-- y las functions que los aplican no se desincronicen.
CREATE OR REPLACE FUNCTION public.limit_questions_per_day()
RETURNS INT LANGUAGE sql IMMUTABLE AS $$ SELECT 5 $$;

CREATE OR REPLACE FUNCTION public.limit_storage_bytes()
RETURNS BIGINT LANGUAGE sql IMMUTABLE AS $$ SELECT (2 * 1024 * 1024)::BIGINT $$;

CREATE OR REPLACE FUNCTION public.limit_file_bytes()
RETURNS BIGINT LANGUAGE sql IMMUTABLE AS $$ SELECT (1024 * 1024)::BIGINT $$;

-- ------------------------------------------------------- archivos subidos ---

CREATE TABLE public.ingested_files (
  id BIGSERIAL PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  bytes BIGINT NOT NULL CHECK (bytes >= 0),
  chunks INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ingested_files_owner_idx ON public.ingested_files (owner_id, created_at DESC);

ALTER TABLE public.ingested_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ingested_files: el dueño lee lo suyo"
ON public.ingested_files FOR SELECT TO authenticated
USING (owner_id = (SELECT auth.uid()));

-- Borrar el archivo libera cuota y arrastra sus chunks por el FK de documents.
CREATE POLICY "ingested_files: el dueño borra lo suyo"
ON public.ingested_files FOR DELETE TO authenticated
USING (owner_id = (SELECT auth.uid()));

REVOKE ALL ON public.ingested_files FROM anon;
REVOKE INSERT, UPDATE ON public.ingested_files FROM authenticated;
GRANT SELECT, DELETE ON public.ingested_files TO authenticated;

-- ------------------------------------------------------------- documents ---

-- La tabla está vacía, así que las columnas pueden nacer NOT NULL.
ALTER TABLE public.documents
  ADD COLUMN owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN file_id BIGINT NOT NULL REFERENCES public.ingested_files(id) ON DELETE CASCADE;

CREATE INDEX documents_owner_idx ON public.documents (owner_id);
CREATE INDEX documents_file_idx ON public.documents (file_id);

-- match_documents es SECURITY INVOKER: si la function la llama con el token del
-- usuario, esta política es lo único que impide que lea documentos ajenos.
CREATE POLICY "documents: el dueño lee lo suyo"
ON public.documents FOR SELECT TO authenticated
USING (owner_id = (SELECT auth.uid()));

REVOKE ALL ON public.documents FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.documents FROM authenticated;
GRANT SELECT ON public.documents TO authenticated;

-- ---------------------------------------------------------- historial ------

CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX conversations_owner_idx ON public.conversations (owner_id, updated_at DESC);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conversations: el dueño lee lo suyo"
ON public.conversations FOR SELECT TO authenticated
USING (owner_id = (SELECT auth.uid()));

CREATE POLICY "conversations: el dueño crea lo suyo"
ON public.conversations FOR INSERT TO authenticated
WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY "conversations: el dueño edita lo suyo"
ON public.conversations FOR UPDATE TO authenticated
USING (owner_id = (SELECT auth.uid()))
WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY "conversations: el dueño borra lo suyo"
ON public.conversations FOR DELETE TO authenticated
USING (owner_id = (SELECT auth.uid()));

REVOKE ALL ON public.conversations FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;

CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  -- Desnormalizado a propósito: deja la política sin join y sin recursión.
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  sources JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX messages_conversation_idx ON public.messages (conversation_id, created_at);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "messages: el dueño lee lo suyo"
ON public.messages FOR SELECT TO authenticated
USING (owner_id = (SELECT auth.uid()));

CREATE POLICY "messages: el dueño crea lo suyo"
ON public.messages FOR INSERT TO authenticated
WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY "messages: el dueño borra lo suyo"
ON public.messages FOR DELETE TO authenticated
USING (owner_id = (SELECT auth.uid()));

REVOKE ALL ON public.messages FROM anon;
REVOKE UPDATE ON public.messages FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.messages TO authenticated;

-- Mantiene el orden del panel lateral por actividad real.
CREATE OR REPLACE FUNCTION public.touch_conversation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.conversations
  SET updated_at = NOW()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER messages_touch_conversation
AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.touch_conversation();

-- ------------------------------------------------------------- cuotas ------

-- Append-only y fuera del alcance del usuario: si pudiera borrar filas acá,
-- reiniciaría su propio límite diario.
CREATE TABLE public.question_log (
  id BIGSERIAL PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX question_log_owner_day_idx ON public.question_log (owner_id, asked_at DESC);

ALTER TABLE public.question_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.question_log FROM anon, authenticated;

-- Cuenta y registra en una sola llamada, para que dos pedidos simultáneos no
-- lean ambos "4 usadas" y pasen los dos.
CREATE OR REPLACE FUNCTION public.consume_question(p_owner UUID)
RETURNS TABLE (allowed BOOLEAN, used INT, max_per_day INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INT := public.limit_questions_per_day();
  v_used INT;
BEGIN
  -- Serializa por usuario: el segundo pedido espera a que el primero registre.
  PERFORM pg_advisory_xact_lock(hashtext('consume_question:' || p_owner::TEXT));

  SELECT COUNT(*)::INT INTO v_used
  FROM public.question_log
  WHERE owner_id = p_owner AND asked_at >= date_trunc('day', NOW());

  IF v_used >= v_limit THEN
    RETURN QUERY SELECT FALSE, v_used, v_limit;
    RETURN;
  END IF;

  INSERT INTO public.question_log (owner_id) VALUES (p_owner);
  RETURN QUERY SELECT TRUE, v_used + 1, v_limit;
END;
$$;

-- Reserva espacio y crea la fila del archivo en una sola operación.
CREATE OR REPLACE FUNCTION public.reserve_file(
  p_owner UUID,
  p_name TEXT,
  p_bytes BIGINT
)
RETURNS TABLE (allowed BOOLEAN, reason TEXT, file_id BIGINT, used BIGINT, max_bytes BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max BIGINT := public.limit_storage_bytes();
  v_max_file BIGINT := public.limit_file_bytes();
  v_used BIGINT;
  v_id BIGINT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('reserve_file:' || p_owner::TEXT));

  SELECT COALESCE(SUM(bytes), 0) INTO v_used
  FROM public.ingested_files
  WHERE owner_id = p_owner;

  IF p_bytes > v_max_file THEN
    RETURN QUERY SELECT FALSE, 'file_too_large', NULL::BIGINT, v_used, v_max;
    RETURN;
  END IF;

  IF v_used + p_bytes > v_max THEN
    RETURN QUERY SELECT FALSE, 'quota_exceeded', NULL::BIGINT, v_used, v_max;
    RETURN;
  END IF;

  INSERT INTO public.ingested_files (owner_id, name, bytes)
  VALUES (p_owner, p_name, p_bytes)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT TRUE, NULL::TEXT, v_id, v_used + p_bytes, v_max;
END;
$$;

-- Estas tres toman el dueño por parámetro, así que solo puede llamarlas el
-- cliente admin de las edge functions. Postgres las concede a PUBLIC por
-- defecto: sin este REVOKE, un usuario podría gastar la cuota de otro.
REVOKE EXECUTE ON FUNCTION public.consume_question(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reserve_file(UUID, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;

-- La de solo lectura sí la usa la UI: no toma parámetros y se ata a auth.uid().
CREATE OR REPLACE FUNCTION public.my_usage()
RETURNS TABLE (
  questions_used INT,
  questions_limit INT,
  bytes_used BIGINT,
  bytes_limit BIGINT,
  file_bytes_limit BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(*)::INT FROM public.question_log
      WHERE owner_id = auth.uid() AND asked_at >= date_trunc('day', NOW())),
    public.limit_questions_per_day(),
    COALESCE((SELECT SUM(bytes) FROM public.ingested_files
      WHERE owner_id = auth.uid()), 0)::BIGINT,
    public.limit_storage_bytes(),
    public.limit_file_bytes();
$$;

GRANT EXECUTE ON FUNCTION public.my_usage() TO authenticated;
