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
