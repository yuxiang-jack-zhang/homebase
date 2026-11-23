-- Explicit table and function grants (D59).
-- Hosted Supabase projects no longer give the API roles SELECT/INSERT/UPDATE/DELETE on new tables
-- (the local stack still does), so the first hosted deploy failed with "permission denied".
-- Granting exactly what the app and edge functions use also drops the broad defaults
-- (TRUNCATE, UPDATE, DELETE for anon) that were only blocked by RLS.

revoke all on all tables in schema public from anon, authenticated, service_role;
revoke all on all sequences in schema public from anon, authenticated, service_role;

-- Signed-in users read through RLS everywhere (incl. the current_presence view); their only
-- direct writes are geofence events and away blocks. Everything else goes through RPCs or edge functions.
grant select on all tables in schema public to authenticated;
grant insert on public.presence_events to authenticated;
grant insert, delete on public.away_blocks to authenticated;

-- Edge functions run as service_role, which bypasses RLS but still needs grants.
grant select, insert, update, delete on all tables in schema public to service_role;

-- RPCs, plus the helper functions RLS policies call as the signed-in user. anon stays revoked (0002).
grant execute on all functions in schema public to authenticated, service_role;

-- Make the local stack behave like hosted for tables later migrations create: no implicit access,
-- so a missing grant fails in the local tests instead of first in production.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;
