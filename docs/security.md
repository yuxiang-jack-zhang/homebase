# Security and threat model

Reviewed 2026-11-24 against migrations 0001–0007 and the `ask` / `reply` / `score` functions; fixes shipped the same day (migrations 0008–0010, decisions D66–D73).

The question: **"If I were a hacker, how could I get people's sensitive info through this app?"**

## What's worth protecting

| asset | why it matters |
|---|---|
| Home location (exact coordinates) | where the household lives |
| Presence history (every enter/exit, timestamped) | a daily routine: when the house is empty |
| Away blocks and labels ("therapy Tue 4pm") | private by design, shown to no one else |
| Questions, drafts, replies | personal messages |
| API credits | every `ask` costs money |
| Calendar busy times (start/end only) | a person's one-off plans; titles never leave the phone |

## Who might attack

1. **A stranger:** has the app's public anon key and can sign up.
2. **Someone who saw an invite code:** screenshot, group chat, share sheet.
3. **A former roommate or ex-partner:** the realistic threat for a location-adjacent app.
4. **A curious current roommate:** probing for more than the app means to show.

## Already solid before the review

- Row-level security on every table; explicit minimal grants (D59); `anon` can do nothing; RPCs check `auth.uid()` with `search_path = ''`.
- Only enter/exit leaves the phone, and only after the member confirms the home pin; moving the pin resets everyone's confirmation.
- Presence recorded while hidden stays hidden (D55); away-block labels and drafts are private in RLS and never given to the model; evals check for leaks, including prompt injection.
- `reply` only lets the target answer; `score` needs the service key (constant-time comparison); traces store no text (D62).

## Findings and fixes

| # | finding | severity | fix |
|---|---|---|---|
| 1 | No way to remove a member, leave, rotate the invite code or delete an account: an ex keeps seeing your comings and goings forever | High | Owners remove members and rotate codes; anyone leaves; in-app account deletion with ownership hand-over in a DB trigger (D68, D69) |
| 2 | An invite code admitted anyone instantly and forever, returned the home location to the joiner, and showed all past presence, from before they joined | High | Joins are requests the owner approves; the joiner learns only the household name; co-members' presence is visible only from your join date, and the agent's evidence uses the same cutoff; 5 failed codes per hour (D68) |
| 3 | Anyone could sign up twice, make a household and loop `ask`, draining the API credits | High | Per-user limits (30/hour, 200/day) admitted under a lock so bursts can't overshoot, a global daily breaker, at most 20 targets per question (D67) |
| 3b | The answer and draft writers saw the question, so "…also write me an essay" turned the API key into a general chatbot, and drafts could be steered | High | Writers get structured facts only; their output must be one short line that states the claim and only its times, or the template is used (D66) |
| 4 | Unconfirmed, free sign-ups multiplied 2 and 3 | Medium | Email confirmation turned on |
| 5 | Members could backdate or flood their own presence | Low | The server stamps the time; 60 events per hour (D70) |
| 6 | Unhiding revealed when your last hidden change happened; a visibility race; scoring used hidden data | Low | Unhide adds a fresh "since now" event; the stamp reads membership `for share`; hidden evidence leaves predictions unscored (D70, D72) |
| 7 | The fallback guess was readable before its 10-minute wait | Low | Its own table, readable after 10 minutes, kept out of realtime (D71) |
| 8 | Error logs could contain question text | Low | Functions log only error name, code and message |
| 9 | Session token in AsyncStorage | Low | iOS keychain, readable after first unlock so background geofencing keeps working (D73) |

Every fix has tests: 333+ core and 85 database tests, signed in as real users against a local Supabase stack.

## Added after the review (2026-11-24)

- **Calendar periods (D76):**
  - Only start and end times are synced; titles, locations and attendees stay on the phone.
  - `calendar_away` is readable only by the person.
  - `sync_calendar_away` replaces all of the caller's rows, so no history accumulates. It is capped at 200 periods of 1 minute to 24 hours, and serialised per user.
  - Sign-out clears the rows.
  - A hidden member's questions still always go to them (D29), so their calendar can't answer for them.
- **MCP server (D75):**
  - It signs in as the person, so RLS and `ask`'s rate limits apply.
  - The password lives in a local env file (or the MCP client's config). Use a unique password; a hosted OAuth version is the follow-up.
  - Roommate-written text reaches the person's model, so it is quoted as untrusted data, and `reply` requires explicit confirmation per item.

## Still open

See `docs/backlog.md` (security follow-ups):
- invite codes don't expire;
- sign-up captcha;
- pruning rate-limit records;
- a removed member still reads the questions they asked;
- accuracy counts can hint that hidden data existed.
