# Simulated-roommate evals: design

Status: draft for Jack's review, 2026-11-23. Backlog #2.

## Why

The 24-fixture eval is saturated: Opus, Sonnet and Haiku 5.5 all score 100% (D58), so it can't guide changes. Homebase's real question is whether the system makes good calls over time: it answers when it's right, asks the roommate when it isn't sure, and is rarely confidently wrong. That depends mostly on deterministic code (claim, confidence, policy), which only shows its quality across many days of realistic, messy behaviour. This harness is the portfolio's main "measured, not vibes" piece, and the baseline any future predictor (learned arrival patterns, backlog #7) has to beat.

Jack's priority: **A, is the system right over weeks**, first. **B, which model handles real phrasing**, is also in scope.

## Goals

- Simulate a household of roommates over N days with **hidden** ground-truth timelines. The agent sees only what the app would see: geofence events (with noise) and declared away blocks (possibly stale).
- Ask questions at realistic times, run the real core pipeline (`parseQuestion`, `answerForTarget`), and grade every outcome against the hidden truth.
- Report the trade-off honestly: correct answers, confidently wrong answers, and how often a roommate gets bothered, per answer mode, persona and question kind.
- Code-only mode: free, deterministic from a seed, runs in CI-style tests.
- LLM mode (B): an LLM writes each question in natural language and states what it meant. The real parse model is graded against that answer key; models can be compared on identical questions.

## Non-goals

- No database, edge functions or app. Those have their own tests; this exercises the core pipeline only.
- No simulated replies. Nothing a roommate replies changes later answers today; draft quality is graded directly against the truth.
- No new predictor. The harness measures the current logic; improving it is separate work.
- No UI. Output is a JSON results file plus a markdown table, like the current evals.

## Anti-goals

- **A metric that rewards silence.** Always escalating gives 0% wrong answers. The bother rate is always reported next to accuracy, and the headline pair is "answered correctly without asking" vs "confidently wrong".
- **Circular simulation.** Personas are designed from how people live, not from the confidence rules, and noise isn't tuned to make the current policy look good. If the numbers look bad, that's the finding.
- **Unreproducible results.** Same seed, same timelines, same questions. LLM-written questions are cached to disk so every model sees the same text.

## Approaches considered

1. **Offline simulation calling the core pipeline directly (chosen).** Fast, seeded, $0 in code mode. It skips DB/edge, which are covered elsewhere.
2. End-to-end against the local Supabase stack. More real, but `ask` uses the real clock, so simulating weeks needs time travel in production code, and it is slow. Dropped.
3. Full LLM roommates (τ-bench style): an LLM invents each day as it goes. No fixed ground truth, nondeterministic, cost grows with days × roommates. **Jack: do this after option 1**, as a follow-up with its own design. It can reuse this harness's grading by having the LLM roommate emit its timeline.

## Design

### World
- One household in `America/Los_Angeles`, start Monday 2027-01-04 (no DST change in range), default 14 days, seeded PRNG (mulberry32 or similar; no new dependency).
- Each roommate's **hidden timeline** is a sorted, non-overlapping list of away intervals over the whole run (plus 14 days of warm-up history before day 1, so the agent has the same 14-day window the real `evidence()` reads).

### Personas (each has a timeline generator and declared away blocks)
| persona | hidden behaviour | declared blocks |
|---|---|---|
| `nine_to_five` | weekdays out ~08:30±15 min to ~17:45±30 min; 30% of days gym, back ~19:15 | Mon–Fri 09:00–17:00 (accurate) |
| `stale_blocks` | office Tue–Thu only; Mon/Fri home with 1–2 short errands | Mon–Fri 09:00–17:00 (stale) |
| `shift_worker` | 3 night shifts/week 21:30–06:30, random nights; afternoon errands | only 2 of their 3 regular nights |
| `student` | 2–4 outings/day, 1–4 h each, between 09:00 and 01:00 | none |
| `traveler` | `nine_to_five` routine, plus away 3–5 consecutive days mid-run | weekday block only, nothing for the trip |
| `homebody` | mostly home; 0–2 short outings/day | none |

Builder's call: the exact distributions (keep them in one readable file, with comments).

### What the agent sees
- **Geofence events** come from the timeline: `exit` at each leave and `enter` at each return. Each event is delayed 0–3 min (uniform). Each event is dropped with p = 0.02 (a missed exit means the app believes they're home while they're out). These are realistic failure cases, kept on by default; a `--no-noise` flag exists for debugging.
- **Away blocks** are the persona's declared blocks.
- The evidence at question time = events with `at` ≤ now inside the 14-day window, plus the latest one before it, mirroring `evidence()` in `packages/core/src/data.ts`.

### Questions
- Per simulated day, each roommate is asked about Q times (default 3) by a random housemate, at uniform random local times between 07:00 and 23:30.
- Kind mix: now 40%, at_time 40% (target 30 min to 12 h ahead; 10% of at_time are 1–3 h in the past), until_when 20%.
- **Code mode:** the parse is the intended parse (an oracle), and writer calls go to a fake that returns null, so the template line is used. Cost $0. This grades the claim/confidence/policy logic alone.
- **LLM mode:** a fixed generator model (default `claude-sonnet-5-5`, independent of the model under test) gets the intended kind, the intended local time, the asker's and target's names and a style hint (terse, slang, typo, references a plan like "the plumber at 3", relative time). It returns `{ text }`. Generated questions are cached in `evals/sim/cache/<seed>-<days>.json`, committed, so reruns and model comparisons are free and identical. The real `parseQuestion` and writer run with the model under test.

### Ground truth and grading
- Truth at an instant = home unless inside a hidden away interval.
- `now` / `at_time`: correct if `predictedState` equals the truth at the intended instant.
- `until_when`: if the truth now is home, correct when the claim says home. If away, correct when `predictedTime` is within ±30 min of the true return.
- Per question the outcome is one of:
  - **answered-correct**
  - **answered-wrong-confident** (answered without a caveat)
  - **answered-wrong-caveated**
  - **escalated**: roommate bothered. Sub-graded on whether the draft claim and the fallback guess were right.
  - **unknown**
- Parse grading (LLM mode): kind matches, and for at_time the time is within ±15 min of the intended one.
- **Answer mode:** one per run (`--mode`, default `auto_when_confident`) decides which writer calls happen. Everyone is visible, and every question targets one roommate (household-wide and hidden members are already covered by the fixtures).
- **All three answer modes from one run:** `buildClaim` + `decide` are pure, so every question is also decided under each mode with no extra model calls. Only the run's configured mode calls the writer. Reported per mode.

### Report
- Per answer mode: n, answered-correct %, wrong-confident %, wrong-caveated %, bother % (escalated), unknown %, draft accuracy, fallback-guess accuracy.
- Breakdowns by persona and by question kind (where the policy is weak shows up here: e.g. future questions are only ever medium/low confidence, so `auto_when_confident` should almost never answer them).
- LLM mode adds parse kind/time accuracy, p50/p95 latency and cost per question (via `tracedModel` + `cost()`).
- Results go to `evals/results/sim-<date>-<mode>-<model>.json`, and a markdown summary is printed and appended like the current evals.

### CLI
`npm run sim -- [--days 14] [--seed 1] [--per-day 3] [--mode auto_when_confident] [--no-noise] [--llm --model claude-haiku-5-5] [--generator claude-sonnet-5-5]`. LLM mode requires `ANTHROPIC_API_KEY`; generation is skipped when the cache exists.

### Cost (LLM mode, defaults)
6 roommates × 14 days × 3 = 252 questions. Generation ≈ 252 short Sonnet calls (≈ $0.10–0.30, once, cached). Agent calls ≈ $0.002/question on Opus (≈ $0.50 per run), ≈ $0.00005 on Haiku. Every billed run needs Jack's OK.

### Layout
`evals/sim/`: `random.ts` (seeded PRNG), `personas.ts`, `timeline.ts` (generation, truth, geofence events), `questions.ts` (schedule and code/LLM text), `grade.ts`, `report.ts`, `run.ts`. Tests sit next to each file, in the core Vitest project. Reuse `evals/report.ts` (`cost`, percentiles) and `tracedModel`.

## Tests (free)
- PRNG determinism; same seed → identical timelines and questions.
- Timeline invariants per persona: sorted, non-overlapping, inside the run, plausible daily counts.
- Geofence derivation: delays within bounds, drop rate ≈ p over a long run, `--no-noise` exact.
- Truth/grading table tests, including until_when at the ±30 min edge and a missed exit.
- Evidence window matches the 14-day rule.
- A small code-mode run end to end (2 days) produces a report with all outcomes summing to n, under all three modes.

## Left to the builder
Exact persona distributions, file-internal structure, the style-hint list, the markdown layout.

## Follow-up (not in this plan)
Option 3, LLM-driven roommates, gets its own design after this ships.
