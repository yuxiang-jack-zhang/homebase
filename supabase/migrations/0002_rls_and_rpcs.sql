-- Privacy rules and household RPCs. Tests: supabase/tests/{rls,rpcs}.test.ts.
-- Reads go through RLS; households/household_members change only via the RPCs below (D19);
-- questions/targets/responses/predictions are written only by the service role (edge functions).

create index presence_events_household_user_at on public.presence_events (household_id, user_id, at desc);

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger question_targets_touch_updated_at before update on public.question_targets
  for each row execute function public.touch_updated_at();

-- Policy helpers. security definer so a policy can look at household_members/questions without
-- re-entering their own RLS (the recursion trap). Each answers only about the caller.

create function public.is_member(p_household_id uuid) returns bool
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.household_members
    where household_id = p_household_id and user_id = (select auth.uid())
  )
$$;

create function public.shares_household(p_user_id uuid) returns bool
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.household_members me
    join public.household_members them using (household_id)
    where me.user_id = (select auth.uid()) and them.user_id = p_user_id
  )
$$;

-- Own events always; a co-member's only if both are in THAT household and the subject is visible there.
create function public.can_see_presence(p_household_id uuid, p_user_id uuid) returns bool
language sql stable security definer set search_path = '' as $$
  select p_user_id = (select auth.uid())
    or (public.is_member(p_household_id) and exists (
      select 1 from public.household_members
      where household_id = p_household_id and user_id = p_user_id and visibility
    ))
$$;

create function public.asked_question(p_question_id uuid) returns bool
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.questions where id = p_question_id and asker_id = (select auth.uid()))
$$;

create function public.targeted_by_question(p_question_id uuid) returns bool
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.question_targets where question_id = p_question_id and user_id = (select auth.uid())
  )
$$;

-- Policies. No policy = denied, so every write not listed here is service-role only.

create policy "read own and co-members' profiles" on public.profiles
  for select to authenticated using (id = (select auth.uid()) or public.shares_household(id));

create policy "members read their households" on public.households
  for select to authenticated using (public.is_member(id));

create policy "members read their co-members" on public.household_members
  for select to authenticated using (public.is_member(household_id));

create policy "read own or visible co-members' presence" on public.presence_events
  for select to authenticated using (public.can_see_presence(household_id, user_id));

create policy "insert own presence after confirming home" on public.presence_events
  for insert to authenticated with check (
    user_id = (select auth.uid()) and exists (
      select 1 from public.household_members m
      where m.household_id = presence_events.household_id
        and m.user_id = (select auth.uid())
        and m.home_confirmed_at is not null
    )
  );

create policy "own away blocks only" on public.away_blocks
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "asker and targets read questions" on public.questions
  for select to authenticated using (asker_id = (select auth.uid()) or public.targeted_by_question(id));

create policy "asker and target read question targets" on public.question_targets
  for select to authenticated using (user_id = (select auth.uid()) or public.asked_question(question_id));

create policy "target reads drafts; asker and target read sent" on public.responses
  for select to authenticated using (
    exists (
      select 1 from public.question_targets t
      where t.id = responses.question_target_id
        and (t.user_id = (select auth.uid())
             or (responses.visibility = 'sent' and public.asked_question(t.question_id)))
    )
  );

create policy "read predictions about yourself" on public.predictions
  for select to authenticated using (user_id = (select auth.uid()));

-- RPCs. Errors raise the bare code as the message so clients can match it.

create function public.new_invite_code() returns text
language sql volatile set search_path = '' as $$
  -- 32 symbols (no I, O, 0, 1); 256 % 32 = 0, so byte % 32 is unbiased.
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', get_byte(b, i) % 32 + 1, 1), '')
  from extensions.gen_random_bytes(6) b, generate_series(0, 5) i
$$;

create function public.create_household(
  p_name text, p_lat float8, p_lng float8, p_radius_m int, p_timezone text
) returns public.households
language plpgsql security definer set search_path = '' as $$
declare
  h public.households;
begin
  perform now() at time zone p_timezone; -- rejects unknown time zones
  loop
    begin
      insert into public.households (name, invite_code, home_lat, home_lng, home_radius_m, timezone, created_by)
      values (p_name, public.new_invite_code(), p_lat, p_lng, p_radius_m, p_timezone, auth.uid())
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

create function public.join_household(p_invite_code text) returns public.households
language plpgsql security definer set search_path = '' as $$
declare
  h public.households;
begin
  select * into h from public.households where invite_code = upper(btrim(p_invite_code));
  if not found then
    raise exception 'invalid_invite_code';
  end if;
  insert into public.household_members (household_id, user_id) values (h.id, auth.uid());
  return h;
exception when unique_violation then
  raise exception 'already_member';
end $$;

create function public.confirm_home(p_household_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.household_members set home_confirmed_at = now()
  where household_id = p_household_id and user_id = auth.uid();
  if not found then
    raise exception 'not_member';
  end if;
end $$;

create function public.update_home(p_household_id uuid, p_lat float8, p_lng float8, p_radius_m int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.household_members
    where household_id = p_household_id and user_id = auth.uid() and role = 'owner'
  ) then
    raise exception 'not_owner';
  end if;
  update public.households set home_lat = p_lat, home_lng = p_lng, home_radius_m = p_radius_m
  where id = p_household_id;
  -- Everyone else must re-confirm before their phone geofences the new spot.
  update public.household_members set home_confirmed_at = null
  where household_id = p_household_id and user_id <> auth.uid();
end $$;

create function public.update_my_settings(p_household_id uuid, p_visibility bool, p_answer_mode public.answer_mode)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.household_members set visibility = p_visibility, answer_mode = p_answer_mode
  where household_id = p_household_id and user_id = auth.uid();
  if not found then
    raise exception 'not_member';
  end if;
end $$;

create function public.household_accuracy(p_household_id uuid)
returns table (kind public.question_kind, correct int, incorrect int, unscored int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_member(p_household_id) then
    raise exception 'not_member';
  end if;
  return query
    select p.kind,
      (count(*) filter (where p.outcome = 'correct'))::int,
      (count(*) filter (where p.outcome = 'incorrect'))::int,
      (count(*) filter (where p.outcome = 'unscored'))::int
    from public.predictions p
    join public.question_targets t on t.id = p.question_target_id
    join public.questions q on q.id = t.question_id
    where q.household_id = p_household_id
    group by p.kind;
end $$;

-- Supabase grants EXECUTE on new functions to anon; every function here needs a signed-in caller.
revoke execute on all functions in schema public from public, anon;
