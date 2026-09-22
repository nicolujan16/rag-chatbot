-- La ventana de limpieza pasa a ser un parámetro opcional.
--
-- Por defecto sigue siendo `limit_demo_lifetime_hours()`, que es lo que usa el
-- schedule diario. Poder pasar otra ventana es lo que permite purgar las
-- cuentas de prueba a mano sin tocar el límite ni esperar un día.

DROP FUNCTION IF EXISTS public.expired_demo_owners();

CREATE FUNCTION public.expired_demo_owners(p_hours INT DEFAULT NULL)
RETURNS TABLE (owner_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT s.owner_id
  FROM public.demo_sessions s
  WHERE s.created_at < pg_catalog.now()
    - pg_catalog.make_interval(
        hours => COALESCE(p_hours, public.limit_demo_lifetime_hours()))
  ORDER BY s.created_at;
$$;

REVOKE EXECUTE ON FUNCTION public.expired_demo_owners(INT)
  FROM PUBLIC, anon, authenticated;
