-- Membership you can control (security review findings 1 and 2).
-- Joining with a code makes a pending request the owner approves; only active members count as members anywhere.
-- Co-members see presence only from when they became active. Owners remove and decline, anyone leaves,
-- owners rotate the code, and deleting an account works (ownership moves on, or the last member's household goes).
-- Tests: supabase/tests/membership.test.ts.

create type public.member_status as enum ('pending', 'active');
-- Existing rows and create_household's owner row are active; join_household inserts 'pending' explicitly.
alter table public.household_members add column status public.member_status not null default 'active';
-- joined_at = when the member became active (set on approval); pending rows have none.
update public.household_members m set joined_at = h.created_at
from public.households h where h.id = m.household_id and m.joined_at is null;

-- Deleting an auth user must cascade cleanly. created_by is history only (role says who owns it now).
alter table public.households alter column created_by drop not null,
  drop constraint households_created_by_fkey,
  add constraint households_created_by_fkey foreign key (created_by) references public.profiles on delete set null;
alter table public.questions
  drop constraint questions_household_id_fkey,
  add constraint questions_household_id_fkey foreign key (household_id) references public.households on delete cascade,
  drop constraint questions_asker_id_fkey,
  add constraint questions_asker_id_fkey foreign key (asker_id) references public.profiles on delete cascade;
alter table public.question_targets
  drop constraint question_targets_user_id_fkey,
  add constraint question_targets_user_id_fkey foreign key (user_id) references public.profiles on delete cascade;
alter table public.predictions
  drop constraint predictions_user_id_fkey,
  add constraint predictions_user_id_fkey foreign key (user_id) references public.profiles on delete cascade;

-- Membership checks: active only.

create or replace function public.is_member(p_household_id uuid) returns bool
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.household_members
    where household_id = p_household_id and user_id = (select auth.uid()) and status = 'active'
  )
$$;

-- Them in any status, so an owner sees who is asking to join; a pending caller shares nothing.
create or replace function public.shares_household(p_user_id uuid) returns bool
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.household_members me
    join public.household_members them using (household_id)
    where me.user_id = (select auth.uid()) and me.status = 'active' and them.user_id = p_user_id
  )
$$;

-- Own events always; a co-member's only if both are active in THAT household, the subject is visible there,
-- and the event happened after the viewer joined.
drop policy "read own or visible co-members' presence" on public.presence_events;
drop function public.can_see_presence(uuid, uuid);
create function public.can_see_presence(p_household_id uuid, p_user_id uuid, p_at timestamptz) returns bool
language sql stable security definer set search_path = '' as $$
  select p_user_id = (select auth.uid())
    or (exists (
      select 1 from public.household_members
      where household_id = p_household_id and user_id = (select auth.uid()) and status = 'active' and p_at >= joined_at
    ) and exists (
      select 1 from public.household_members
      where household_id = p_household_id and user_id = p_user_id and status = 'active' and visibility
    ))
$$;
create policy "read own or visible co-members' presence" on public.presence_events
  for select to authenticated using (
    public.can_see_presence(household_id, user_id, at) and (visible or user_id = (select auth.uid()))
  );

drop policy "insert own presence after confirming home" on public.presence_events;
create policy "insert own presence after confirming home" on public.presence_events
  for insert to authenticated with check (
    user_id = (select auth.uid()) and exists (
      select 1 from public.household_members m
      where m.household_id = presence_events.household_id
        and m.user_id = (select auth.uid())
        and m.status = 'active'
        and m.home_confirmed_at is not null
    )
  );

-- A pending member sees their own row (to know they're waiting), nothing else.
drop policy "members read their co-members" on public.household_members;
create policy "members read their co-members" on public.household_members
  for select to authenticated using (public.is_member(household_id) or user_id = (select auth.uid()));

create or replace function public.confirm_home(p_household_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.household_members set home_confirmed_at = now()
  where household_id = p_household_id and user_id = auth.uid() and status = 'active';
  if not found then
    raise exception 'not_member';
  end if;
end $$;

-- Joining: rate-limited pending requests.

-- Failed join attempts, for the rate limit. Written only by join_household.
create table public.join_attempts (
  user_id uuid not null references public.profiles on delete cascade,
  at timestamptz not null default now()
);
create index join_attempts_user_at on public.join_attempts (user_id, at);
alter table public.join_attempts enable row level security;

-- Returns {id, name} (no location, no code) or {error: 'invalid_invite_code'}. That failure is returned, not raised:
-- a raise would roll back the attempt it records. Other failures raise as usual.
drop function public.join_household(text);
create function public.join_household(p_invite_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
  v_name text;
begin
  -- Serializes one user's attempts, so parallel guesses can't all pass the count below.
  perform 1 from public.profiles where id = v_me for update;
  delete from public.join_attempts where user_id = v_me and at <= now() - interval '1 hour';
  if (select count(*) from public.join_attempts where user_id = v_me) >= 5 then
    raise exception 'rate_limited';
  end if;
  select id, name into v_id, v_name from public.households where invite_code = upper(btrim(p_invite_code));
  if not found then
    insert into public.join_attempts (user_id) values (v_me);
    return jsonb_build_object('error', 'invalid_invite_code');
  end if;
  insert into public.household_members (household_id, user_id, status, joined_at) values (v_id, v_me, 'pending', null);
  return jsonb_build_object('id', v_id, 'name', v_name);
exception when unique_violation then
  raise exception 'already_member';
end $$;

-- What a pending member may know: the household's name and who will approve them.
create function public.my_pending_households() returns table (id uuid, name text, owner_name text)
language sql stable security definer set search_path = '' as $$
  select h.id, h.name, p.display_name
  from public.household_members me
  join public.households h on h.id = me.household_id
  left join public.household_members o on o.household_id = h.id and o.role = 'owner'
  left join public.profiles p on p.id = o.user_id
  where me.user_id = (select auth.uid()) and me.status = 'pending'
  order by h.name
$$;

-- Owner actions.

create function public.is_owner(p_household_id uuid) returns bool
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.household_members
    where household_id = p_household_id and user_id = (select auth.uid()) and role = 'owner'
  )
$$;

create function public.approve_member(p_household_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner(p_household_id) then
    raise exception 'not_owner';
  end if;
  update public.household_members set status = 'active', joined_at = now()
  where household_id = p_household_id and user_id = p_user_id and status = 'pending';
  if not found then
    raise exception 'no_request';
  end if;
end $$;

create function public.decline_member(p_household_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner(p_household_id) then
    raise exception 'not_owner';
  end if;
  delete from public.household_members
  where household_id = p_household_id and user_id = p_user_id and status = 'pending';
  if not found then
    raise exception 'no_request';
  end if;
end $$;

-- Deleting the membership row cascades to that member's presence events and away blocks in this household.
create function public.remove_member(p_household_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner(p_household_id) then
    raise exception 'not_owner';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'cannot_remove_self';
  end if;
  delete from public.household_members
  where household_id = p_household_id and user_id = p_user_id and status = 'active';
  if not found then
    raise exception 'not_member';
  end if;
end $$;

create function public.rotate_invite_code(p_household_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
begin
  if not public.is_owner(p_household_id) then
    raise exception 'not_owner';
  end if;
  loop
    begin
      update public.households set invite_code = public.new_invite_code()
      where id = p_household_id returning invite_code into v_code;
      return v_code;
    exception when unique_violation then
      -- collision: draw again
    end;
  end loop;
end $$;

-- Leaving (also: a pending member cancelling, and account deletion).

-- Internal: not callable by clients. An owner hands the household to the earliest-joined active member;
-- with no one left, the household (and its questions, pending requests, presence) is deleted.
create function public.depart_household(p_household_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_next uuid;
begin
  -- Locks the household so two members leaving at once can't each hand it to the other.
  perform 1 from public.households where id = p_household_id for update;
  if exists (
    select 1 from public.household_members
    where household_id = p_household_id and user_id = p_user_id and role = 'owner'
  ) then
    select user_id into v_next from public.household_members
    where household_id = p_household_id and user_id <> p_user_id and status = 'active'
    order by joined_at, user_id limit 1;
    if v_next is null then
      delete from public.households where id = p_household_id;
      return;
    end if;
    update public.household_members set role = 'owner' where household_id = p_household_id and user_id = v_next;
  end if;
  delete from public.household_members where household_id = p_household_id and user_id = p_user_id;
end $$;

create function public.leave_household(p_household_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.household_members where household_id = p_household_id and user_id = auth.uid()
  ) then
    raise exception 'not_member';
  end if;
  perform public.depart_household(p_household_id, auth.uid());
end $$;

-- Runs inside any auth user deletion (the delete-account function or the dashboard), before the cascades.
create function public.handle_profile_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid;
begin
  for v_household in select household_id from public.household_members where user_id = old.id loop
    perform public.depart_household(v_household, old.id);
  end loop;
  return old;
end $$;

create trigger profiles_depart_households before delete on public.profiles
  for each row execute function public.handle_profile_delete();

-- Grants (D59). postgres's default privileges give new functions EXECUTE to authenticated and service_role,
-- so internal ones are revoked explicitly: depart_household would let anyone remove anyone.
revoke execute on function public.depart_household(uuid, uuid), public.handle_profile_delete(), public.is_owner(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.can_see_presence(uuid, uuid, timestamptz), public.join_household(text),
  public.my_pending_households(), public.approve_member(uuid, uuid), public.decline_member(uuid, uuid),
  public.remove_member(uuid, uuid), public.rotate_invite_code(uuid), public.leave_household(uuid)
  from public, anon;
grant execute on function public.can_see_presence(uuid, uuid, timestamptz), public.join_household(text),
  public.my_pending_households(), public.approve_member(uuid, uuid), public.decline_member(uuid, uuid),
  public.remove_member(uuid, uuid), public.rotate_invite_code(uuid), public.leave_household(uuid)
  to authenticated, service_role;
-- join_attempts: no client access; service_role as for every table (0006).
grant select, insert, update, delete on public.join_attempts to service_role;
