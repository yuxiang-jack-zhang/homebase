-- Hardening (security review findings 5 and 8, backlog security items).
-- Tests: supabase/tests/{presence,rls,rpcs,data,functions}.test.ts.

-- 1. Presence forgery and spam (finding 5). The app sends `at` = the moment it inserts (no offline queue),
-- so the server clock gives the same time without trusting the phone: no backdating, and a wrong phone clock
-- can't get a real event rejected. Edge functions, RPCs and SQL (other roles) keep their own `at`.
-- Security invoker on purpose: current_user is the API role here, and the count reads only my rows (RLS).
create function public.limit_presence_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  new.at := now();
  -- 60 an hour per household is far above any real crossing pattern and stops a script flooding co-members.
  if (
    select count(*) from public.presence_events
    where household_id = new.household_id and user_id = new.user_id and at > now() - interval '1 hour'
  ) >= 60 then
    raise exception 'rate_limited';
  end if;
  return new;
end $$;

-- 2 and 4. Same-timing triggers fire by name. Order: limit -> stamp visibility -> skip repeats,
-- so the repeat check knows whether the new row is visible.
alter trigger presence_events_stamp_visible on public.presence_events rename to presence_events_2_stamp_visible;
alter trigger presence_events_skip_repeat on public.presence_events rename to presence_events_3_skip_repeat;
create trigger presence_events_1_limit before insert on public.presence_events
for each row execute function public.limit_presence_insert();

-- 2. Visibility stamp race: FOR SHARE waits for a concurrent update_my_settings (which holds FOR UPDATE)
-- and then reads its committed visibility, so an insert racing an off->on change isn't stamped hidden.
create or replace function public.stamp_presence_visible() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.visible := coalesce((
    select visibility from public.household_members
    where household_id = new.household_id and user_id = new.user_id
    for share
  ), false);
  return new;
end $$;

-- 4. A repeat of my latest kind is skipped unless it would reveal it: latest hidden, new row visible.
create or replace function public.skip_repeat_presence() returns trigger
language plpgsql as $$
begin
  if exists (
    select 1 from (
      select kind, visible from public.presence_events
      where household_id = new.household_id and user_id = new.user_id
      order by at desc, id desc limit 1
    ) latest
    where latest.kind = new.kind and (latest.visible or not new.visible)
  ) then
    return null;
  end if;
  return new;
end $$;

-- 4. Off -> on reveals the current state as a new event at the unhide moment, so co-members don't learn
-- when the last hidden change happened. The hidden rows stay hidden. If the latest row is already visible,
-- the skip-repeat trigger drops this insert (nothing changed for co-members).
create or replace function public.update_my_settings(p_household_id uuid, p_visibility bool, p_answer_mode public.answer_mode)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_was bool;
begin
  select visibility into v_was from public.household_members
  where household_id = p_household_id and user_id = auth.uid()
  for update;
  if not found then
    raise exception 'not_member';
  end if;
  update public.household_members set visibility = p_visibility, answer_mode = p_answer_mode
  where household_id = p_household_id and user_id = auth.uid();
  if p_visibility and not v_was then
    insert into public.presence_events (household_id, user_id, kind)
    select household_id, user_id, kind from public.presence_events
    where household_id = p_household_id and user_id = auth.uid()
    order by at desc, id desc limit 1;
  end if;
end $$;

-- 3. The fallback guess becomes readable by the asker only after the app's 10-minute wait (NO_REPLY_AFTER_MS).
-- Its own table, kept out of the supabase_realtime publication: realtime payloads of question_targets
-- would otherwise carry it immediately.
create table public.target_guesses (
  question_target_id uuid primary key references public.question_targets on delete cascade,
  guess text not null,
  visible_after timestamptz not null default now() + interval '10 minutes'
);
alter table public.target_guesses enable row level security;
create policy "asker reads the guess after the wait" on public.target_guesses
  for select to authenticated using (
    visible_after <= now() and exists (
      select 1 from public.question_targets t
      where t.id = target_guesses.question_target_id and public.asked_question(t.question_id)
    )
  );
grant select on public.target_guesses to authenticated;
grant select, insert, update, delete on public.target_guesses to service_role;

insert into public.target_guesses (question_target_id, guess, visible_after)
select id, fallback_guess, created_at + interval '10 minutes' from public.question_targets
where fallback_guess is not null;
alter table public.question_targets drop column fallback_guess;

-- 6. Named errors instead of raw Postgres ones (23514 for the radius check, 22023 for an unknown zone).
create or replace function public.create_household(
  p_name text, p_lat float8, p_lng float8, p_timezone text, p_radius_m int default 100
) returns public.households
language plpgsql security definer set search_path = '' as $$
declare
  h public.households;
  v_name text := btrim(p_name);
begin
  if v_name is null or char_length(v_name) not between 1 and 60 then
    raise exception 'invalid_name';
  end if;
  -- NaN and +/-Infinity also fail BETWEEN.
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'invalid_location';
  end if;
  if p_radius_m is null or p_radius_m not between 50 and 500 then
    raise exception 'invalid_radius';
  end if;
  if p_timezone is null then
    raise exception 'invalid_timezone';
  end if;
  begin
    perform now() at time zone p_timezone; -- rejects unknown time zones
  exception when others then
    raise exception 'invalid_timezone';
  end;
  loop
    begin
      insert into public.households (name, invite_code, home_lat, home_lng, home_radius_m, timezone, created_by)
      values (v_name, public.new_invite_code(), p_lat, p_lng, p_radius_m, p_timezone, auth.uid())
      returning * into h;
      exit;
    exception when unique_violation then
      -- invite code collision: draw again
    end;
  end loop;
  insert into public.household_members (household_id, user_id, role, home_confirmed_at)
  values (h.id, auth.uid(), 'owner', now());
  return h;
end $$;

create or replace function public.update_home(p_household_id uuid, p_lat float8, p_lng float8, p_radius_m int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.household_members
    where household_id = p_household_id and user_id = auth.uid() and role = 'owner'
  ) then
    raise exception 'not_owner';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'invalid_location';
  end if;
  if p_radius_m is null or p_radius_m not between 50 and 500 then
    raise exception 'invalid_radius';
  end if;
  update public.households set home_lat = p_lat, home_lng = p_lng, home_radius_m = p_radius_m
  where id = p_household_id;
  -- Everyone else must re-confirm before their phone geofences the new spot.
  update public.household_members set home_confirmed_at = null
  where household_id = p_household_id and user_id <> auth.uid();
end $$;

-- Grants (D59): the trigger functions are called by triggers, not clients.
revoke execute on function public.limit_presence_insert() from authenticated, service_role;
