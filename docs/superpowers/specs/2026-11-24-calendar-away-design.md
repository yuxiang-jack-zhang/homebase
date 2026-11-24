# Calendar busy/free as away evidence: design

Status: approved, 2026-11-24.

## Why

Most future questions ("will Sam be home at 7?") have no evidence unless the person keeps away blocks up to date, and habits only cover routine days. People already keep a calendar. A timed event in a calendar they say means "I'm away" (Work, Classes) is fresh, specific information about one day, which beats a weekly block or a habit learned from past weeks.

## Privacy

- **Only start and end times leave the phone.** Titles, locations, notes, attendees and the calendar's name stay on the device. The server cannot tell a dentist appointment from a shift.
- **The person chooses the calendars**, per device, in Settings. Nothing is read until they pick one, and iOS asks for calendar permission after a one-time explanation.
- **The asker never sees the periods.** Only the person can read their own rows (RLS); the `ask` edge function reads them with the service role, like presence. The writer still gets only the claim, so the asker learns "probably away until 5:00 PM", never that an event exists.
- **Clients can't write rows directly.** One RPC replaces the caller's future periods, with limits on count, length and how far ahead.
- Deleting the account deletes the rows (`on delete cascade` from `profiles`).

## Data flow

1. Settings: "Calendars that mean I'm away" lists the device's calendars as toggles. The selection is stored in AsyncStorage on the phone.
2. On app foreground and after the selection changes, the app reads those calendars' timed events for the next 14 days (all-day events are skipped: "Holiday", "Mom's birthday"), clips them to the window, merges overlaps, and calls `sync_calendar_away(p_periods)` with `[{ start, end }]`.
3. `sync_calendar_away` (security definer, `auth.uid()`) deletes the caller's rows that haven't ended yet and inserts the new list. Past rows are left alone. Bare error code `invalid_periods` for: more than 200 periods, a period shorter than 1 minute or longer than 24 hours, a start outside the next 15 days, or an end not after the start.
4. `evidence()` adds the target's periods overlapping the next 2 days as `awayPeriods`. Periods are per person, not per household: they apply in every household the person is in.

## Claims

New `basis: 'calendar'`, always medium confidence (so "answer if confident" answers it).

- **Future `at_time`:** a period covering the time → away. Checked before habits and blocks.
- **`until_when` while away:** a period covering now → back at that period's end. Checked before habits and blocks.
- **`now` and past questions:** unchanged, presence only.
- **Home now inside a period:** they skipped the event, so presence wins. `until_when` already answers "home" from presence; a future `at_time` inside that same period falls through to the existing logic instead of claiming away.

## Non-goals

- No Google Calendar or Outlook APIs, no OAuth, no server-side calendar access: the phone's calendar app already aggregates those accounts.
- No titles, locations or attendees, ever, not even for the person themself.
- No answering "now" from the calendar: presence is the truth for now.
- No background sync: foreground and selection changes are enough for a 14-day window.

## Alternatives considered

1. **Recurring away blocks only (status quo).** No new permission or data, but blocks go stale and can't express one-off days (a late shift this Thursday). Rejected as the only source; blocks stay as a fallback.
2. **Full calendar access server-side** (sync events with titles, or connect calendar accounts to the backend). Richer evidence (could tell "Dinner at home" from "Dinner out"), but it stores far more personal data at rest and needs OAuth per provider. Rejected: busy/free from chosen calendars is enough for home/away.
3. **Busy/free from chosen calendars, times only (chosen).**
