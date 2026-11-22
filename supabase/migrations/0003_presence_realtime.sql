-- Who's-home list updates live. RLS (can_see_presence) still filters postgres_changes per subscriber.
alter publication supabase_realtime add table public.presence_events;
