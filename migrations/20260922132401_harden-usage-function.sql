-- Correcciones señaladas por `insforge diagnose advisor`.

-- 1. my_usage() quedaba alcanzable por anon.
--
-- Postgres concede EXECUTE a PUBLIC por defecto, así que el GRANT a
-- `authenticated` de la migración anterior no restringía nada: sumaba un
-- permiso que ya estaba. Con auth.uid() nulo la función no filtra datos
-- (devuelve ceros), pero es superficie de ataque sin motivo.
REVOKE EXECUTE ON FUNCTION public.my_usage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_usage() TO authenticated;

-- El cuerpo referencia todo con esquema explícito (public.*, auth.uid()),
-- así que un search_path vacío es seguro y cierra el secuestro por búsqueda.
ALTER FUNCTION public.my_usage() SET search_path = '';

-- 2. messages.owner_id sin índice.
--
-- Es la columna sobre la que filtran las tres políticas RLS de la tabla, y se
-- evalúan en cada consulta. Además es FK a auth.users: sin índice, borrar un
-- usuario escanea la tabla entera y toma locks que bloquean escrituras.
CREATE INDEX messages_owner_idx ON public.messages (owner_id);
