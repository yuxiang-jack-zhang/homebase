-- Seeds 3 past at_time predictions (2 enter-evidenced home, 1 predicted away) for member :hid's first member.
-- Run with: psql -v hid=<household uuid> -f seed.sql. Evidence: the member entered home 3h ago and never left.
select set_config('seed.hid', :'hid', false);
do $$
declare hid uuid := current_setting('seed.hid')::uuid; uid uuid; asker uuid; q uuid; t uuid; i int;
begin
  select user_id into uid from household_members where household_id = hid order by joined_at limit 1;
  asker := uid;
  insert into presence_events (household_id, user_id, kind, at) values (hid, uid, 'enter', now() - interval '3 hours');
  for i in 1..3 loop
    insert into questions (household_id, asker_id, text, kind) values (hid, asker, 'seed home at 7? #' || i, 'at_time') returning id into q;
    insert into question_targets (question_id, user_id, status) values (q, uid, 'answered') returning id into t;
    insert into predictions (question_target_id, user_id, kind, about_time, predicted_state, confidence, source, created_at)
      values (t, uid, 'at_time', now() - interval '1 hour', case when i = 3 then 'away' else 'home' end, 'medium', 'agent_auto', now() - interval '2 hours');
  end loop;
end $$;
