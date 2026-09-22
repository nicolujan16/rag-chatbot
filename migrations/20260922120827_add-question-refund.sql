-- Devuelve la pregunta al usuario si la respuesta nunca llegó a generarse.
-- Con un cupo de 5 por día, perder una porque falló el proveedor de modelos
-- es una mala experiencia por un error que no es del usuario.

-- RETURNS TABLE no se puede cambiar con CREATE OR REPLACE: hay que recrearla.
DROP FUNCTION IF EXISTS public.consume_question(UUID);

CREATE FUNCTION public.consume_question(p_owner UUID)
RETURNS TABLE (allowed BOOLEAN, used INT, max_per_day INT, log_id BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INT := public.limit_questions_per_day();
  v_used INT;
  v_id BIGINT;
BEGIN
  -- Serializa por usuario: el segundo pedido espera a que el primero registre.
  PERFORM pg_advisory_xact_lock(hashtext('consume_question:' || p_owner::TEXT));

  SELECT COUNT(*)::INT INTO v_used
  FROM public.question_log
  WHERE owner_id = p_owner AND asked_at >= date_trunc('day', NOW());

  IF v_used >= v_limit THEN
    RETURN QUERY SELECT FALSE, v_used, v_limit, NULL::BIGINT;
    RETURN;
  END IF;

  INSERT INTO public.question_log (owner_id)
  VALUES (p_owner)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT TRUE, v_used + 1, v_limit, v_id;
END;
$$;

-- El owner va como parámetro además del id: sin eso, quien pudiera llamarla
-- borraría consumos ajenos con solo adivinar un id correlativo.
CREATE OR REPLACE FUNCTION public.refund_question(p_owner UUID, p_log_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INT;
BEGIN
  DELETE FROM public.question_log
  WHERE id = p_log_id AND owner_id = p_owner;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_question(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refund_question(UUID, BIGINT) FROM PUBLIC, anon, authenticated;
