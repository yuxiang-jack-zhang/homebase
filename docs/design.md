# Homebase — MVP design

*Working name; rename freely. Written 2026-11-22.*

## Intent

Roommates constantly text each other "are you home rn?", "will you be home at 7?", "how long till you're back?". Answering interrupts the person asked; guessing is unreliable; Find My shares an exact map pin, which many roommates (especially ones who didn't know each other before) won't turn on.

Homebase is an iPhone app for a household. Each member's phone reports only **home / away** (never coordinates). Anyone can ask a free-text question about a roommate; an AI agent answers from what it knows, or — when unsure, or when the roommate prefers — routes the question to that roommate as a notification they can answer in one tap.

**What people use it for:** not only avoiding the interruption, but planning around who's home: someone with a partner over wants to know how long until roommates get back; a group plan ("let's cook together") needs everyone back first. So answers about *when* people will be home matter as much as *whether* they're home now.

**Why it exists:** a portfolio project for AI-engineer and full-stack roles. The postings it targets (Sierra agent engineer, Koch AI-agent tooling, Bitdeer agent platform) ask for: production agents that real users talk to and that take actions, guardrails, evals, and React/TypeScript. So the bar is: real users (Jack's household), an agent with enforced guardrails, and a measured accuracy story — not commercial market fit.

## Done means (Sunday night)

The full loop works end to end on multiple iOS simulators plus Jack's phone, against a **hosted** Supabase project (free tier). Roommates' phones come when the Apple Developer account is bought (push + TestFlight). The weekend is a **hard deadline**; if time runs short, cut in this order: (1) stats screen, (2) multi-model comparison, (3) eval set shrinks from ~20 to ~10 scenarios, (4) away blocks (agent then handles only "now" and escalates the rest). Never cut: the core loop (sign up → household → geofence → who's-home → ask → agent answers or escalates → reply) and the RLS/privacy tests.

## Goals (MVP, one weekend)

1. Open sign-up; create a household; others join with an invite code.
2. Each member sets the household's home location once; the phone geofences it and reports enter/exit.
3. A "who's home" list, live.
4. Members can set **recurring away blocks** (e.g. "Tue/Thu 6–9pm climbing").
5. Ask a free-text question about a roommate (or "anyone home?"). The agent answers, or escalates to the roommate.
6. Roommate gets the question with the agent's draft answer and can approve / tap a quick reply / type a short answer; the asker sees the result.
7. Every agent claim is logged as a **prediction** and later scored against what actually happened.
8. An offline **eval set** of scenarios scores the agent (accuracy, escalation rate, latency, cost).

## Non-goals (MVP)

- Calendar, ETAs, home-screen widget, pattern statistics (these are the roadmap, in that order).
- Android (much later).
- Packages, groceries, chores, dinner.
- App Store release. TestFlight comes after the Apple Developer account is bought.
- iMessage integration (see stashed ideas).
- Fine-tuning any model.

## Anti-goals (fails even if it "works")

- The server ever receiving raw coordinates of a member's phone.
- One household able to read another household's data.
- The agent stating something confident and wrong to the asker when the evidence was weak or conflicting.
- Nagging: a roommate getting pinged for questions the agent could have answered under their chosen mode.

## Constraints

- **One weekend** for the MVP.
- **No paid Apple Developer account yet.** A free Apple ID can install a development build on Jack's own iPhone (expires every 7 days) and run in the simulator. Free accounts **cannot use remote push notifications** (APNs). So in the MVP, questions and answers are delivered in-app via realtime subscriptions, plus local notifications while the app is running; remote push and TestFlight are switched on after the account is bought. Code should keep a single "notify member" seam so that switch is small.
- **Expo Go can't do background location on iOS** → use an Expo development build (`npx expo run:ios`).
- Multi-user testing before TestFlight: multiple iOS simulators (simulated locations via Features → Location / `xcrun simctl location`) plus Jack's phone.
- Jack knows React Native; TypeScript throughout.

## Approaches considered

| Approach | Trade-off | Verdict |
|---|---|---|
| **Expo (React Native) app + Supabase** | TS/React matches the target postings; Supabase gives auth, Postgres with row-level security, realtime, and edge functions in one, which is what makes open sign-up feasible in a weekend. Background geofencing and actionable notifications are supported. Widget later needs a Swift target. | **Chosen** |
| Native Swift + any backend | Best iOS API access (widget, location) but Jack would be learning Swift during the weekend, it doesn't match the postings, no Android path. | Rejected |
| PWA | No install, but iOS web apps can't track location in the background. | Ruled out |
| iPhone app for location + Discord bot for Q&A | Keeps chat where people are, but everyone installs the app anyway for location, so Discord becomes a second surface plus an integration to build. | Rejected (Jack's call); Discord bot could be a later add-on |
| Neon + Vercel backend (Jack's market-dashboard stack) | Works, but auth + realtime would be hand-wired. | Rejected for time |

## The design (decided)

### Privacy model
- Geofence is computed **on the phone**; only `enter` / `exit` events (with timestamp) go to the server. The household's home lat/lng + radius is stored (needed to set the geofence on each phone); members' positions are not.
- Two independent per-member settings (Jack approved this split):
  - **Visibility** — whether my current home/away shows on the who's-home list. On (**default**): "are you home now?" is answered straight from it, no ping. Off: I show as "—" and every question about me escalates to me. ETAs, when added, are a separate opt-in.
  - **Answer mode** — what the agent may say about things the list can't show (future times, "until when"):
    - `ask_me` — never answer without my approval (**default**).
    - `auto_when_confident` — answer directly when confidence ≥ threshold, else ask me.
    - `always_auto` — always answer; low-confidence answers say so.
- Settings are per member (not per roommate pair) in the MVP.
- Row-level security: a user can only read/write rows of households they belong to. This is tested.
- **Home location** : set by the household creator; only the owner can change it. Each member sees the home pin on a map and **confirms it before their phone starts geofencing**, both on joining and after any change. This stops someone from moving "home" to a roommate's workplace to track them.

### Evidence ranking (what the agent trusts)
1. **Current presence** (last geofence event) — truth for "now". Beats everything below.
2. **Plans** — recurring away blocks now; calendar busy/free later. A preset block is weaker than a calendar event because nothing signals a skipped occurrence.
3. **History patterns** — later.

When sources disagree (e.g. a block says away until 9 but they arrived home at 6:30), present-tense questions follow presence; future-time questions drop to low confidence → escalate (or, under `always_auto`, answer with the uncertainty stated).

### Agent
- Runs in a Supabase Edge Function as a two-step pipeline (D13): (1) Claude parses the question into a kind and time with structured output; (2) code gathers that one target's evidence, computes confidence and the send decision; (3) Claude words the answer, or the draft the roommate approves. One run per target, seeing only that target's data (D15).
- **The send policy is enforced in code, not by the prompt.** The pipeline checks the target's answer mode and the confidence; if not allowed, the question goes to the roommate instead. This is the guardrail, and it's unit-tested without a model.
- Confidence is a small discrete scale (e.g. high / medium / low) derived from rules over the evidence (fresh presence → high for "now"; covering away block with no contradicting presence → medium for future time; nothing → low). The model phrases and resolves the question (who, which time, what kind); the rules decide how sure we are. Exact rules are the builder's, defined by the tests.
- Model choice: pick by running the eval set across a couple of current Claude models and comparing accuracy, latency and cost; record the comparison in `docs/decisions.md`.

### Question flow
1. Asker types a question (to a roommate, or to the household).
2. Agent resolves target + time + type (`now` / `at_time` / `until_when`) and gathers evidence.
3. Depending on policy: answer the asker directly, or send the roommate a request containing the question and the agent's draft.
4. Roommate responds: approve draft / quick reply (Yes / No / Not sure) / short text. Response goes to the asker; the roommate's choice (approved / edited / rejected) is stored as feedback.
5. If the roommate doesn't respond within a timeout, the asker gets "no reply yet". Under `auto_when_confident` / `always_auto` it adds the agent's best guess labelled as a guess; under `ask_me` it does not (`ask_me` always wins).

**Household questions ("anyone home?")** — a question can target several members. Each member is resolved independently by the same policy; members in `ask_me` are **not pinged** by household-wide questions (nagging anti-goal) and appear as "unknown" unless their status is visible anyway. The asker sees one combined answer that fills in as replies arrive.

### Scoring and evals (the portfolio centerpiece)
- **Prediction log:** every agent claim stores `{target, kind, about_time, predicted_state | predicted_time, confidence, source}`. A scorer (scheduled or on-demand) compares claims to presence events once the time passes. Roommate approve/edit/reject is a second signal. Scoring rules:
  - `now` claims are read straight from presence, so they're right by construction; they are **excluded from the headline accuracy** and reported separately (with roommate feedback as their only real check).
  - `at_time` claims store a predicted state; correct if presence at that time matches.
  - `until_when` claims ("back by ~9") store a predicted time; correct if the actual arrival falls within a tolerance window (builder picks the window, e.g. ±30 min).
  - If there are no presence events to judge by (phone off, missed geofence), the claim is **unscored**, not wrong; the unscored rate is reported.
- **Offline eval set:** fixture scenarios (household state + question → expected decision: the claim, or escalate). A runner executes them against the real model and reports accuracy, wrong-confident rate, escalation rate, latency, cost. Starts at ~20 scenarios, grows from real misses.
- **In-app stats screen** (small): accuracy and calibration from the prediction log.

### Data model (outline)
`profiles`, `households` (name, invite_code, home lat/lng/radius, timezone), `household_members` (role, answer_mode, sharing_level), `presence_events` (member, enter|exit, at), `away_blocks` (member, days_of_week, start, end), `questions` (asker, text, parsed fields, status), `question_targets` (question, member, status, one row per targeted member), `responses` (question_target, source agent|human, text, feedback approved|edited|rejected), `predictions` (question_target, kind, about_time, predicted_state, predicted_time, confidence, outcome correct|incorrect|unscored, scored_at), `household_members.home_confirmed_at`, `push_tokens` (for later).

### Repo layout
`vibing/homebase/` containing `apps/mobile` (Expo), `supabase/` (migrations, edge functions, seed), `packages/core` (pure TS: question types, confidence rules, send policy, scoring — shared by the edge function and tests), `evals/` (fixtures + runner), `docs/`.

## Engineering process (Jack's requirements)

- **Persistent tracking files**, kept current throughout the build:
  - `CLAUDE.md` — project rules and commands.
  - `docs/backlog.md` — every feature not yet built, in priority order. Long-lived; Jack reorders it.
  - `docs/plan.md` — the step-by-step plan for the *current* milestone only, with checkboxes. Replaced each milestone.
  - `docs/progress.md` — dated dev log: done, in progress, blockers.
  - `docs/decisions.md` — every non-trivial engineering decision: context, options with pros/cons, the choice, why, and what would make us revisit it. Every decision is logged here so the trade-off reasoning is recorded, not just the outcome.
  Subagents read these before starting, log any decision they make, and update `progress.md` when done.
- **Tests first** where logic lives: `packages/core` (confidence rules, send policy, scoring), database RLS and constraints (against local Supabase in Docker), the edge function's tool handlers, and the eval set. These tests encode what we're building.
- **Not test-first:** native integrations (geofencing, notifications) and most UI. They get a short manual test checklist (simulator + phone) in `docs/` and a few component tests, not a comprehensive suite — unit-testing them mostly tests mocks.
- **Subagents** work in parallel only after the shared contract (DB schema + `packages/core` types) is written and committed, so the backend, agent and mobile pieces build against the same interfaces.

## Roadmap after MVP
Lives in `docs/backlog.md` (priority-ordered, Jack owns the order).

## Left to the builder
- Exact confidence rules and threshold (defined by tests).
- Roommate response timeout length.
- Invite code format; geofence radius default.
- Prompt wording; UI layout and styling.
- How the scorer is scheduled.

## Stashed ideas (not in scope)
- **Answer iMessage texts:** detect "you gonna be home at 7?" from a roommate and suggest/send a reply. iOS doesn't let apps read iMessages, but the Shortcuts app has a personal automation "When I get a message from [person] containing [text]" that can pass the message to an app action; that's the most promising path (needs per-user setup, to be verified). A Mac relay reading the Messages database is the fallback.
- Packages / dinner / groceries / chores for the household.
- Discord bot as a second surface.
- Social-media virality / meme-spread monitor (original Sonoma Brands project, `~/sbc/knowYourViralBrands`).
- Prediction-market forecasting agent graded by Brier score.
