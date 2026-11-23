# Backlog

Everything not yet built, highest priority first. Ideas not yet prioritized are marked *proposed*.
The current milestone's step-by-step plan lives in `docs/plan.md`; this file is the long-lived list.

## Milestone 0 — Weekend MVP
See the design doc: `docs/design.md`.

## Found in manual testing (2026-11-22)
All three fixed on 2026-11-23 (D60, D61, friendly geofence error); recheck on the next manual run.

## After MVP (Jack's order, 2026-11-22)
- **Any time the Apple Developer account is bought:** remote push + TestFlight → real roommates. Independent of the list below.

1. **Tracing / observability** — every agent run's tool calls, latency, tokens, cost; viewable in a small dashboard. Prerequisite for serious evals.
2. **Simulated-roommate eval harness** — an LLM plays roommates with hidden schedules; the agent is scored on outcomes across many simulated days (τ-bench style). Top portfolio priority.
3. **Security review / threat model** — "if I were a hacker, how could I get people's sensitive info through this app?" Jack wants to think this through after the build. Known items so far:
   - `join_household` has no rate limit; invite codes are 6 chars of 32 (~1.07e9), and a match grants presence visibility without owner approval.
   - Raw Postgres errors (bad radius → 23514, bad timezone) instead of named codes.
   - `supabase_admin` default privileges still grant anon EXECUTE on new functions; only matters for objects created via the dashboard/SQL editor.
   - No per-user rate limit on `ask`: a signed-in user can run up Claude cost.
   - `question_targets.fallback_guess` is readable by the asker immediately; the 10-minute wait is enforced only in the app UI.
   - Unhiding reveals the timestamp of the last change made while hidden (the "since" of the revealed latest event); consecutive same-kind visible events hint that something happened while hidden.
   - `score` judges predictions using hidden-period events (outcomes are visible only to the subject and in household aggregates).
   - Rare race: a geofence insert concurrent with an off→on visibility change can be stamped hidden (fix: `for share` in the stamp trigger's membership read).
4. **ETAs** — opt-in, rough "~20 min" from occasional coarse location samples.
5. **Calendar** — iPhone calendar read on device; only busy/free blocks sent to the server.
6. **Home-screen widget** — who's home at a glance (Swift target).
7. **Pattern statistics** — learned arrival/departure patterns from presence history.
8. **MCP server** — expose household tools so any MCP client can ask "is Sam home?".
9. **Siri / App Intents** — "Hey Siri, will Sam be home by 7?".

## Dropped
- "Tell me when ___ gets home / everyone's home" — see D11 in `decisions.md`.

## Stashed ideas
- Answer iMessage texts via a Shortcuts "message received" automation (verify feasibility).
- Packages / dinner / groceries / chores.
- Discord bot surface.
- Android — much later.
