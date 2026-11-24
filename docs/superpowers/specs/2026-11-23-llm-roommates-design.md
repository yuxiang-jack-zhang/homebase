# LLM-driven roommates: design

Status: draft for Jack's review, 2026-11-23. Follow-up to the simulated-roommate evals (D63, D64), "option 3".

## Why

The code simulation grades answers against fixed timelines, so what the agent says can never change what happens. In a real household it does. A roommate who's asked "will you be home at 3? the plumber's coming" may come back for it. An asker told "Ben's out till 6" may stay in themselves. Jack picked the day-by-day approach for exactly this reason: answers can change the plans of the day. That makes it possible to measure what the product is for, whether people's needs get met, against what it costs, how often people get bothered. It also gives realistic, LLM-written lives in place of six hand-coded routines.

## Goals

- One household of 5 LLM-invented roommates, simulated day by day for 14 days, with Sonnet 5.5 playing each roommate and the agent under test being `DEFAULT_MODEL` (Haiku 5.5).
- Plans can change in response to answers and replies. The graded truth is what actually happened.
- New outcome metrics:
  - **needs met:** was someone home when a roommate needed it?
  - **bother:** how often a roommate was asked to reply
  - **commitments:** how often a reply turned into a plan change
- Compared across answer modes. Plus the existing per-answer outcomes (correct / confidently wrong / caveated / asked / unknown), graded against the final timeline.
- Reproducible: every LLM call is cached by its exact input, so a rerun with nothing changed costs $0 and gives identical results.

## Non-goals

- No DB, edge functions or app (same as D63). The agent runs through the core pipeline.
- No learning: roommates don't remember the agent's past accuracy across runs.
- No multi-household breadth in this version (one household; more later if useful).
- No adversarial roommates (separate idea, feeds the security review).

## Anti-goals

- **Roommates who just obey the asker.** Plan changes must be plausible for the person: sometimes "sorry, can't make it back". The prompts say so, and the report shows the commitment rate so a 100% rate stands out.
- **The simulator seeing the agent's internals.** Roommate LLMs see only what a person would: the question, the suggested reply (for the target), and the answer text (for the asker). They never see claims, confidence or other roommates' hidden plans.
- **Results that can't be reproduced or audited.** Every LLM exchange is cached and committed with the results, so a reviewer can read why someone changed plans.
- **A metric that rewards silence.** Needs met and bother are always reported together.

## Approaches considered

1. Lives written up front by an LLM, graded like D63. Cheap and repeatable, but answers can't change plans. Not chosen.
2. **Day by day, with roommates reacting to answers (chosen by Jack).** Captures commitments and asker reactions; costs more per run; repeatable through caching.
3. LLM-authored rules sampled by code. Cheap and broad, but lives are dice rolls with no plans. Not chosen.

## Design

### The household (generated once, cached)
One Sonnet call creates 5 roommates: name, age, job and hours, habits, social life, and **the away blocks they'd put in the app** (allowed to be partial or out of date, as real people's are). Timezone `America/Los_Angeles`, start Monday 2027-01-04 (as in D63). All roommates use one answer mode per run (`--mode`), and visibility is on.

### A day
1. **Morning plan** (one call per roommate): input is the persona, a short memory (summaries of the last 3 days, written by the roommate's own LLM at the end of each day), promises made for today, and the day of week. Output is structured JSON, validated with Zod:
   - `outings: [{ leave: "HH:MM", back: "HH:MM", why }]`. `back` may be after midnight ("25:30"); outings are sorted, non-overlapping, and inside 05:00–29:00.
   - `needs: [{ at: "HH:MM", what }]` (0–2 per day; things that need someone home, e.g. a delivery or a guest).
   - `questions: [{ at: "HH:MM", about: name, why }]` (0–3; when the roommate would message the app about someone). Every need produces a question in the hour before it. A question about an unknown name, or about yourself, is dropped and counted.
2. **Event loop** over all roommates' questions for the day, merged in time order (one household, sequential):
   - **Evidence:** geofence events derived from what has happened up to now (executed plan intervals, D63 noise: 0–3 min delay, 2% dropped) plus the target's declared blocks.
   - **Phrasing:** the asker's LLM writes the question text (its `why` gives context, e.g. "the plumber's at 3"). The answer key for parsing is the question's intent, produced in the same call.
   - **Agent:** the real `parseQuestion` and `answerForTarget`, run with the default model and the run's answer mode.
   - **If the agent asks the roommate:** the target's LLM gets the question text and the suggested reply (if any). It returns `{ reply: approve | yes | no | not_sure | text, text?, newPlan? }`. `newPlan` replaces their outings from now on (the past is fixed). The reply text, or the draft if approved, goes to the asker.
   - **If the agent answers (or the target replies):** the asker's LLM sees that text and returns `{ newPlan? }` for the rest of their day (e.g. staying in for the plumber).
   - A roommate who is out when the plan changes can only "come back" at a plausible time: the new plan must start at or after now.
3. **End of day:** each roommate writes a two-sentence memory. Executed intervals are appended to the true timeline.

Warm-up: the agent needs history. The first 7 days run with no questions (plans only), building geofence history. The 14 graded days follow. Builder's call whether warm-up plans use a cheaper prompt.

### Grading (reusing `evals/sim/grade.ts`)
- Each question's claim is graded with `claimCorrect` against the **final** timeline. For an at-time question, the truth is whether the target was actually home at that time, after any plan changes.
- Unlike D63, outcomes are recorded only for the run's mode (behaviour depends on the mode, so the other modes can't be re-decided from the same run). Comparing modes means running each mode; the report has a mode-comparison table built from three runs.
- **Need met:** anyone in the household, including the person with the need if they changed plans to stay in, was home at `need.at`, by the final timeline. Also recorded: who covered it, and whether it was covered because of a plan change.
- **Bother:** the number of escalations per roommate-day.
- **Commitment:** an escalation whose reply came with a `newPlan`, and whether the new plan was kept (it always is in the simulation; it's recorded so a later version can add flakiness).

### Caching and reproducibility
Every simulator LLM call goes through `cachedCall(prompt) → response`, keyed by a SHA-256 of model + system + user + schema name, and stored under `evals/sim/llm-cache/<run-key>/`. The agent-under-test calls are cached the same way. A rerun replays everything for free. Changing the agent changes its answers, which changes downstream prompts, which makes new calls (that is the point).

### Report
- Per run (mode): needs met %, bother per roommate-day, commitments, answer outcomes, parse accuracy, cost (simulator and agent, separately), p50/p95 agent latency.
- A three-mode comparison table built from the three run files.
- An appendix of up to 5 sample "stories": a question, the agent's answer or escalation, the reply, and the plan change. Picked deterministically from the run (first need met through a commitment, first need missed, first confidently wrong answer, and so on).
- Results file: `evals/results/lives-<date>-<mode>-<model>.json`.

### CLI
`npm run lives -- [--days 14] [--warmup 7] [--seed 1] [--mode auto_when_confident] [--model <agent>] [--sim-model claude-sonnet-5-5] [--no-noise]`. Needs `ANTHROPIC_API_KEY`. The seed drives geofence noise and picks the household variant: the household call includes the seed, so seed 2 gives a different household.

### Cost
Per run: about 21 days × 5 morning plans + 14 × 5 memories + about 150 questions × (1 phrasing + 0.5 reply + 1 asker reaction) ≈ 700 Sonnet calls (≈ $3–6), plus about 150 Haiku agent questions (≈ $0.01). Three modes ≈ $10–18 the first time; replays are free. Pre-approved by Jack for this feature.

### Layout
`evals/sim/lives/`:
- `household.ts`: generate and validate the household
- `day.ts`: plan schema, validation, applying a plan change
- `loop.ts`: the event loop
- `llm.ts`: cached structured calls
- `metrics.ts`: needs, bother, commitments
- `report.ts`
- `run.ts`

Reuses `world.ts` (time, geofence events, evidence), `grade.ts` and `tracedModel`. Tests sit next to each file and use a scripted fake LLM.

## Tests (free, scripted fake LLM)
- Plan validation: rejects overlaps, out-of-range times, back before leave. Normalises "25:30". An invalid plan from the LLM is retried once, then replaced by an all-day-home plan with an `error` recorded.
- Plan change applies only after "now"; executed history is untouched. A change while out starts no earlier than now.
- Event loop with a fake LLM: an escalation with a "come back by 3" reply changes the truth so a 15:00 need is met; the same scenario in a mode that answers instead leaves the need unmet. Both are graded against the final timeline.
- Caching: the second identical run makes zero calls and gives identical results; changing one agent answer re-calls only the downstream prompts.
- Metrics on hand-built runs.

## Left to the builder
Prompt wording (within the anti-goals), memory length, the story-selection rules, file internals.

## Calls I made (for Jack to check)
- One household, 5 roommates, 7 warm-up days plus 14 graded days.
- Sonnet plays roommates; Haiku is the agent.
- Needs and questions come from the roommates' own morning plans.
- Mode comparison comes from separate runs, not counterfactual re-decisions, because behaviour depends on the mode.
- Plan changes are always kept once made (no flakiness in v1).
