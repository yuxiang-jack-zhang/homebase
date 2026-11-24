-- Calendar busy/free as away evidence (docs/superpowers/specs/2026-11-24-calendar-away-design.md).
-- Start and end times of timed events in calendars the person marked as "I'm away"; titles never leave the phone.
-- Per person, not per household: the evidence applies in every household they're in.

create table public.calendar_away (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  synced_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index calendar_away_user_ends_at on public.calendar_away (user_id, ends_at);

alter table public.calendar_away enable row level security;

-- Only the person reads their own periods; roommates' questions read them through the edge function (service role).
create policy "own calendar periods only" on public.calendar_away
  for select to authenticated using (user_id = auth.uid());

-- Replaces the caller's periods that haven't ended with p_periods: [{ "start": iso, "end": iso }, ...].
-- Past rows stay. One bare error code for any bad input, like the other RPCs.
create function public.sync_calendar_away(p_periods jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_rows jsonb;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;
  if p_periods is null or jsonb_typeof(p_periods) <> 'array' or jsonb_array_length(p_periods) > 200 then
    raise exception 'invalid_periods';
  end if;
  begin
    -- Casts reject missing or malformed times (22007/22008) as well as non-object elements.
    select coalesce(jsonb_agg(jsonb_build_object('s', (e->>'start')::timestamptz, 'e', (e->>'end')::timestamptz)), '[]')
      into v_rows from jsonb_array_elements(p_periods) e;
  exception when others then
    raise exception 'invalid_periods';
  end;
  if exists (
    select 1 from jsonb_array_elements(v_rows) r
    where (r->>'s') is null or (r->>'e') is null
       or (r->>'e')::timestamptz - (r->>'s')::timestamptz not between interval '1 minute' and interval '24 hours'
       -- Starts within the next 15 days; an event under way (started earlier, still running) is allowed.
       or (r->>'s')::timestamptz > now() + interval '15 days'
  ) then
    raise exception 'invalid_periods';
  end if;

  delete from public.calendar_away where user_id = v_user and ends_at > now();
  insert into public.calendar_away (user_id, starts_at, ends_at)
  select v_user, (r->>'s')::timestamptz, (r->>'e')::timestamptz from jsonb_array_elements(v_rows) r
  where (r->>'e')::timestamptz > now(); -- one that ended in transit is dropped, not an error
end $$;

-- Grants (D59, 0006 style): no direct client writes; anon gets nothing.
grant select on public.calendar_away to authenticated;
grant select, insert, update, delete on public.calendar_away to service_role; -- edge functions read it (ask); full DML like every table (0006)
revoke execute on function public.sync_calendar_away(jsonb) from public, anon;
grant execute on function public.sync_calendar_away(jsonb) to authenticated;
