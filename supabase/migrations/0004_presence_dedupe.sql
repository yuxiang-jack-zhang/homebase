-- Region monitoring re-fires the current state on every registration, and clients can race.
-- Skip (silently) an event that repeats my latest kind in that household.
create function public.skip_repeat_presence() returns trigger
language plpgsql as $$
begin
  if new.kind is not distinct from (
    select kind from public.presence_events
    where household_id = new.household_id and user_id = new.user_id
    order by at desc, id desc limit 1
  ) then
    return null;
  end if;
  return new;
end $$;

create trigger presence_events_skip_repeat before insert on public.presence_events
for each row execute function public.skip_repeat_presence();
