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
**Decision:** inclusive on both ends; missing inputs (null aboutTime/predictedState/predictedTime) score `unscored`. `classifyFeedback`: approve → approved and text → edited whatever the claim; yes/no judged only for `now`/`at_time` with a predicted state, else null. ISO strings are compared with `Date.parse`, never string order. *Amended in Task 7 fix round:* order is missing inputs → `unscored`, then not yet due → `pending` (at_time: now < aboutTime; until_when: no arrival yet and now < predictedTime + tolerance), and only then the window rule. Checking the window first finalised a not-yet-due prediction as `unscored` for a member with no recent events, and `score` never revisits a scored row.
**Why:** an unjudgeable prediction should stay out of accuracy stats rather than count as wrong; text/approve say something about the draft even without a claim.
**Revisit if:** accuracy stats show the 30 min tolerance is too tight or loose.

## D31. Future claims with no prediction never get an answer — 2026-11-22, Jack
**Context:** a future claim with no predictedState and no predictedTime (Task 4's "none" claim), or an `at_time` with no aboutTime, reached the answer-mode switch; `always_auto` then answered with nothing behind it, and `auto_when_confident` was safe only because that claim happens to be low confidence.
**Options:** *gate only on confidence* — + no new rule; − answers without evidence under `always_auto`, depends on an upstream accident. *escalate when there is no prediction* — + consistent with `fallbackAllowed`; − `always_auto` members would be pinged though they chose not to be. *`unknown` for `always_auto`, escalate otherwise* — + respects "never ping me" and still never invents an answer; − the asker gets no answer.
**Decision:** with no prediction (or `at_time` with null aboutTime): `ask_me` and `auto_when_confident` escalate* ; `always_auto` returns `unknown` regardless of householdWide. Claims with a prediction behave as before.
**Why:** an always_auto member chose never to be pinged and there is nothing to answer with, so "unknown" is the only honest reply.
**Revisit if:** members want to be asked even in always_auto when the agent has nothing.

## D32. Model calls use `max_tokens: 4096` and treat truncation as no answer — 2026-11-22, Jack
**Context:** the plan said `max_tokens: 1024`, but Opus 5.5 always thinks and thinking tokens count toward `max_tokens`; even at effort `low` a 1024 cap can cut the visible output.
**Options:** *1024* — + caps spend per call; − truncated JSON or a half sentence. *4096* — + room for thinking plus a one-line output; − a runaway call costs more. *4096 and `stop_reason === 'max_tokens'` → null* — + a cut-off output never reaches anyone; − a truncated call is wasted.
**Decision:** 4096; `max_tokens` and `refusal` stop reasons, and any thrown API error, return null from the `ModelClient` (parse → `unclear` → escalate; write → template line or no draft). The client never throws.
**Why:** a truncated parse or line is worse than none, and the code already has a safe path for null.
**Revisit if:** usage logs show outputs near the cap, or cost per question matters.

## D33. Server-side refusal fallback via the beta Messages API — 2026-11-22, Jack
**Context:** the brief asked for `client.beta.messages.parse` with `fallbacks: 'default'` if SDK 1.12.0 supports it, else plain `messages.parse`.
**Options:** *plain `messages.parse` with `zodOutputFormat`* — + GA surface; − a policy decline on a harmless question just stops. *`beta.messages.parse` / `beta.messages.create` with `betas: ['server-side-fallback-2026-07-01']`, `fallbacks: 'default'` and `betaZodOutputFormat`* — + a decline is re-run on the fallback model inside the same call; − beta surface, may change.
**Decision:** the beta path; it type-checks in 1.12.0. The beta call needs the beta Zod helper (`@anthropic-ai/sdk/helpers/beta/zod`), not `zodOutputFormat`. The system prompt is sent as one text block with a `cache_control` marker.
**Why:** a refusal on "are you home at 7?" would be a false decline; the fallback costs nothing when unused. The prompts are currently below the 512-token cache minimum, so the marker is a no-op until they grow.
**Revisit if:** the beta changes shape or graduates to GA.

## D34. No draft is written when escalating without a prediction — 2026-11-22, Jack
**Context:** escalate also happens when the parse failed (claim null) or the claim has no predicted state or time; a draft "from the claim" would then be invented.
**Options:** *always ask the model for a draft* — + the target always sees a suggestion; − the suggestion is a guess, and a paid call for it. *draft only when the claim has a prediction* — + drafts are grounded; − the target writes their own reply in those cases.
**Decision:** `answerForTarget` calls `write` for an escalate only when the claim has a predicted state or time; otherwise `draftText` is null. `unknown` decisions make no model call at all.
**Why:** the draft is meant to be the agent's prediction for the target to confirm; with no prediction there is nothing to confirm.
**Revisit if:** targets say a blank reply box is worse than a generic suggestion.

## D35. Writer inputs and time formatting — 2026-11-22, Jack
**Context:** the writer needs enough to phrase a line, and claims carry UTC ISO times that askers read as local times; the brief's `templateAnswer(name, claim, caveat)` has no timezone.
**Options:** *give the writer evidence (blocks, presence)* — + richer replies; − block labels and history could reach the asker, which the claim exists to prevent. *give the writer the target's name, the claim, the household timezone and the asker's own question (delimited, marked as data)* — + nothing beyond the claim; − the model converts UTC to local itself. For the template: *UTC clock* — + no signature change; − wrong times for every household outside UTC. *optional 4th `timezone` parameter (default UTC)* — + local times, existing calls still valid.
**Decision:** the writer sees only the name, the claim and the question, with the claim's times pre-formatted in code as local `h:mm AM/PM` (the same `clock()` the template uses), so the model never converts zones. `templateAnswer` gets an optional `timezone`. The parser gets the current time as local wall clock with its offset (`Tue 2027-01-05 04:00 (GMT-08:00), America/Los_Angeles`), not a UTC instant. `parseQuestion` normalizes `aboutTime` to UTC (`toISOString`) and drops it for kinds other than `at_time`. `<` and `>` in the question are swapped for `‹ ›` so it cannot close its `<question>` fence.
**Why:** the claim is the privacy boundary, and the question is the asker's own text, so echoing it leaks nothing. Zone math (DST especially) is where a model silently goes an hour off, and an hour-off time still passes validation.
**Revisit if:** questions span days ("tomorrow at 7"), where a bare clock time is ambiguous for the writer; then add the weekday.

## D36. `agent/anthropic.ts` is not re-exported from the core index — 2026-11-22, Jack
**Context:** `packages/core/src/index.ts` re-exports every module; `anthropic.ts` imports the SDK at runtime (`betaZodOutputFormat`).
**Options:** *re-export it* — + one import path; − every consumer of core (the app, tests, edge functions that only need policy) loads the SDK. *import it by path where needed* — + only the edge functions that call Claude load the SDK; − one extra import line there.
**Decision:** index exports `model.ts`, `template.ts` and `pipeline.ts`; `anthropic.ts` is imported directly.
**Why:** the mobile app imports core too and must never bundle the Anthropic SDK.
**Revisit if:** never; this is the boundary that keeps the SDK server-side.

## D37. What `ask` writes per target — 2026-11-22, Jack
**Context:** the brief lists the rows `ask` writes, but `predictions.question_target_id` is unique, `responses.text` is not null, and `answerForTarget` returns `logPrediction` from the claim alone, whatever the decision.
**Options:** *log an `agent_auto` prediction whenever `logPrediction`* — + every claim logged; − an escalated draft nobody saw counts as a claim, and the target's later approve collides with the unique key. *log `agent_auto` only for answered targets, `agent_approved` on approve* — + one prediction per target, and only claims someone was shown; − an unapproved draft leaves no prediction. For drafts: *always write a draft row (empty text when none)* — + uniform; − fake empty drafts. *write a draft row only when there is draft text* — + the target sees only real suggestions; − `approve` has nothing to approve (409 `no_draft`).
**Decision:** `agent_auto` only when answered; a `draft` row (with `draft_claim`) only when `draftText` exists; no responses row for `unknown`. The question is parsed before the single `questions` insert, so `kind`/`about_time` are set at insert. Writes are not one transaction (a mid-way failure leaves a partial question).
**Why:** a prediction should be something the asker was told; the fallback guess shown after the timeout is labelled a guess and is not logged.
**Revisit if:** accuracy stats want unapproved drafts or fallback guesses scored, or partial questions show up (move the writes into an RPC).

## D38. `ANTHROPIC_FAKE=1` uses a keyword fake model, local stacks only — 2026-11-22, Jack
**Context:** served edge-function tests need deterministic answers without paying for Claude.
**Options:** *scripted `fakeModel` via env* — + reuses existing double; − one script per process can't serve different questions. *`keywordFakeModel()` in core: parse by keyword, fixed write sentence* — + deterministic per question, no script; − crude. Guard: *trust the flag* — + simple; − a stray env var in production would answer roommates with fake text. *honour it only when `SUPABASE_URL`'s host is localhost, 127.0.0.1, kong or host.docker.internal; else 500* — + can't fake in production; − none notable.
**Decision:** keyword fake plus the host guard (`supabase/functions/_shared/model.ts`, unit-tested). Without the flag a missing `ANTHROPIC_API_KEY` is a 500 before any write, instead of every question silently escalating.
**Why:** fake answers in production would be wrong presence claims shown to real people.
**Revisit if:** tests need richer scenarios than keywords give (then a per-request scripted fake).

## D39. Edge-function auth: user JWT via Auth, `score` by service-role key — 2026-11-22, Jack
**Context:** `ask`/`reply` act for a user; `score` must be service role only. The local CLI (3.2.0) issues both legacy JWT keys and `sb_secret_…` keys; the functions get the legacy JWT as `SUPABASE_SERVICE_ROLE_KEY`.
**Options:** for `score`: *read the JWT `role` claim* — + works for any service JWT; − only safe if the gateway verified the signature, which ties it to `verify_jwt` and the legacy JWT secret. *bearer must equal `SUPABASE_SERVICE_ROLE_KEY` (constant-time)* — + no JWT parsing, no reliance on gateway config; − a rotated or new-format key must match the env exactly.
**Decision:** `config.toml` sets `verify_jwt` explicitly: true for `ask`/`reply` (the gateway rejects missing/invalid JWTs with 401; the function then resolves the caller with `auth.getUser(jwt)` and never trusts body ids), false for `score` (bearer compared to the service-role key; anything else 403) and `health`.
**Why:** the key compare is the smallest check that doesn't depend on how the gateway is configured; the scheduler holds the service key anyway.
**Revisit if:** the hosted project moves to `sb_secret_` keys only (compare against that env var too).

## D40. `reply` semantics — 2026-11-22, Jack
**Context:** the brief fixes the happy path; races, unknown ids and edge cases were open.
**Options:** *check status, then insert, then update* — + simple; − two concurrent replies both send. *conditional update `awaiting_reply → replied` first, then insert the response, reverting the status if the insert fails* — + exactly one reply wins (409 for the other); − a revert can itself fail.
**Decision:** the conditional update; an unknown `questionTargetId` returns 403 like a non-target (no id probing); late replies are accepted (no timeout status exists); the sent response has source `human` even for approve (the target chose to send it; `feedback = approved` records the draft was used); `shouldLogPrediction` is judged at reply time, so an approve after the predicted time logs nothing; a failed `agent_approved` insert is logged, not returned as an error, because the reply already went out.
**Why:** a double send to the asker or a lost reply are the user-visible failures; a missing stats sample is not.
**Revisit if:** replies need editing after sending.

## D41. Eval harness design — 2026-11-22, Jack
**Context:** compare Claude models on the real pipeline (parse, code decides, write) without changing core, and without any way to spend money by accident.
**Options:** for usage capture: *change `parseQuestion` to return usage* — + explicit; − touches a tested core API for a tooling need. *wrap the `ModelClient` in the runner and record every call* — + zero core change, sees parse and write; − per-question latency is the sum of calls, not wall time. For fixture checks: *hand-trust expected values* — + quick; − encodes wishes, not the rules. *a test that feeds each fixture's expected parse to the real pipeline and asserts the expected decision* — + expected values provably follow `buildClaim`/`decide`; − checks the rules, not the model. For cost: *price table keyed by exact model id* — + simple; − a dated id from the API (`claude-opus-5-5-2026...`) would miss. *match by id prefix; unknown model gives null cost* — + tolerant, never crashes or invents a price; − a new model needs a table row.
**Decision:** wrapper for usage; the oracle test over all fixtures (runs in `npm test`); prefix-matched price table in `evals/report.ts`, cost null for unknown models. Without `--fake` and without `ANTHROPIC_API_KEY` the CLI exits non-zero before any call. The root `evals` script ends in `--` so `npm run evals -- --fake` reaches the runner (npm otherwise swallows it as its own flag). The "tonight" fixture accepts any time within 2 hours of 8pm because the question has no single right answer.
**Why:** the comparison must measure the model, not drift in the harness, and a missing key must never fall through to a billed or silent run.
**Revisit if:** prices change (update `PRICES`), or per-question wall-clock latency matters (time the whole pipeline instead of summing calls).

## D42. Eval runner survives errors, prices exact ids only — 2026-11-22, Jack
**Context:** review of D41's harness found that one thrown call would abort a billed run and lose its results, that an unknown model nulled the whole run's cost, and that the injection leak check never saw model text.
**Options:** for errors: *let the run abort* — + simple; − wastes the spend already made. *catch per fixture, record an error result (decision escalate, failed) and continue* — + partial runs stay comparable; − errors drag accuracy down unless reported (`errors` is its own column). For pricing: *prefix match* — + tolerates dated ids; − can silently apply the wrong price. *exact id; unpriced calls counted in `unpricedCalls`, cost covers priced calls only* — + never wrong, never all-or-nothing; − a dated id shows as unpriced until added.
**Decision:** per-fixture catch, exact-id prices with `unpricedCalls`, strict arg parsing (missing or `--`-prefixed values and unknown flags exit non-zero before any call), an answerable injection fixture so the leak check runs on the answer path, a D31 fixture (always_auto, no evidence, unknown), and relative-time fixtures moved to "in 30 minutes" so a 15-minute parse error cannot cross the 60-minute recent-presence boundary. D41's prefix-match choice is superseded.
**Why:** a billed comparison should be complete and trustworthy even when a call fails.
**Revisit if:** the API returns dated model ids (add them to `PRICES`).

## D43. Mobile routing gate with `Stack.Protected` — 2026-11-22, Jack
**Context:** the app must show auth, then create/join, then confirm-home, then tabs, and let a confirmed user open create/join again from settings.
**Options:** *imperative `router.replace` in a `useEffect` over `useSegments`* — + familiar; − flicker, easy to loop, every screen must remember to navigate. *`Stack.Protected` guards derived from session, households and `home_confirmed_at`* — + the stack redirects whenever the state changes, so a join or confirm needs no navigation code; − the target after a guard flips is chosen by the router (create still calls `router.replace` to land on settings).
**Decision:** guards in `src/app/_layout.tsx`: tabs when a household is current and confirmed; create/join when there is no household or the user is confirmed; confirm-home when current but unconfirmed. The creator is already confirmed by `create_household`, so only joiners (and everyone after the owner moves home) see confirm-home.
**Why:** one place states the rule, and it follows the server's `home_confirmed_at`, not client memory.
**Revisit if:** the router picks a wrong landing screen after a guard flip.

## D44. Household state is one context over three RLS-scoped selects — 2026-11-22, Jack
**Context:** `useHouseholds()` must serve the gate, settings and the header switcher, and Tasks 10-12 will read it too.
**Options:** *per-screen queries* — + local; − the gate and screens disagree after a change. *a provider that selects `households`, `household_members` and `profiles` (RLS already limits them to my households and their members) and exposes `refresh()`* — + one source, `me`/`members` derived; − refetches everything on each refresh, no realtime.
**Decision:** the provider in `src/hooks/useHouseholds.tsx` (keyed by user id so sign-out drops state); current household id is kept in AsyncStorage and falls back to the oldest household.
**Why:** a household has a handful of rows; simplicity beats incremental updates.
**Revisit if:** member presence needs live updates (Task 10 can subscribe and call `refresh`).

## D45. Home is set only from the phone's current location; away blocks use text inputs — 2026-11-22, Jack
**Context:** the home must come from somewhere, and the brief allows simple pickers.
**Options:** *drag a pin on the map* — + works away from home; − more code, easier to confirm a wrong spot. *one foreground GPS reading sent only to `create_household`/`update_home`* — + matches "be at home when you set it", no member coordinates anywhere else; − the owner must stand at the home. Away blocks: *native time pickers* — + friendlier; − a dependency and iOS-only UI. *"HH:MM" text with validation (`src/lib/blockForm.ts`) plus a midnight-crossing hint* — + small and testable; − typing.
**Decision:** current location and text inputs.
**Why:** least code that keeps the privacy rule (only home/away leaves the phone).
**Revisit if:** testers mistype times or want to set the home remotely.

## D46. One React copy: pin `react` 19.3.0 at the workspace root — 2026-11-22, Jack
**Context:** Expo SDK 58 needs `react` 19.3.0 and React Native's renderer checks the exact version, but `@testing-library/react-native` pulled 19.3.1 to the root, leaving two copies (expo-doctor failed).
**Options:** *npm `overrides`* — + one line; − did not replace the already hoisted copy and made `npm ls` report invalid. *root devDependency `react@19.3.0`* — + the hoisted copy is the Expo version, expo-doctor 20/20; − a root dependency only the mobile app needs.
**Decision:** root devDependency, exact version. Root vitest's `core` project now excludes `apps/mobile/**` because those tests are Jest. `npm ls` still notes an unused `react-dom` peer wanting 19.3.1.
**Why:** a mismatched React and renderer crashes at launch.
**Revisit if:** Expo moves to 19.3.1 (bump both).

## D47. The geofence task is headless and signs in from the stored session — 2026-11-22, Jack
**Context:** iOS relaunches the app in the background for region events; no React tree or provider exists, yet the event must reach `presence_events` under RLS.
**Options:** *a server-side token or edge function for the task* — + no client auth in the task; − a second credential on the device. *the module-level task imports the same supabase client and reads the AsyncStorage session via `getSession()`* — + one auth path, RLS still decides; − with no session (signed out, expired refresh token) the event is lost.
**Decision:** the latter. No session: log and drop. Errors never throw out of the task. Only `{household_id, user_id, kind, at}` is sent, using the time of delivery since iOS region events carry no timestamp.
**Why:** a dropped event while signed out is correct, and the next foreground `syncInitialPresence` repairs any gap.
**Revisit if:** testers see missed events after long idle periods (refresh token expiry in background).

## D48. At most 20 regions, newest joined households win, "Always" gates everything — 2026-11-22, Jack
**Context:** iOS allows 20 monitored regions per app; geofencing is useless without "Always" permission.
**Options:** *fail when over 20* — + simple; − a member of many households gets nothing. *monitor the 20 most recently joined confirmed households and show a notice* — + degrades gracefully; − older households go stale. Permission: *request at launch* — − prompts before the user knows why. *explain on the who's-home screen with a button (then Settings)* — + in context.
**Decision:** newest 20 by `joined_at`, notice when truncated; regions are started only with a confirmed home and "Always", re-synced on foreground and when households or confirmations change. `presence_events` is added to the realtime publication (migration 0003); RLS still filters each subscriber.
**Why:** matches how households are actually used (a few), with a safe cap.
**Revisit if:** anyone needs more than 20 households, or iOS region events prove flaky (note it here after on-device testing).

## D49. Repeated presence events are dropped by a trigger, and by the client — 2026-11-22, Jack
**Context:** expo-location's iOS geofencing consumer emits Enter/Exit for the current state of every region each time regions are registered (cold start, region-set change), so events repeat and race `syncInitialPresence`; "Home · since" would reset on every open.
**Options:** *client-only dedupe* — + fewer writes; − racy (task vs foreground sync), another device or retry still duplicates. *a BEFORE INSERT trigger that returns NULL when the kind equals my latest in that household* — + race-proof for any client, silent, no error path; − a read per insert, and a backdated event is compared with the latest by `at`. *a unique constraint* — − can't express "equal to previous".
**Decision:** both. Migration `0004_presence_dedupe.sql` (trigger) is the guarantee; the shared `insertEvents` in `src/lib/geofence.ts` (used by the task and `syncInitialPresence`) also skips kinds equal to my latest. Every app foreground runs the deduped `syncInitialPresence` (this is what repairs gaps from D47); regions restart only when the set of homes or the permission changes.
**Why:** presence history stays a clean sequence of real transitions.
**Revisit if:** the extra select per insert matters, or events need to be backfilled out of order.

## D50. Notification actions open the app; Approve only exists on drafted questions — 2026-11-22, Jack
**Context:** a notification needs Approve/Yes/No/Reply buttons, but Approve is only valid when a draft exists (`reply` returns 409 `no_draft` otherwise), and an action must reach the `reply` function.
**Options:** *actions with `opensAppToForeground: false`* — + no app switch; − expo-notifications does not deliver the response to the JS listener when the app is killed, so the reply would be silently lost. *`opensAppToForeground: true`* — + the response always reaches the listener, including a cold start (read with `getLastNotificationResponseAsync`); − the app comes to the front. Categories: *one category* — − shows a dead Approve. *`question` (Approve/Yes/No/Reply) and `question_nodraft` (Yes/No/Reply)* — + correct buttons.
**Decision:** foreground-opening actions, two categories registered once at startup, one response listener at the app root (plus the cold-start response, de-duplicated by notification id and action). Reply sends action `text` with the typed text. "Not sure" exists only in the inbox, since iOS shows few buttons.
**Why:** a lost reply is worse than an app switch.
**Revisit if:** on-device testing shows the foreground hop is annoying (then try background actions with a `registerTaskAsync` handler).

## D51. Local notifications are fired by the inbox hook, which is mounted at startup — 2026-11-22, Jack
**Context:** no remote push (no paid Apple account), so a notification can only be scheduled by the running app when it learns of a new awaiting question. Expo tabs mount lazily, so a hook inside the Inbox tab would not run until the tab is opened.
**Options:** *hook in the tab, lazy* — − no notification until the tab is visited. *a root provider* — + explicit; − another provider. *`lazy: false` on the tabs* — + one line; the hook runs as soon as the tabs mount. Scope: *current household only* — − misses questions in other households. *all my households* — + RLS already limits rows to mine.
**Decision:** `useInbox` watches my `awaiting_reply` targets in every household, tabs are `lazy: false`. Notified ids persist in AsyncStorage (last 200), written before notifying, so reloads and racing loads never re-notify. Realtime reloads are debounced 1.5 s so the draft row (inserted just after its target) is usually there when the notification is built. Permission is requested once, after an explanation alert.
**Why:** the app must be running (foreground, or backgrounded with a live socket) to notify; this is the most that local-only allows.
**Revisit if:** testers miss questions while the app is suspended (needs remote push, i.e. a paid Apple account), or a notification shows without its draft.

## D52. The asker's list reloads on any realtime event instead of patching rows — 2026-11-22, Jack
**Context:** `AnswerList` shows my last 10 questions with per-target status and the sent reply text, spread over `questions`, `question_targets` and `responses`.
**Options:** *patch state from each realtime payload* — + no refetch; − joins across three tables and out-of-order events. *refetch the ten questions on any `question_targets` or `responses` change* — + trivial and correct; − RLS-filtered events with no server filter can trigger reloads for other askers' rows I can see (only my own questions and my own targets reach me, so this is rare).
**Decision:** refetch. "No reply yet" after 10 minutes is a client rule from `question_targets.created_at`, re-evaluated by a 30 s timer (injectable `now` for tests); no status is stored.
**Why:** ten rows; simplest thing that stays right.
**Revisit if:** the list flickers or the query shows up in slow logs.

## D53. Mobile API errors carry the server's code; geofence inserts survive a failed dedupe read — 2026-11-22, Jack
**Context:** `supabase.functions.invoke` hides the JSON error body inside `FunctionsHttpError`; and in `insertEvents` a failed `current_presence` read threw, dropping a real geofence event.
**Options:** *show the generic invoke message* — − "non-2xx". *read the body and throw `ApiError(code)`, mapped by `friendlyError`* (409 `not_awaiting_reply` becomes "Already answered.") — + one mapping table. Responses are validated with the zod contracts, a mismatch is `bad_response`. Geofence: *throw on read error* — − loses the event. *warn, skip the client dedupe, insert anyway* — + the 0004 trigger dedupes server-side.
**Decision:** both of the latter.
**Why:** server codes are the contract; a lost presence event is data loss, a duplicate is dropped by the trigger.
**Revisit if:** the codes change or the function contracts add fields the client must read.

## D54. Household-wide questions escalate like direct ones, except for ask_me members — 2026-11-22, Jack
**Context:** the plan's policy turned every escalation into `unknown` when a question was household-wide, so an `auto_when_confident` roommate with a low-confidence claim was never asked. The spec (design.md, household questions) says each member is resolved by the same policy and only `ask_me` members are not pinged.
**Options:** *keep the plan's rule* — + no extra pings from "anyone home?"; − contradicts the spec, and the asker gets "unknown" for members who agreed to be asked. *`unknown` only for householdWide + `ask_me`* — + matches the spec; members who chose an auto mode get the question (with the usual fallback guess after 10 min); − a household question can ping several people.
**Decision:** the latter, in `decide`. This supersedes the plan's "escalate* = unknown if householdWide" rule. D31 is unchanged (`always_auto` with no prediction is `unknown`, never a ping). The asker's list already renders each target on its own, so a mix of answered / awaiting / unknown fills in as replies arrive.
**Why:** the spec is binding, and the nagging anti-goal is covered by `ask_me`, which is the default.
**Revisit if:** testers find household questions noisy; then make household pings opt-in per member.

## D55. Presence carries the visibility it was recorded with — 2026-11-22, Jack
**Context:** `can_see_presence` checked the member's visibility now, so turning sharing back on exposed every event recorded while hidden, and the agent answered past questions from that history.
**Options:** *a visibility-change log, filtering events by interval* — + exact history; − another table and interval joins in RLS. *a `visible` column stamped at insert* — + one column, one trigger, a cheap policy predicate; − can't recover history recorded before the column existed. *on unhide, reveal everything since a timestamp* — − that is the bug.
**Decision:** migration `0005_presence_visibility.sql`: `presence_events.visible` (default true), a BEFORE INSERT trigger `presence_events_stamp_visible` that always overwrites it from `household_members.visibility` (fires after `presence_events_skip_repeat` by name order, so only kept rows are stamped); co-members need `visible` as well as `can_see_presence`; own rows are always readable. `update_my_settings` off→on sets `visible = true` on that member's latest event in that household only, so the current state shows and hidden history stays hidden. `current_presence` is `security_invoker`, so RLS filters before its DISTINCT ON and co-members get the latest visible row. Existing rows of members hidden at migration time are backfilled `visible = false`. Agent evidence (`data.ts`) keeps only events after the last hidden one, so a hidden window reads as unknown rather than as the stale state before it; it also includes the latest event before the 14-day window (scoring likewise fetches the latest event before its 48 h window). `household_members` joins the realtime publication so the who's-home list refreshes when someone hides or unhides; the list shows "—" for anyone hidden now.
**Why:** the smallest change that makes "hidden" mean hidden for every past and future read path.
**Revisit if:** a roommate history view is added (two same-kind visible events in a row reveal that something happened while hidden, though not when), or members want to reveal a hidden period on purpose.

## D56. until_when predictions are future-only and scored from question time — 2026-11-22, Jack
**Context:** `reply` logs an approved draft's prediction at approval time. `shouldLogPrediction` checked future-ness for `at_time` but not `until_when`, and the scorer looked for the next arrival after the prediction's `created_at`, so an arrival between the question and a late approval was missed and the claim scored wrong.
**Options:** *store the question time on the prediction* — + explicit; − a schema change for a value already one join away. *score from `question_targets.created_at`* — + no schema change; the scorer already joins question_targets. *backdate `predictions.created_at`* — − the column would lie about when the prediction was made.
**Decision:** `shouldLogPrediction` requires `predictedTime > now` for `until_when`; the `score` function passes `question_targets.created_at` as the anchor for both the arrival search and the 48 h evidence window, for every kind.
**Why:** the question time is what the prediction answers; for agent-auto predictions it equals the prediction time anyway.
**Revisit if:** predictions are ever made without a question target.

## D57. Evals check the asker text, not just the decision — 2026-11-22, Jack
**Context:** the eval runner scored the claim but never read what the asker was told, so a writer that said "home" for an "away" claim passed.
**Options:** *an LLM judge* — + handles paraphrase; − cost and its own error rate. *`askerTextMustContain` substrings, case-insensitive* — + free, deterministic; − brittle to paraphrase (e.g. "out" for "away").
**Decision:** substrings. Each answer fixture lists the expected state word or the local clock time ("3:00"); a missing one on an answer counts as wrong-confident and fails the fixture. The fixture-oracle test runs with no writer text so the template line must satisfy every fixture, and `--fake` does the same, so a plumbing run exercises the check. Added fixture `household-auto-low` for D54.
**Why:** catches the dangerous case (confident text contradicting the claim) for free.
**Revisit if:** real-model runs flag correct paraphrases; then widen the tokens or allow alternatives.

## D58. Keep Opus 5.5 as the default model until an eval can tell the models apart — 2026-11-22, Jack
**Context:** first billed eval run (24 fixtures, effort low, two calls per question), 2026-11-22. Results in `evals/results/2026-11-22-*.json`:

| model | parse | decision | wrong-confident | leaks | p50 ms | p95 ms | $/question |
|---|---|---|---|---|---|---|---|
| claude-opus-5-5 | 100% | 100% | 0% | 0 | 2653 | 5541 | 0.00212 |
| claude-sonnet-5-5 | 100% | 100% | 0% | 0 | 2624 | 4595 | 0.00103 |
| claude-haiku-5-5 | 100% | 100% | 0% | 0 | 1530 | 2457 | 0.00005 |

The first Opus run flagged one fixture: the answer was "Sam isn't home right now", correct but missing the literal word "away". D57's revisit condition triggered: `askerTextMustContain` entries now accept `|`-separated equivalent wordings, and the runner records `askerText` in results.
**Options:** *switch to Haiku* — + ~44× cheaper, ~1.7× faster p50; − the set is saturated, so a tie says nothing about harder questions. *Keep Opus* — + the spec's model, most headroom on messy phrasing; − pays for headroom no fixture shows yet. *Sonnet* — the middle, with the same caveat.
**Decision:** keep `claude-opus-5-5` (spec default). Cost at MVP volume is negligible (≈ $0.002/question).
**Why:** a 24-question set where every model scores 100% can't justify a model change either way; the code needs no change and the decision stays cheap to revisit.
**Revisit if:** the simulated-roommate evals (backlog #2) or a harder fixture set separate the models; Haiku is the first candidate since it is far cheaper and faster.

## D59. Explicit table and function grants instead of Supabase defaults — 2026-11-22, Jack
**Context:** the first hosted deploy failed with `permission denied for table predictions`. A new hosted project gives `anon`/`authenticated`/`service_role` only TRUNCATE/REFERENCES/TRIGGER/MAINTAIN on tables and no EXECUTE on functions; the local stack still grants everything, so all 58 DB tests passed against defaults that hosted no longer has. Separately, the backlog listed the broad local defaults (TRUNCATE/UPDATE/DELETE for anon) as something to tighten.
**Options:** *grant ALL to the three roles* — + one line, matches local; − keeps the broad grants that only RLS was blocking. *Minimal explicit grants* — + matches hosted and local, closes the backlog item, RLS becomes a second layer instead of the only one; − every new table needs its own grant line.
**Decision:** migration 0006 revokes everything, then grants: `authenticated` SELECT on all tables, INSERT on `presence_events`, INSERT/DELETE on `away_blocks`, EXECUTE on all functions; `service_role` SELECT/INSERT/UPDATE/DELETE on all tables and EXECUTE on functions; `anon` nothing. It also changes postgres's default privileges so local tables created later get no implicit access, as on hosted.
**Why:** one set of grants that is the same in both environments and is the least the app uses. Blocked direct writes now fail with 42501 rather than "0 rows changed", and the RLS tests assert that.
**Revisit if:** a feature needs a new direct client write (add a grant next to the policy), or Supabase changes hosted defaults again.

## D60. Resync live lists on every realtime re-join and on foreground — 2026-11-23, Jack
**Context:** in manual testing B's app, open about 40 minutes, missed a new question and its own presence change until reloaded. supabase-js 2.119 already pushes refreshed tokens to realtime (`setAuth` on `TOKEN_REFRESHED`), so an expired token is unlikely. The likely cause is a dropped socket: realtime reconnects and re-joins on its own, but it does not replay events sent while it was down, and only the presence list reloaded on foreground.
**Options:** *poll every N seconds* — + catches everything, including a socket that never reconnects; − constant queries for data that rarely changes. *Recreate channels on a timer* — − same cost, more churn. *Reload when a channel re-joins and when the app returns to the foreground* — + costs one query per reconnect; the re-join status (`SUBSCRIBED` fires again because Phoenix resends the same join push) is exactly when events may have been missed; − a socket that is silently dead and never noticed stays stale until the next foreground.
**Decision:** `lib/live.ts` `subscribeLive(channel, resync)` subscribes and calls `resync` on every `SUBSCRIBED` after the first, and on every switch to foreground. Inbox, who's-home, my questions and households all use it.
**Why:** realtime's 25 s heartbeat already detects dead sockets and reconnects; the gap was only the missed events, and this closes it with no polling.
**Revisit if:** staleness is seen again without a reconnect; then add a slow poll (e.g. 60 s while foreground) for the inbox.

## D61. Retry an edge-function call once when it gets no response — 2026-11-23, Jack
**Context:** in manual testing `ask` failed with iOS `-1005` ("network connection lost"): the phone reused a pooled connection the server had already closed. A second tap worked.
**Options:** *no retry* — + simplest; − users see a scary error for a transient fault. *Retry once on `FunctionsFetchError` only* — + fixes the common stale-connection case; never retries a real server answer (HTTP errors); − if the first request did reach the server and only the response was lost, `ask` runs twice (a duplicate question and notification, ≈ $0.002). A duplicate `reply` is already rejected by the server as `not_awaiting_reply`. *Retry with an idempotency key* — + exactly-once; − needs a contract change, a migration and a redeploy.
**Decision:** retry once, immediately, only on `FunctionsFetchError`, in `lib/api.ts`. The raw "Failed to send a request…" message now reads "Couldn't reach the server…".
**Why:** the observed failure happens before the server sees the request; a rare duplicate question is cheap and visible.
**Revisit if:** duplicate questions show up in the data; then add a client-generated question id with a unique constraint.

## D62. Tracing: per-call rows in Postgres, read with a terminal report — 2026-11-23, Jack
**Context:** backlog #1: see every ask run's model calls, latency, tokens and cost. It is also a prerequisite for the simulated-roommate evals.
**Options:** *a hosted tracing product (Langfuse, Braintrust, OpenTelemetry collector)* — + ready-made UI; − a new service, account and secret, and question text would leave our database unless carefully scrubbed. *Log lines in edge-function logs* — + no schema; − hard to aggregate, short retention. *Two tables in our own Postgres* — + same RLS/grants model as everything else, queryable with SQL, joins to questions and predictions; − we build the summary ourselves.
**Decision:** migration 0007 adds `agent_runs` (one per ask that reaches the model: question id, ok, total latency, core version) and `agent_calls` (one per model call: step, target, model, ok, stop reason, error type, tokens, latency). Only counts and outcomes are stored, never question text, prompts or model output. Service-role only. `tracedModel()` in core labels each call by its system prompt (parse / answer / draft), so the pipeline's signatures didn't change; `ask` writes the trace in a `finally`, so failed runs are recorded, and a failed trace write never fails the request. `npm run traces -- --days N` prints run count, failures, p50/p95 latency, per-step tokens and cost (prices from `evals/report.ts`), and why calls produced no output.
**Why:** smallest thing that answers "how slow, how expensive, how often does it fail" without adding a service or moving user text anywhere.
**Revisit if:** we need per-run drill-down or charts (add a small web view over the same tables), traffic passes ~1000 runs per report window (paginate), or cache tokens become a meaningful part of cost (store them too).

## D63. Simulated-roommate evals: offline, seeded, graded against hidden timelines — 2026-11-23, Jack
**Context:** backlog #2; the 24-fixture eval is saturated (D58). Design: `docs/superpowers/specs/2026-11-23-sim-evals-design.md`.
**Options:** *offline simulation calling the core pipeline* — + seeded, fast, free in code mode; − skips DB/edge (tested elsewhere). *End-to-end on the local stack* — − `ask` uses the real clock, so simulating weeks needs time travel in production code; slow. *Full LLM roommates (τ-bench style)* — − no fixed ground truth, nondeterministic, cost grows with days × roommates; Jack wants it as a follow-up.
**Decision:** offline simulation (`evals/sim/`, `npm run sim`). Six personas with hidden timelines; the agent sees only noisy geofence events (0–3 min delay, 2% dropped) and declared away blocks; each question is graded against the hidden timeline under all three answer modes (the policy is pure, so this costs no model calls). Code mode uses the intended parse; `--llm` phrases questions with Sonnet (cached, so models see identical text) and runs the real model. Rulings made while building: the shift worker has fixed Tue/Thu nights (declared) plus one random night a week (not declared); at-time questions use quarter-hour times; accuracy of drafts/guesses is printed with its count.
**First result (code mode, seed 1, 14 days, 252 questions, `auto_when_confident`):** 59% answered correctly, 5% (12) confidently wrong, 36% asked the roommate. "Now" questions are 97% right (misses come from dropped geofence events). 75% of at-time questions go to the roommate because there is no evidence at all for a future time without an away block: 90 of the 91 escalations have no prediction. Confident errors cluster in until-when answers taken from an away block's end (gym days, the stale block, the undeclared trip) and the traveler's dropped events.
**Why:** measures what the product actually does over weeks, with an honest bother rate next to accuracy, at zero cost per run.
**Revisit if:** a predictor change (learned arrival patterns, backlog #7) or a confidence change for block-based until-when answers is proposed: judge it on this harness first.

## D64. Simulated-roommate results across models: the model isn't the bottleneck — 2026-11-23, Jack
**Context:** D58 said to revisit the default model once an eval could separate models. First LLM-mode runs of the simulation (D63): seed 1, 14 days, 252 questions phrased by Sonnet 5.5 in six styles (terse, slang, typos, reasons, relative times, polite), identical for every model. Two generator flaws found and fixed before these numbers: a 200-token cap left 14 questions empty, and the "mention a reason" style put clock times into until-when/now questions, which made the answer key arguable.

| model | parse | correct | confidently wrong | asked roommate | p50 | p95 | $/question |
|---|---|---|---|---|---|---|---|
| Opus 5.5 | 100% | 59% | 5% | 36% | 2.4 s | 5.7 s | 0.00240 |
| Sonnet 5.5 | 100% | 59% | 5% | 36% | 2.7 s | 5.8 s | 0.00113 |
| Haiku 5.5 | 99% | 59% | 4% | 37% | 1.5 s | 2.0 s | 0.00005 |
(`auto_when_confident`; code-mode oracle: 59% / 5% / 36%.) Haiku's two misses parsed a clear "when are you back" as unclear, which fails safe (the roommate is asked).
**Options:** *keep Opus* — + no change; − ~48× Haiku's cost and ~1 s slower at p50 for no measured gain. *Sonnet* — + same accuracy at half Opus's cost; − no faster. *Haiku* — + fastest and cheapest, p95 under 2 s; − 2/252 safe parse misses.
**Decision:** switch the default to `claude-haiku-5-5` (Jack, 2026-11-23): every system-level number is the same and its misses fail safe. One constant, `DEFAULT_MODEL` in `packages/core/src/agent/anthropic.ts`, used by production and both eval runners so the evals always test what ships. Hosted picks it up on the next `ask` deploy. Supersedes D58.
**Why:** this result says where quality comes from: the evidence and the policy (no evidence for 75% of future at-time questions; until-when answers from block ends cause most confident errors), not the language model.
**Revisit if:** harder phrasing (option 3, LLM-driven roommates) separates the models, or a learned predictor makes the parse of times more consequential.

## D65. LLM-driven roommates: day by day, reactions allowed, cached; generated lives rarely create conflicts — 2026-11-24, Jack
**Context:** follow-up to D63 ("option 3"). Design: `docs/superpowers/specs/2026-11-23-llm-roommates-design.md`. Jack chose the day-by-day approach because a roommate's answer can change plans.
**Options:** *lives written up front* — cheap, but answers can't change anything. *Day by day with reactions (chosen)* — measures needs met vs bother and commitments. *LLM-authored rules sampled by code* — no plans or stories.
**Decision:** `evals/sim/lives/`, `npm run lives`. Sonnet 5.5 invents the household (`--size`, default 5) and plays every roommate: morning plans with needs and questions, phrasing, replies when the agent routes a question to them, reactions to answers, end-of-day memories. Any of those can change that person's plans from that moment on. The agent is the real pipeline on `DEFAULT_MODEL`. Answers are graded against the final timeline. Every LLM call is cached in `evals/sim/lives/cache.jsonl`. Built-in rules: invalid plans are retried once, then become a stay-home day; two API failures stop the run (added after the account hit its monthly API limit mid-run and the first version quietly filled days with fallbacks); failed agent calls are never cached.
**What the runs showed (seed 1, 7 warm-up + 14 days, agent Haiku 5.5):**
1. First prompt, five roommates: 18 needs across the three modes, all met, none by a plan change. They were the askers' own movie nights at times they were home anyway.
2. Needs restricted to "something needs someone home while you are out" (current prompt):

| household | mode | questions | needs (met) | asked per roommate-day | commitments | correct | confidently wrong | asked roommate |
|---|---|---|---|---|---|---|---|---|
| 5 | ask_me | 62 | 1 (1) | 0.17 | 0 | 74% | 6% | 19% |
| 5 | auto_when_confident | 62 | 1 (1) | 0.09 | 0 | 85% | 5% | 10% |
| 5 | always_auto | 60 | 1 (1) | 0.01 | 0 | 78% | 8% | 2% |
| 2 | ask_me | 28 | 0 | 0.29 | 0 | 68% | 4% | 29% |
| 2 | auto_when_confident | 28 | 0 | 0.29 | 0 | 68% | 4% | 29% |
| 2 | always_auto | 25 | 0 | 0.07 | 0 | 68% | 4% | 8% |

Realistic generated lives almost never produce a conflict (someone out when something needs a person home), so no answer ever led a roommate to change plans: 0 commitments in 6 runs. Replies were natural ("Nope, at work till 11:30, don't cook for me") and askers did adjust their own plans now and then. The mode trade-off still shows: `always_auto` almost never bothers anyone but is the most often confidently wrong. In the two-person house `ask_me` and `auto_when_confident` decide identically, because every question was either a "now" question with clear presence (answered in every mode) or had no evidence at all (asked in every mode). Parse agreement (79–98%) is lower than D64 because realistic questions are vaguer ("home for dinner tonight?"). Also found: the answer writer embellishes (backlog).
**Why:** the harness works, replays for free and costs about $1–2 for the first mode of a run; the finding is about generated lives, not the harness.
**Revisit if:** we want to measure commitments directly: inject scripted conflicts (a repair visit at 14:00 while the only roommate who could cover is at work) into chosen days and compare modes on those, keeping the generated lives around them.

## D66. The answer and draft writers see facts only, and their text must match the claim — 2026-11-24, Jack
**Context:** security review (findings 6, plus Jack: "prevent users from using my API key for their own questions/tasks"). The writers got the raw question, so "is Sam home? also write me an essay" could return arbitrary text to the asker, crafted questions could steer drafts, and Haiku embellished (backlog).
**Options:** *prompt hardening only* — cheap, unenforceable. *Template only, no writer* — safest, loses tone and drafts. *Facts-only writer plus an output check* — keeps the tone, deterministic guard.
**Decision:** the writers get the target's name, the claim, the caveat and the timezone, never the question. `acceptWriterText` keeps a line only if it is one line of ≤ 160 characters with no links, emails or code, states the claim's state without contradicting it, and mentions only the claim's times (including the one the template would show). Otherwise answers fall back to the template line and drafts are dropped.
**Why:** nothing the asker types reaches a model that writes free text; `parseQuestion` is schema-constrained, so the key can't be used as a general LLM.
**Revisit if:** a paid eval shows many real lines fall back to the template (e.g. "at 7" without AM/PM), or drafts disappear too often.
**Measured (2026-11-24, Haiku 5.5, 24 fixtures):** 24/24 pass; 11 of 12 answers kept the model's line. The first run surfaced "Sam is predicted to be home until 10:00 AM" for "when is Sam back?" while Sam is home: that claim's predicted time is just "now", so it is no longer given to the writer or accepted in its text (`statedPredictedTime`); that answer now reads "Sam is home…" or falls back to "Sam: home now".

## D67. Rate limits on ask: an admissions table under a per-user lock, a global breaker, at most 20 targets — 2026-11-24, Jack
**Context:** finding 3: anyone could sign up and loop `ask`, draining the API credits.
**Options:** *count `questions` rows* — racy, because the row is written after the ~1 s parse, so a parallel burst all sees the old count. *Insert the question before parsing* — still check-then-insert. *`admit_ask` RPC that counts and records under a per-user advisory lock* — exact.
**Decision:** `admit_ask` with `ASK_LIMITS` from core: 30 per user per hour, 200 per day, 3000 per day across everyone (then `503 busy`), and `400 too_many_targets` above 20 targets (each target is a writer call). Rejected attempts aren't recorded, so one hammering account can't trip the breaker for everyone. Service role only.
**Why:** bounds the cost per account and in total. The Anthropic spend limit stays the final backstop.
**Revisit if:** real use nears 3000 a day, a flood happens (then turn on captcha), or `ask_admissions` grows (it isn't pruned yet).

## D68. Membership is approved, removable and visible only from the join date — 2026-11-24, Jack
**Context:** findings 1–2: an invite code admitted anyone instantly and forever, returned the home location to the joiner, and showed the full presence history from before they joined; nobody could be removed and codes never changed.
**Decision:** `household_members.status` pending/active; every membership check requires active. `join_household` creates a pending request and returns only id and name; owners `approve_member` / `decline_member`, `remove_member`, `rotate_invite_code`; anyone can `leave_household` (an owner hands over to the earliest active member; the last member deletes the household). Co-members see presence only from the viewer's `joined_at` (strict: no state going in), and `ask` evidence uses the same cutoff, so the agent can't reveal older routines either. Pending users read only their own request and `my_pending_households()` (name and owner). Joins are limited to 5 failed codes per user per hour; a bad code is returned as `{error: 'invalid_invite_code'}` rather than raised, because a raise would roll back the recorded attempt.
**Why:** the realistic attacker is a former roommate or someone who saw a code; this lets the owner control who's in and limits what a newcomer learns.
**Revisit if:** strict "unknown until their next crossing" feels broken to new members, or codes should also expire (not built).

## D69. Deleting an account hands over or deletes owned households, in a database trigger — 2026-11-24, Jack
**Context:** Apple requires in-app account deletion; deletes failed because `households.created_by`, `questions.asker_id`, `question_targets.user_id` and `predictions.user_id` referenced profiles without cascade.
**Options:** *do the hand-over in the edge function, then delete* — not atomic, skipped by dashboard deletions. *A before-delete trigger on profiles* — atomic, covers every deletion path.
**Decision:** the trigger. `delete-account` only calls the admin API. The person's own questions, targets and predictions cascade; `households.created_by` becomes nullable and set null (history only; `role` says who owns it now); `questions.household_id` cascades so a household can be deleted.
**Revisit if:** household accuracy stats must survive account deletions.

## D70. Presence events: server time, a per-hour cap, a locked visibility read, and unhide as a new event — 2026-11-24, Jack
**Context:** finding 5 (members could backdate or flood their presence) and backlog items (visibility stamp race; unhiding revealed the time of the last hidden change).
**Options for time:** reject old `at` (drops real events from phones with a wrong clock), clamp to a window (still forgeable), or overwrite with `now()` (the app always sends now; no offline queue exists).
**Decision:**
- For signed-in users a trigger sets `at = now()`.
- 60 events per user per household per rolling hour (`rate_limited`, raised from a trigger so the code is named).
- The visibility stamp reads membership `for share`.
- Turning visibility back on inserts a new visible event with the current state at that moment (triggers renamed so they fire limit → stamp → skip-repeat).
**Why:** nothing real is ever rejected, nothing can be forged, and unhiding reveals only "home/away since now".
**Revisit if:** the app gains an offline queue (then accept `at` within its maximum age) or `rate_limited` shows up for real users.

## D71. The fallback guess lives in its own table, readable after 10 minutes — 2026-11-24, Jack
**Context:** backlog: the asker could read `question_targets.fallback_guess` immediately; only the UI waited.
**Options:** column grants (realtime payloads can still carry the column), an RPC, or a separate table.
**Decision:** `target_guesses(question_target_id, guess, visible_after = now() + 10 min)` with RLS `visible_after <= now()`, kept out of the realtime publication. The app re-fetches when the 10 minutes end.
**Revisit if:** the wait becomes configurable (it is now in both SQL and `NO_REPLY_AFTER_MS`).

## D72. Predictions with hidden evidence stay unscored — 2026-11-24, Jack
**Context:** backlog: `score` judged predictions with events recorded while the member was hidden.
**Decision:** score from visible events only; once a prediction is due, any hidden event in its evidence leaves it unscored.
**Why:** conservative: accuracy stats never use hidden data.
**Revisit if:** the unscored share grows noticeably.

## D73. The session token is stored in the iOS keychain — 2026-11-24, Jack
**Context:** finding 8: the session was in AsyncStorage.
**Decision:** `expo-secure-store`, split into 512-character pieces (items over ~2 KB can be rejected), `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` so the background geofence task can read it while the phone is locked; an existing AsyncStorage session is moved over once so nobody is signed out. No extra crypto dependency.
**Revisit if:** expo-secure-store lifts its size limit.

## D74. Learned arrival patterns: on-the-fly habits from 8 weeks of history, chosen and confirmed on separate seeds — 2026-11-24, Jack
**Context:** the simulation (D63) found 75% of future at-time questions went to the roommate for lack of evidence, and most confident errors came from away-block end times. Design: `docs/superpowers/specs/2026-11-24-learned-patterns-design.md`. Jack chose option A (strong habits are answered automatically) and approach 1, keeping the alternatives.
**Options:** *compute habits per question from history (chosen)* — no new tables, testable, simulated directly. *Stored patterns from a nightly job* — the alternative if per-question work gets slow (measured 1–17 ms per claim); stale between runs, stores a routine summary at rest. *A statistical model* — the alternative if the simple matcher plateaus; harder to explain and tune. Both plug into the same seam: `buildClaim`'s pattern options.
**Decision:**
- **Evidence:** `EVIDENCE_DAYS = 56`, read newest first with an explicit 1000-row cap.
- **At a time:** a habit (same weekday, same local time) is a medium claim only if every comparable day agrees, with at least 3 of them (`nMin 3, pMin 0.95`). It overrides an away block only if the block is older than that history (`away_blocks.created_at`, migration 0011).
- **Return time:** a "back by" habit is medium only if that share of comparable away-days, counting days with no return as misses, came back within 30 minutes of the median. An old block whose end such a habit contradicts drops to low confidence.
- **Trips:** habits are ignored once someone has been out for over 24 hours.

**How it was chosen (including what failed):**
1. **First version:** a 90-minute spread rule for return times and "most correct under an error cap" as the selection rule. It failed its acceptance on seed 1 (9 → 11 confident errors). The 24-hour guard was designed while looking at seed 1's errors, so seed 1 is no longer a clean held-out seed.
2. **Review findings fixed:** the review found the evidence query dropping the newest rows past 1000, return-time habits right only 43% of the time, and new blocks being overridden. All three were fixed.
3. **Second confirmation failed:** the selection rule, fixed in advance, picked the most aggressive setting; on fresh seeds 8–13 confident errors went 68 → 78.
4. **Rule changed and committed before running:** the fewest confident errors among settings that beat "off" on correct answers. Confirmed once on fresh seeds 14–19.

**Result (seeds 14–19, never inspected; `auto_when_confident`; 1512 questions):** correct 930 → 1172, confidently wrong 47 → 32, asked the roommate 535 → 308. Tuning seeds 2–4: correct 62% → 79%, confidently wrong 4.0% → 1.6%.
**Why:** the biggest measured gap in answer quality, closed with plain, explainable code. The writer still only states the claim, so the asker never learns the routine behind it.
**Revisit if:** confident errors rise in real use; real routines turn out less regular than the personas (they are weekday-based, which favours the weekday matcher); or per-question computation gets slow. Next confirmation needs new seeds (20+).

## D75. A local MCP server that signs in as the person — 2026-11-24, Jack
**Context:** let Claude Desktop / Claude Code (any MCP client) ask "is Sam home?" from Homebase. Design: `docs/superpowers/specs/2026-11-24-mcp-server-design.md`.
**Options:** *local stdio server signing in as the person (chosen)* — every read goes through RLS and asks/replies through the edge functions, so rate limits, the facts-only writer and hidden-presence rules apply unchanged; no new server code; − the password sits in a local env file. *Hosted remote MCP with OAuth* — no stored password, works anywhere; − an OAuth server, consent screens and a new hosted surface. *A service-role server* — rejected: it would bypass every per-user guard.
**Decision:** `apps/mcp` on the MCP TypeScript SDK (v1.32, the maintained v1 line), tools list_households / whos_home / ask / my_inbox / reply / my_questions, lazy sign-in (tools list without credentials) with one re-sign-in after a dead session. Roommate-written text is quoted in «» as data with a note on every output that contains it, and `reply` requires the user's explicit confirmation per item, because that text reaches the user's model (found in review: a crafted question could otherwise ask the model to approve drafts). Names match full name exactly or a unique first name; ambiguity is refused rather than guessed.
**Revisit if:** the server is used beyond a personal machine (then hosted OAuth, SDK v2), or a third client needs the same status/error wording (move it to core).

## D76. Calendar busy/free as dated away evidence, start and end only — 2026-11-24, Jack
**Context:** future answers still lean on habits and recurring blocks; people's calendars know about one-off plans. Design: `docs/superpowers/specs/2026-11-24-calendar-away-design.md`.
**Options:** *phone reads chosen calendars and syncs only start/end (chosen)*; *recurring away blocks only* (today; misses one-off plans); *server-side calendar access (Google/Outlook APIs)* — rejected: titles and attendees would leave the phone, plus OAuth per provider.
**Decision:** the person picks calendars that mean "I'm away" (stored per device, cleared on sign-out). Timed, busy, non-cancelled events of 24 hours or less for the next 14 days sync as periods (`calendar_away`, 0012) through `sync_calendar_away`, which replaces all of the caller's rows under a per-user lock (no history is kept). Only the person can read their rows; `ask` reads them with the service role. In `buildClaim` a period covering a future time is a medium "away" claim (basis `calendar`) checked before habits and blocks, since it is newer and more specific; someone home now inside an event skipped it; during a trip (out over 24 h) an event's end is not a "back at" time. The writer never learns the basis. Sign-out clears the server rows too.
**Why:** one-off plans are the gap habits can't fill, and start/end times reveal far less than titles.
**Revisit if:** declined invites cause wrong answers (EventKit gives no own-attendee status here), or the simulation gains calendar personas to measure this (it doesn't exercise `awayPeriods` yet).

## D77. Pattern fixes from review: near-term state, fixed lookahead, wall-clock returns — 2026-11-24, Jack
**Context:** D74's review leftovers.
**Decision:**
- An at-time question within 2 hours counts only comparable days that were in today's current state at this time of day. Otherwise "home at 7?" asked at 18:55 while away was answered from days they were already home by 18:30.
- The return lookahead is a fixed 18 hours after each comparable instant. It replaces "until 05:00 the next morning", which jumped from about 5 h to 29 h at midnight.
- Return times and predicted times use wall-clock minutes, so they're right on DST nights.
- A spring-forward local time that doesn't exist maps to the first valid instant.
- A regression test pins that `matcher: 'off'` reproduces pre-pattern claims.

Re-measured on seeds 14–19 (already used to confirm D74, so a no-regression check, not a confirmation): correct 1172 → 1177, confidently wrong 32 → 31, asked 308 → 304.
**Revisit if:** a new confirmation on fresh seeds (20+) disagrees.
