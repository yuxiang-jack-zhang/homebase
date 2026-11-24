-- Rate limits for `ask` (security finding 3). One row per ask admitted to the model; rejected attempts are not
-- recorded, so retrying while limited doesn't extend the wait or count towards the global breaker.
-- Counting `questions` instead would race: the question row is written after the parse call (~1 s), so a burst of
-- parallel requests would all see the old count. admit_ask checks and records under a per-user lock instead.
-- Service-role only (like 0007): no client grants or policies.

create table ask_admissions (
  user_id uuid not null references profiles on delete cascade,
  created_at timestamptz not null default now()
);
-- shortcut: rows are never pruned (one tiny row per ask); delete rows older than a day on a schedule if it grows.
create index ask_admissions_user_created_at on ask_admissions (user_id, created_at);
create index ask_admissions_created_at on ask_admissions (created_at);

alter table ask_admissions enable row level security;

-- 'ok' (and records the ask), 'rate_limited' (the user's hour or day is full) or 'busy' (all users' day is full).
-- The limits are arguments so the edge function's constants (ASK_LIMITS) are the single source.
create function public.admit_ask(p_user_id uuid, p_per_hour int, p_per_day int, p_global_per_day int) returns text
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('admit_ask:' || p_user_id::text, 0));
  if (select count(*) from public.ask_admissions where user_id = p_user_id and created_at > now() - interval '1 hour') >= p_per_hour
     or (select count(*) from public.ask_admissions where user_id = p_user_id and created_at > now() - interval '1 day') >= p_per_day then
    return 'rate_limited';
  end if;
  -- No global lock: concurrent asks from different users can overshoot by a few, which is fine for a breaker.
  if (select count(*) from public.ask_admissions where created_at > now() - interval '1 day') >= p_global_per_day then
    return 'busy';
  end if;
  insert into public.ask_admissions (user_id) values (p_user_id);
  return 'ok';
end $$;

-- The caller's id is an argument, so only the edge function (service role) may call this; a user calling it could
-- use up someone else's quota. 0002's default privileges already keep PUBLIC and anon off new functions.
revoke execute on function public.admit_ask(uuid, int, int, int) from public, anon, authenticated;
grant execute on function public.admit_ask(uuid, int, int, int) to service_role;
