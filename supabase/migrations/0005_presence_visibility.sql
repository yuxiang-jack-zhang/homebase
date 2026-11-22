-- Presence recorded while a member is hidden stays hidden from co-members after they turn visibility back on (D55).
-- Each row carries the member's visibility at the time it was recorded; turning visibility on reveals only the latest row.

alter table public.presence_events add column visible bool not null default true;

-- Existing rows of members who are hidden right now: we can't know when they hid, so keep all of it hidden.
update public.presence_events e set visible = false
from public.household_members m
where m.household_id = e.household_id and m.user_id = e.user_id and not m.visibility;

-- Always overwrite whatever the client sent. security definer: reads household_members without its RLS.
create function public.stamp_presence_visible() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.visible := coalesce((
    select visibility from public.household_members
    where household_id = new.household_id and user_id = new.user_id
  ), false);
  return new;
end $$;

-- Same-timing triggers fire by name, so presence_events_skip_repeat (0004) runs first and this stamps only rows it keeps.
create trigger presence_events_stamp_visible before insert on public.presence_events
for each row execute function public.stamp_presence_visible();

-- Co-members see a row only if it was recorded visible (and the member is visible now, via can_see_presence); own rows always.
-- current_presence is security_invoker, so this filter applies before its DISTINCT ON: co-members get the latest visible row.
drop policy "read own or visible co-members' presence" on public.presence_events;
create policy "read own or visible co-members' presence" on public.presence_events
  for select to authenticated using (
    public.can_see_presence(household_id, user_id) and (visible or user_id = (select auth.uid()))
  );

-- Off -> on reveals the current state (the latest event) only; history recorded while hidden stays hidden.
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
    update public.presence_events set visible = true
    where id = (
      select id from public.presence_events
      where household_id = p_household_id and user_id = auth.uid()
      order by at desc, id desc limit 1
    );
  end if;
end $$;

-- The who's-home list hears settings changes (a roommate hiding or unhiding). RLS limits events to my households' members.
alter publication supabase_realtime add table public.household_members;
