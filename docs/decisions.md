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
