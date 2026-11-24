# Backlog

Everything not yet built, highest priority first. Ideas not yet prioritized are marked *proposed*.
The current milestone's step-by-step plan lives in `docs/plan.md`; this file is the long-lived list.

## Milestone 0 — Weekend MVP
See the design doc: `docs/design.md`.

## Found in manual testing (2026-11-22)
All three fixed on 2026-11-23 (D60, D61, friendly geofence error); recheck on the next manual run.

## Found in the LLM-roommate simulation (2026-11-24)
- **The answer writer embellished** ("…so the kitchen should be free"). Fixed by D66 (facts-only writer plus output check); a paid eval run would confirm how often real lines now fall back to the template.

## After MVP (Jack's order, 2026-11-22)
- **Any time the Apple Developer account is bought:** remote push + TestFlight → real roommates. Independent of the list below.

1. **Tracing / observability** — every agent run's tool calls, latency, tokens, cost; viewable in a small dashboard. Prerequisite for serious evals.
2. **Simulated-roommate eval harness** — an LLM plays roommates with hidden schedules; the agent is scored on outcomes across many simulated days (τ-bench style). Top portfolio priority.
3. **Security follow-ups** — the review (2026-11-24) was fixed in D66–D73. Left:
   - Sign-up captcha (Supabase dashboard). Email confirmation is back on (2026-11-24); free accounts still make per-user limits weaker.
   - Invite codes don't expire (only rotation).
   - A declined user can keep re-requesting; `join_attempts` and `ask_admissions` are never pruned (cron delete of rows older than a day).
   - A removed member still reads the questions they asked and the replies.
   - Household accuracy counts hint that hidden events existed (unscored rows).
   - `supabase_admin` default privileges still grant anon EXECUTE on functions created via the dashboard/SQL editor.
4. **ETAs** — opt-in, rough "~20 min" from occasional coarse location samples.
5. **Calendar** — done (D76). Left: declined invites still count; add calendar personas to the simulation to measure it.
6. **Home-screen widget** — who's home at a glance (Swift target).
7. **Pattern statistics** — done (D74). Alternatives kept: stored nightly patterns; a statistical model. Review leftovers: near-term at-time questions ignore the current state (e.g. 18:55, away, 'home at 7?'); return lookahead jumps at midnight; DST-night return times off by an hour; spring-forward gap maps to the hour before.
8. **MCP server** — done locally (D75, `apps/mcp`). Next: hosted remote MCP with OAuth (no stored password).
9. **Siri / App Intents** — "Hey Siri, will Sam be home by 7?".

## Dropped
- "Tell me when ___ gets home / everyone's home" — see D11 in `decisions.md`.

## Stashed ideas
- Answer iMessage texts via a Shortcuts "message received" automation (verify feasibility).
- Packages / dinner / groceries / chores.
- Discord bot surface.
- Android — much later.
