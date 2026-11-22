# Manual test checklist

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
