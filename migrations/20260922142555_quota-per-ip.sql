-- El cupo diario pasa de la cuenta a la dirección IP.
--
-- Con el registro cerrado y solo cuentas demo, contar por cuenta no acota nada:
-- pedir una cuenta nueva es un clic, y cada una traía su propio cupo. La IP es
-- la unidad más chica que un visitante no puede renovar apretando un botón.
--
-- La contrapartida es conocida y aceptada: detrás de un NAT compartido (una
-- oficina, una universidad) todos comparten las 5 preguntas.

-- ------------------------------------------------------------- límites -----

-- Reemplaza a limit_questions_per_day() y limit_demo_questions_per_day(): el
-- cupo ya no depende de quién sos sino de desde dónde venís.
CREATE OR REPLACE FUNCTION public.limit_questions_per_ip_per_day()
RETURNS INT LANGUAGE sql IMMUTABLE AS $$ SELECT 5 $$;

-- ------------------------------------------------------- registro por IP ---

ALTER TABLE public.question_log ADD COLUMN ip TEXT;

CREATE INDEX question_log_ip_day_idx ON public.question_log (ip, asked_at DESC);

-- El registro tiene que sobrevivir al borrado de la cuenta: si se fuera con
-- ella por CASCADE, la limpieza diaria le reiniciaría el cupo a esa IP.
ALTER TABLE public.question_log ALTER COLUMN owner_id DROP NOT NULL;

ALTER TABLE public.question_log
  DROP CONSTRAINT question_log_owner_id_fkey;

ALTER TABLE public.question_log
  ADD CONSTRAINT question_log_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ------------------------------------------------------------- consumo -----

DROP FUNCTION IF EXISTS public.consume_question(UUID);

CREATE FUNCTION public.consume_question(p_owner UUID, p_ip TEXT)
RETURNS TABLE (allowed BOOLEAN, used INT, max_per_day INT, log_id BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit INT := public.limit_questions_per_ip_per_day();
  v_ip TEXT := COALESCE(NULLIF(p_ip, ''), 'desconocida');
  v_used INT;
  v_demo_total INT;
  v_id BIGINT;
BEGIN
  -- Serializa por IP, que ahora es la unidad del cupo: dos pedidos a la vez
  -- desde el mismo lugar no pueden pasar ambos con el último crédito.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('consume_question:' || v_ip));

  SELECT COUNT(*)::INT INTO v_used
  FROM public.question_log
  WHERE ip = v_ip
    AND asked_at >= pg_catalog.date_trunc('day', pg_catalog.now());

  IF v_used >= v_limit THEN
    RETURN QUERY SELECT FALSE, v_used, v_limit, NULL::BIGINT;
    RETURN;
  END IF;

  -- Techo de todo el sistema, por encima del cupo de cada IP. Es lo único que
  -- acota el gasto cuando el visitante tiene muchas IP a mano.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('consume_question:global'));

  SELECT COUNT(*)::INT INTO v_demo_total
  FROM public.question_log
  WHERE asked_at >= pg_catalog.date_trunc('day', pg_catalog.now());

  IF v_demo_total >= public.limit_demo_questions_per_day_global() THEN
    RETURN QUERY SELECT FALSE, v_used, v_limit, NULL::BIGINT;
    RETURN;
  END IF;

  INSERT INTO public.question_log (owner_id, ip)
  VALUES (p_owner, v_ip)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT TRUE, v_used + 1, v_limit, v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_question(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

-- El reembolso ahora se ata al registro, no al dueño: la cuenta puede haberse
-- borrado y el cupo de la IP sigue en pie.
DROP FUNCTION IF EXISTS public.refund_question(UUID, BIGINT);

CREATE FUNCTION public.refund_question(p_log_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted INT;
BEGIN
  DELETE FROM public.question_log WHERE id = p_log_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.refund_question(BIGINT)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- uso ------

-- my_usage() no sirve más: la IP no se puede leer desde SQL, la trae la edge
-- function. Esta toma los dos datos y devuelve lo mismo que antes.
DROP FUNCTION IF EXISTS public.my_usage();

CREATE FUNCTION public.usage_for(p_owner UUID, p_ip TEXT)
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
      WHERE ip = COALESCE(NULLIF(p_ip, ''), 'desconocida')
        AND asked_at >= pg_catalog.date_trunc('day', pg_catalog.now())),
    public.limit_questions_per_ip_per_day(),
    COALESCE((SELECT SUM(bytes) FROM public.ingested_files
      WHERE owner_id = p_owner), 0)::BIGINT,
    public.limit_storage_bytes(),
    public.limit_file_bytes(),
    public.is_demo(p_owner);
$$;

REVOKE EXECUTE ON FUNCTION public.usage_for(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

-- Quedaron sin uso: el cupo ya no se calcula por cuenta.
DROP FUNCTION IF EXISTS public.limit_questions_per_day();
DROP FUNCTION IF EXISTS public.limit_demo_questions_per_day();
