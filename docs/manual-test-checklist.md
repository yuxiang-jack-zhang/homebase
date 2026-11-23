# Manual test checklist

## Running it against the hosted project (simplest)

The per-section "Setup" notes below are for a local stack. Against hosted, none of them apply:
- `apps/mobile/.env` points at the hosted project URL and anon key. Run all commands from the repo, never from `~` (`npx supabase start` there creates a stray project).
- Build once with `npx expo run:ios` in `apps/mobile` (needs Xcode 26.4+ for Expo SDK 58, and CocoaPods). Metro must stay running while you test.
- Xcode 27 replaced Simulator.app with **Device Hub** (`open -b com.apple.dt.Devices`).
- **iOS 27 simulators always report geofencing as unavailable** (Apple bug; real devices and iOS 26 simulators work). Use an iOS 26 simulator for the geofence section; the watcher can be any version.
- Stats seed on hosted: run `supabase/tests/seed-stats-predictions.sql` with `npx supabase db query --remote --yes` after replacing `:'hid'` with the household id, then POST to `score` with the project's **secret** key (`sb_secret_…`; the legacy service_role JWT gets 403).

Last full run: 2026-11-22, hosted, all sections passed (stats empty state and household switch not rechecked). Issues found are in `docs/backlog.md` under "Found in manual testing".

## Mobile: auth, households, confirm home, settings (Task 9)

Setup: `npx supabase start`; copy the API URL and anon key into `apps/mobile/.env` as `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` (see `.env.example`). A physical phone needs the Mac's LAN IP in the URL, not 127.0.0.1. Run `npx expo run:ios` in `apps/mobile` (react-native-maps needs a development build, not Expo Go). For a simulator, set a location via Features > Location.

- [ ] Sign up user A (display name, email `a@example.com`, password) in simulator 1; land on "Your household".
- [ ] A: invalid radius (49 or 501) disables the create button; creating with a name and "Use my current location as home" asks for location permission once, then lands on Settings with A's household in the header.
- [ ] A: Settings shows the invite code and Share; no "confirm home" screen for the creator.
- [ ] Sign up user B in simulator 2. B enters a wrong code: friendly "doesn't match" error. B enters A's code: lands on "Is this your home?" with a pin and circle.
- [ ] B taps Confirm: lands on Settings. B has no "Move home" section; A does.
- [ ] B toggles visibility and picks each answer mode ("Ask me first", "Answer if confident", "Always answer"); force-quit and reopen: values persist.
- [ ] B adds an away block (Mon, Wed 09:00-17:00, label "Work"), then 22:00-06:00 (hint says overnight); both listed; delete one. Invalid time ("9am") shows an error.
- [ ] A moves home (Settings > Move home): B is sent back to confirm-home on next refresh/relaunch.
- [ ] B: "Create or join another household" creates a second household; header switcher swaps between them and remembers the choice after relaunch.
- [ ] Sign out returns to sign-in; sign back in restores the session state.

## Mobile: geofence and who's-home (Task 10)

Needs a development build (`npx expo run:ios` in `apps/mobile`); Expo Go cannot run background geofencing. Rebuild after any `app.json` change. Apply migration 0003 first (`npx supabase db reset`).

- [ ] With a confirmed home, the who's-home tab explains why "Always" is needed; "Allow Always" prompts (then opens Settings if already decided). After allowing, the explanation disappears.
- [ ] Set simulator 1 inside the home (`xcrun simctl location <device> set <lat>,<lng>`), open the app: your row shows "Home · since <time>"; simulator 2's list shows A as Home within a few seconds.
- [ ] Move simulator 1 outside the radius: simulator 2 flips A to "Away" within a few seconds.
- [ ] A turns visibility off in Settings: B sees "—" for A; A still sees own row, labelled "You".
- [ ] Force-quit A's app, move the simulated location across the boundary, reopen: the event was recorded (iOS relaunches the app for region events); check the row in B's list.
- [ ] Sign out on A, cross the boundary: no event is recorded, no crash. Sign back in: the list corrects itself on foreground.
- [ ] Note any geofence flakiness in `docs/decisions.md` (D48 Revisit).

## Mobile: ask, inbox, reply, local notifications (Task 11)

Needs a development build (`npx expo run:ios`). Two users A and B in one household; B's answer mode is "Ask me first". Local notifications only (no remote push), so B's app must be running (foreground or recently backgrounded).

- [ ] B opens the app: an explanation alert appears once, then iOS asks for notification permission. Allow.
- [ ] A, who's-home tab: Send is disabled until a person (or Everyone) and text are set. A asks B "are you home?": the answer appears under "Your questions" immediately.
- [ ] A asks B a future question ("will you be home at 7?"): A sees "Asked B — waiting…". B gets a banner while the app is open, and the Inbox tab shows the question with a suggested answer and Approve / Yes / No / Not sure / Reply.
- [ ] B taps Approve: the item leaves B's inbox; A sees the answer within seconds. B reloads the app: no repeat notification.
- [ ] A asks again; B long-presses the notification and taps Reply, types text, Send: A sees the text.
- [ ] A asks with a question that has no suggested answer: the notification and inbox show no Approve button.
- [ ] A asks and B does nothing for 10 minutes: A sees "No reply yet" and, when the server had one, a best guess line.
- [ ] B answers on one device after the other already did: "Already answered." and the item disappears.
- [ ] A never sees B's suggested answer, only the sent reply.

## Mobile: stats screen (Task 12)

Local stack up (`npx supabase start`), functions served with `ANTHROPIC_FAKE=1` (see `supabase/tests/README.md`; no billed model calls). Two users in one household.

- [ ] Empty state: Stats tab shows "Only future predictions count" and "No predictions yet."
- [ ] Seed: pick a household with a member (`H=$(docker exec supabase_db_homebase psql -U postgres -Atc "select household_id from household_members limit 1")`), then `docker exec -i supabase_db_homebase psql -U postgres -v hid=$H -f - < supabase/tests/seed-stats-predictions.sql`. It adds 3 past `at_time` predictions (home, home, away) and one "entered home 3h ago" presence event for that household's first member. Sign in as a member of that household in the app.
- [ ] Run score (fake model; functions served as in the README): `eval "$(npx supabase status -o env | grep -E '^(API_URL|SERVICE_ROLE_KEY)=')"`, then `curl -X POST "$API_URL/functions/v1/score" -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H 'Content-Type: application/json' -d '{}'`. Response is `{"scored":3}` on a fresh seed.
- [ ] Compare with SQL, same joins and household filter as the RPC: `docker exec supabase_db_homebase psql -U postgres -c "select p.kind, count(*) filter (where p.outcome='correct') correct, count(*) filter (where p.outcome='incorrect') incorrect, count(*) filter (where p.outcome='unscored') unscored from predictions p join question_targets t on t.id=p.question_target_id join questions q on q.id=t.question_id where q.household_id='$H' group by 1"`. On a fresh seed: at_time 2 / 1 / 0, so the screen shows "At a time: 67%" and Overall 67%. Pull to refresh (or switch tabs) to see it. Accuracy is c / (c + i), whole percent, "—" when c + i = 0.
- [ ] Switch household in the header: the numbers change to that household's with no flash of the old one's.
