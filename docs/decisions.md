# Decision log

Each entry: **context → options (pros/cons) → decision → why → revisit if**. Newest at the bottom.
Each entry is dated; all decisions are Jack's.

---

## D1. Mobile framework: Expo (React Native) — 2026-11-22, Jack
**Context:** iPhone app that needs background geofencing, actionable notifications, eventually a widget.
**Options:**
- *Expo / React Native* — + TypeScript/React matches target postings (Sierra lists React/TS); + Jack already knows it; + Android later nearly free; − widget needs a native Swift target; − background location needs a dev build, not Expo Go.
- *Native Swift* — + best access to every iOS API; − learning Swift during a one-weekend build; − off-target for the postings; − no Android path.
- *PWA* — + no install; − iOS web apps can't track location in the background. Disqualifying.
**Decision:** Expo. **Why:** the only disqualifier-free option that matches Jack's skills and the roles. **Revisit if:** background geofencing in Expo proves unreliable on device.

## D2. Q&A lives in the app, not Discord — 2026-11-22, Jack
**Context:** questions could be asked in a Discord bot (where friends already are) or in the app.
**Options:** *Discord bot + app for location* — + no new chat habit; − two surfaces, an extra integration, and everyone installs the app anyway. *All in-app* — + one install, lock-screen quick replies, full control of the ask→escalate→reply loop; − competes with the iMessage habit.
**Decision:** all in-app. **Why:** location already forces the install, which removes Discord's main advantage. **Revisit if:** usage shows people keep asking in iMessage instead (→ iMessage/Shortcuts idea).

## D3. Backend: Supabase over Neon + Vercel — 2026-11-22, Jack
**Context:** open sign-up in a weekend needs auth, Postgres, realtime, server functions.
**Options:** *Neon + Vercel* (Jack's market-dashboard stack) — + familiar; − auth and realtime hand-wired. *Supabase* — + auth, Postgres with row-level security, realtime, edge functions in one; + local stack in Docker for tests; − new to Jack; − edge functions run on Deno, a slightly different runtime. *Firebase* — + mature mobile SDKs; − NoSQL makes the prediction/scoring queries awkward; − security rules less testable than SQL RLS.
**Decision:** Supabase. **Why:** saves most of a day on auth + realtime, and RLS gives the privacy anti-goal a testable, database-level enforcement. **Revisit if:** Deno edge functions block the Anthropic SDK or shared-package imports.

## D4. Raw location never leaves the phone — 2026-11-22, Jack
**Context:** privacy anti-goal.
**Options:** *send coordinates, compute home/away on server* — + one place for logic, enables ETAs easily; − server holds everyone's location history, a liability and a trust killer. *geofence on device, send only enter/exit* — + strong, explainable privacy claim; − ETAs later need a separate coarse-location opt-in.
**Decision:** on device. **Why:** the privacy claim is the product's main edge over Find My. **Revisit if:** never for the default; ETAs get their own opt-in.

## D5. Visibility and answer mode are separate settings — 2026-11-22, Jack
**Context:** the builder check found a contradiction: a public who's-home list makes "ask me first" for "are you home?" pointless nagging.
**Decision:** *visibility* controls the live home/away; *answer mode* controls what the agent may say about the future. **Why:** each setting answers one question, so neither undermines the other.

## D6. The guardrail is code, not prompt — 2026-11-22, Jack
**Context:** the agent must not answer for someone in `ask_me`, or answer confidently on weak evidence.
**Options:** *instruct the model in the prompt* — + simple; − models occasionally ignore instructions; untestable without the model. *enforce in the `answer_asker` tool handler* — + deterministic, unit-testable, holds even if the model misbehaves; − slightly more code.
**Decision:** enforce in code. **Why:** privacy rules must hold 100% of the time; prompts get you ~99%. This is the standard guardrail pattern.

## D7. Confidence from rules; the LLM handles language — 2026-11-22, Jack
**Context:** someone has to decide how sure the agent is.
**Options:** *ask the model for a confidence* — + flexible; − LLM self-reported confidence is poorly calibrated and hard to test. *rules over the evidence* — + testable, explainable, calibratable against the prediction log; − less flexible; rules must grow with new evidence sources.
**Decision:** rules decide confidence; the model resolves who/when/what and phrases the answer. **Why:** testability and calibration are the portfolio story. **Revisit if:** pattern statistics arrive — then confidence can become a learned probability.

## D8. No fine-tuning — 2026-11-22, Jack
**Why:** no labelled data at launch, the task is small, and evals + calibration show more skill for these roles than a fine-tune would. **Revisit if:** the eval set shows a persistent failure class prompting can't fix.

## D9. Tests first for logic and privacy, manual checklist for native — 2026-11-22, Jack
**Context:** Jack asked for a test-first workflow.
**Decision:** test-first for `packages/core`, RLS, edge-function tool handlers, and the eval set; a manual simulator/phone checklist for geofencing, notifications and UI. **Why:** unit tests on native integrations mostly test mocks; the time is better spent on the logic that defines the product.

## D10. Backlog in its own file, separate from the plan — 2026-11-22, Jack
**Options:** *backlog section inside `plan.md`* — + one file; − the plan is rewritten every milestone, so the backlog keeps getting churned and buried. *separate `backlog.md`* — + long-lived, Jack reorders it without touching the active plan; − one more file to keep in sync.
**Decision:** separate file. **Why:** different lifetimes: the plan lives for one milestone, the backlog for the whole project.

## D11. Drop "tell me when ___ gets home" — 2026-11-22, Jack
**Context:** arrival alerts were proposed for the planning use case.
**Objection:** if you're home, you hear roommates arrive. **Analysis:** true; the alert only adds value when you're away, and ETAs answer that case ("~20 min") without a new notification type.
**Decision:** dropped. **Revisit if:** real usage shows people repeatedly asking "is X back yet?" while away.

## D12. Post-MVP order: tracing before simulated-roommate evals — 2026-11-22, Jack
**Why:** simulated runs are only debuggable if every agent run's tool calls, latency and cost are already recorded; tracing is standard practice and a prerequisite. MCP and Siri moved to the bottom.

## D13. Agent shape: two-step pipeline, not a tool loop (yet) — 2026-11-22, Jack (changes the approved design)
**Context:** the design said "Claude with tool use" (get_presence, get_away_blocks, answer_asker, ask_roommate). Writing the plan exposed that, per target, the agent *always* needs exactly the same two pieces of evidence, so letting the model choose tools adds nothing.
**Options:**
- *Tool loop (model picks tools each turn)* — + "agentic" on paper; − 2–4 round trips of latency per answer; − nondeterministic paths are harder to test; − the model sees evidence for members it may not be allowed to talk about.
- *Two-step pipeline* — step 1: Claude parses the question (kind + time) with structured output; code gathers evidence, computes confidence and the send decision; step 2: Claude words the answer or the roommate's draft. + fast (2 calls, small); + every branch unit-testable with a fake model; + the model never decides anything privacy-relevant; − less flexible when more evidence sources arrive.
- *Managed Agents* (Anthropic-hosted agent loop + sandbox) — + no loop to host; − per-session container and runtime billing for a 2-second Q&A; − our data lives in Supabase, so every tool call round-trips anyway. Overkill.
**Decision:** two-step pipeline (confirmed by Jack). **Why:** Anthropic's own guidance is to use the simplest tier that works and reach for agent loops only when the path can't be specified in advance. Here it can. **Revisit if:** ETAs/calendar/patterns arrive and the evidence needed starts to depend on the question (e.g. only fetch travel time for "how long till you're back") — that's when a tool loop earns its latency.

## D14. The asker picks the target in the UI — 2026-11-22, Jack
**Options:** *model resolves names from free text* — + natural; − nicknames/duplicate names cause wrong-person answers, a privacy bug. *target chips (a person, or Everyone) + free text* — + zero ambiguity, no extra model call; − one extra tap.
**Decision:** chips. **Why:** a wrong-person answer leaks someone's whereabouts; one tap is cheap insurance.

## D15. One agent run per target, scoped to that target's data only — 2026-11-22, Jack
**Context:** "anyone home?" covers members with different privacy settings.
**Decision:** each targeted member gets an independent run that sees only that member's evidence; code assembles the combined answer. **Why:** the model can't leak member B's schedule into an answer about member A if it never sees B's data. Isolation beats instructions.

## D16. One household per user (MVP) — 2026-11-22, Jack
**Options:** many-to-many — + people with two homes; − every query and screen needs a "which household" context. one-to-one — + simpler RLS, UI and tests; − can't belong to two households.
**Decision:** one-to-one, enforced by `unique(user_id)` on `household_members`. **Revisit if:** anyone actually asks.

## D17. Auth: email + password — 2026-11-22, Jack
**Options:** *magic link* — + no password; − needs deep-link setup and email deliverability on day one. *Sign in with Apple* — + best iOS UX; − needs the paid developer account. *email + password* — + works in the simulator immediately; − users manage a password.
**Decision:** email + password. **Revisit when:** the developer account is bought → add Sign in with Apple.

## D18. Database tests: Vitest + supabase-js against the local stack, not pgTAP — 2026-11-22, Jack
**Options:** *pgTAP (SQL tests via `supabase test db`)* — + fast, idiomatic Postgres; − tests SQL directly, not the path the app uses; another language to learn. *Vitest + supabase-js signed in as real test users* — + tests exactly what the app can and can't do; same language and runner as everything else; − slower, needs `supabase start` running.
**Decision:** Vitest + supabase-js. **Why:** the privacy claim is "a signed-in roommate can't read X", so test it as a signed-in roommate.

## D19. Settings and home changes only through RPC functions — 2026-11-22, Jack
**Context:** a plain row-level UPDATE policy on `household_members` "where user_id = me" would also let a member promote themselves to `owner`.
**Decision:** no direct UPDATE policies on `households`/`household_members`; changes go through `security definer` functions (`update_my_settings`, `update_home`, `confirm_home`) that touch only the allowed columns. **Why:** column-level intent is clearer and testable in a function than in RLS.

## D20. Shared logic in `packages/core`, imported by both Node and the Deno edge functions — 2026-11-22, Jack
**Options:** *copy code into `supabase/functions/_shared`* — + guaranteed to bundle; − two copies drift. *one package, relative imports with explicit `.ts` extensions + a Deno import map for `@anthropic-ai/sdk`/`zod`* — + single source of truth; − must confirm the Supabase bundler follows imports outside `supabase/functions`.
**Decision:** one package; Task 1 includes a spike that proves the edge function bundles it. **Fallback if the spike fails:** a sync script copies `packages/core/src` into `_shared/core` (logged as a new decision).

## D21. Default model: Claude Opus 5.5 at low effort, compared in evals — 2026-11-22, Jack
**Context:** short, latency-sensitive calls (parse a sentence, write one line).
**Decision:** `claude-opus-5-5`, `effort: "low"`, server-side refusal fallback enabled. The eval task compares it against `claude-sonnet-5-5` and `claude-haiku-5-5` on accuracy, p50/p95 latency and cost per question, and the winner becomes the default (logged then). **Why:** start from the most capable current model and let measurements, not guesses, justify downgrading.

## D16 (revised). Many households per user — 2026-11-22, Jack
**Supersedes** the original D16 (one household per user). **Jack's call:** people do belong to more than one household (e.g. a college apartment and their family home).
**Consequences:** `household_members` loses `unique(user_id)`; every RPC, the `ask` request and presence events carry a `household_id`; the phone registers one geofence region per household (iOS caps an app at 20 regions); the app gets a household switcher. **Privacy check added:** a roommate who shares only household B must not see your presence events from household A (tested in Task 3).

## D13 confirmed — 2026-11-22, Jack
Two-step Claude pipeline approved.

## D22. Branch instead of a git worktree for the MVP — 2026-11-22, Jack
**Options:** *worktree* (the subagent workflow's default) — + isolates work from `main`; − a second checkout path breaks Supabase's local project (Docker volumes and config are keyed to the folder) and doubles Expo's native build dirs. *a `mvp` branch in the same checkout* — + one path for Docker/Expo; − no isolation, but the repo is brand new with nothing else on `main` to protect.
**Decision:** `main` holds only the docs; all build work happens on branch `mvp`.

## D23. Future-timestamp guard on `presence_events` is a CHECK, not a trigger — 2026-11-22, Jack
**Context:** a phone with a wrong clock must not insert events far in the future, which would shadow real ones in `current_presence`.
**Options:** *`check (at <= now() + interval '1 minute')`* — + declarative, visible in the schema, one line; − `now()` in a CHECK is non-immutable, so it is evaluated only on insert/update and a dump restore re-checks old rows against the later clock (still true for past rows). *BEFORE INSERT trigger* — + explicit error message; − more code for the same effect.
**Decision:** CHECK. **Why:** events are append-only, so insert-time evaluation is the only time it matters. **Revisit if:** events become updatable or restores start failing.

## D24. RLS cross-table checks go through `security definer` helper functions — 2026-11-22, Jack
**Context:** several policies need another protected table: `household_members` checking membership in `household_members`, `questions` ↔ `question_targets` checking each other. Inline subqueries re-enter the other table's RLS, which recurses (Postgres errors with "infinite recursion detected in policy").
**Options:**
- *Inline subqueries* — + everything visible in the policy; − recursion on the self/mutual cases; − each row re-runs nested RLS.
- *Helpers in a non-exposed `private` schema* — + not callable over the API; − extra schema grants for `authenticated`, more setup.
- *Helpers in `public` (`is_member`, `shares_household`, `can_see_presence`, `asked_question`, `targeted_by_question`), `security definer set search_path = ''`* — + no recursion, one definition of "member" reused by policies and RPCs; − callable via `/rpc`.
**Decision:** helpers in `public`, each answering only about the caller (`auth.uid()`). EXECUTE on every `public` function is revoked from `anon`, and default privileges for `postgres` are changed so functions added by later migrations aren't anon-callable either.
**Why:** no recursion, one definition of "member" shared by policies and RPCs, and because each helper answers only about the caller, calling it over the API reveals nothing the caller can't already read — so the `private` schema's extra grants buy nothing.
**Revisit if:** a helper ever needs to answer about someone other than the caller — then move helpers to a `private` schema.

## D25. DB test harness: fresh users per test, keys read from the running stack — 2026-11-22, Jack
**Context:** D18 tests run as real signed-in users against local Supabase.
**Options:** *shared fixture users + cleanup between tests* — + fewer auth calls; − order-dependent, leaks state between tests. *every test creates its own users (`<name>-<uuid>@example.com`) and households via the real RPCs, no cleanup* — + tests are independent and can run in parallel; − a few hundred ms of setup each; DB fills up until the next `supabase db reset`.
**Decision:** fresh users per test. Service-role writes stand in for the edge functions. URL and keys come from `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` or `npx supabase status -o env`, never from committed files. The `db` Vitest project lives in `vitest.db.config.ts`, referenced from the root config.
**Why:** independent tests can't pass or fail because of another test's leftovers, and going through the real RPCs means the setup itself exercises them; the extra seconds are cheap at this suite size. Reading keys from the running stack keeps the public repo free of secrets.
**Revisit if:** the suite gets slow enough to matter.

## D26. `household_accuracy` aggregates every member's predictions — 2026-11-22, Jack
**Context:** predictions are row-readable only by the predicted-about user, but the stats screen shows household accuracy.
**Options:** *per-user stats only* — + strictly private; − tiny samples, the stats screen says little. *household-wide counts via a `security definer` RPC* — + meaningful numbers; − members learn aggregate counts that include others' predictions (no times, states or names).
**Decision:** household-wide counts per kind, members only (`not_member` otherwise); pending predictions (no outcome yet) aren't counted.
**Why:** the stats screen exists to show the agent's calibration, which needs the household's sample; bare counts per kind carry no times, states or names, so they reveal far less than the row-level data RLS protects.
**Revisit if:** small households make the counts identifying (e.g. a two-person household where your own counts reveal the other person's).

## D27. Away-block time math uses wall-clock minutes, not a date library — 2026-11-22, Jack
**Context:** blocks are recurring local-time windows (`"HH:MM"`, days of week) that can cross midnight, and core must run unchanged in Node and Deno with no dependencies.
**Options:** *a date library (Temporal polyfill, date-fns-tz)* — + handles zones and DST for us; − a dependency in code shared with Deno. *`Intl.DateTimeFormat` to read local wall-clock parts, then do all comparisons as "minutes since epoch as if local were UTC"* — + dependency-free, midnight crossing is just checking today's and yesterday's occurrence, `getUTCDay` gives the weekday; − local→UTC needs a guess-and-correct step, and ambiguous or skipped wall-clock times (DST fall back or spring forward) resolve to one of the two valid instants (a repeated hour yields two candidates, a skipped hour none).
**Decision:** wall-clock minutes; local→UTC by trying the zone offsets in force within a day either side of `at` and taking the earliest instant strictly after `at` (preferring candidates that round-trip to the same wall clock), so `blockEndAfter` never returns a past instant in a repeated hour and an end inside a skipped hour lands just after the gap. Coverage is start-inclusive, end-exclusive, and `daysOfWeek` refers to the local day the occurrence starts.
**Why:** it keeps core dependency-free and the DST/midnight cases are covered by tests (Sat/Sun across the March change, a block ending after spring-forward). The ambiguous hour only matters for blocks that start or end inside the 1 h DST repeated/skipped hour, which is rare for household schedules.
**Revisit if:** blocks need to start or end between 01:00 and 03:00 on DST-change nights, or a second zone-aware feature appears.

## D28. `blockEndAfter` throws if the block does not cover the time — 2026-11-22, Jack
**Context:** the function promises the end of the occurrence covering `at`; a caller could pass a non-covering block.
**Options:** *return `at` or a null* — + no exceptions; − silently produces a wrong "back at" time. *throw* — + a programming error surfaces immediately; − callers must check coverage first.
**Decision:** throw. `buildClaim` only calls it with a block from `blockCovering` at the same instant.
**Why:** a made-up end time would be shown to a roommate as a prediction; failing loudly is safer.
**Revisit if:** a caller needs to probe without checking first.

## D29. Visibility off escalates every question about the member — 2026-11-22, Jack
**Context:** the brief only listed "visibility off → escalate" under now/history, but the design says an Off member "shows as '—' and every question about me escalates to me".
**Options:** *off only blocks now/history* — + matches the brief's literal bullet; − a future-looking auto answer would still leak presence-derived predictions. *off blocks every claim kind and timing, whatever answerMode* — + one rule, no leak; − a member with visibility off and `always_auto` still gets asked.
**Decision:** `decide` checks visibility right after the null-claim check; off → escalate (`unknown` if household-wide).
**Why:** the design doc is the product contract and predictions are derived from the same presence data the toggle hides.
**Revisit if:** members want "hide my status but let the agent answer future questions".

## D30. Scoring window, tolerance and feedback edge rules — 2026-11-22, Jack
**Context:** the brief left boundaries and null cases open.
**Options:** *exclusive bounds / strict tolerance* — + none; − arbitrary, and an event exactly at a boundary is real evidence. *inclusive `[createdAt − 48h, now]` and `|a − predictedTime| ≤ tolerance`* — + simple to state; − none notable.
**Decision:** inclusive on both ends, checked first; missing inputs (null aboutTime/predictedState/predictedTime) score `unscored`. `classifyFeedback`: approve → approved and text → edited whatever the claim; yes/no judged only for `now`/`at_time` with a predicted state, else null. ISO strings are compared with `Date.parse`, never string order.
**Why:** an unjudgeable prediction should stay out of accuracy stats rather than count as wrong; text/approve say something about the draft even without a claim.
**Revisit if:** accuracy stats show the 30 min tolerance is too tight or loose.

## D31. Future claims with no prediction never get an answer — 2026-11-22, Jack
**Context:** a future claim with no predictedState and no predictedTime (Task 4's "none" claim), or an `at_time` with no aboutTime, reached the answer-mode switch; `always_auto` then answered with nothing behind it, and `auto_when_confident` was safe only because that claim happens to be low confidence.
**Options:** *gate only on confidence* — + no new rule; − answers without evidence under `always_auto`, depends on an upstream accident. *escalate when there is no prediction* — + consistent with `fallbackAllowed`; − `always_auto` members would be pinged though they chose not to be. *`unknown` for `always_auto`, escalate otherwise* — + respects "never ping me" and still never invents an answer; − the asker gets no answer.
**Decision:** with no prediction (or `at_time` with null aboutTime): `ask_me` and `auto_when_confident` escalate* ; `always_auto` returns `unknown` regardless of householdWide. Claims with a prediction behave as before.
**Why:** an always_auto member chose never to be pinged and there is nothing to answer with, so "unknown" is the only honest reply.
**Revisit if:** members want to be asked even in always_auto when the agent has nothing.
