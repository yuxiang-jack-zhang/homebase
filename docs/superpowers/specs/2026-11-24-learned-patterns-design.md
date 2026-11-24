# Learned arrival patterns: design

Status: draft for Jack's review, 2026-11-24. Backlog #7, moved up.

## Why

The simulated-roommate eval (D63) found where answer quality is lost:
- **75% of future "will Sam be home at 7?" questions go to the roommate.** Without an away block there is no evidence about the future.
- **Most confident errors are "when is Sam back?" answered from an away block's end time.** Gym days, stale schedules and undeclared trips all break it.

People are habitual. Each person's own enter/exit history says when they usually get home, so the agent should use it. Success is measured free with the code-mode simulation, before and after, on the same questions.

## Goals

- Predict a future home/away state, and a typical return time, from the person's own visible presence history.
- **Strong patterns become medium-confidence claims,** so "answer if confident" answers them automatically. That's the fewest bothers (Jack chose option A). Weaker patterns become low confidence: they improve drafts and fallback guesses, and `always_auto` answers them with a caveat.
- **Thresholds are tuned on the simulation** so confident errors don't rise above today's level while correct automatic answers go up. Tune on some seeds and report on others, so the numbers aren't overfitted.
- Keep the alternatives measurable: the pattern matcher is an option, and the simulation compares them.

## Non-goals

- No location sampling or ETAs (separate backlog item).
- No stored pattern tables, nightly jobs or ML model in this version (see Approaches).
- No new UI. The asker sees the same kind of line as today ("Sam is probably home at 7:00 PM").

## Anti-goals

- **Revealing a routine.** The writer still gets only the claim, so the asker learns "probably home at 7", never "Sam usually gets home around 6 on weekdays".
- **Using data the asker can't see.** Patterns use only the evidence `ask` already gets: visible events, after the last hidden one, after the asker joined (D55, D68).
- **Tuning that only flatters seed 1.** Tune on seeds 2–4, report seed 1 and the tuning seeds.
- **More confident errors.** Default-mode confident errors must not exceed today's in the simulation (5% overall in `auto_when_confident`, seed 1).

## Approaches considered

1. **Compute on the spot from history (chosen).** A pure function in `packages/core` reads about 8 weeks of the person's events and compares the same time of day on similar past days. No new tables; easy to test and simulate.
2. **Stored patterns from a nightly job.** Precompute each person's routine into a table. Kept as an alternative for when computing per question becomes slow (long histories, many targets). Cons: stale between runs, more infrastructure, and it stores a routine summary at rest.
3. **A statistical model** (smoothed hour-of-week probabilities, logistic regression). Kept as an alternative if the simple matcher plateaus in the simulation. Cons: harder to explain, test and tune.

Jack: go with 1 but keep the alternatives. The code keeps a seam (`patterns` option in `buildClaim`) where 2 or 3 could plug in, and the simulation can compare matchers.

## Design

### Evidence window
- `EVIDENCE_DAYS = 56`, a shared constant in core, replaces the hard-coded 14 in `packages/core/src/data.ts` `evidence()` and in `evals/sim/world.ts` `evidenceAt()`.
- The join cutoff (`visibleFrom`) and the hidden-event rule still apply.
- The code simulation's warm-up grows to 56 days (the LLM-roommate simulation keeps its own warm-up).

### Pattern functions (`packages/core/src/patterns.ts`)
- **`similarDays(t, tz, matcher)`:** the local dates of up to 8 previous comparable days, at the same local time of day as `t`. `matcher` is `'weekday'` (same weekday) or `'daytype'` (weekday vs weekend).
- **`homeShareAt(events, t, tz, matcher)` → `{ n, home }`:** for each comparable day, the state at the same local time from `presenceAt`. A day counts only if the state is known there, i.e. some event precedes it within the window.
- **`typicalReturn(events, now, tz, matcher)` → `{ n, minutes[] }`:** for each comparable day where the person was away at `now`'s local time, the local time of their next `enter` that day, before 05:00 the next morning. The claim's return time is the median, and the spread is the interquartile range.

### Claims (`packages/core/src/confidence.ts` `buildClaim`)
`buildClaim(parsed, ev, opts?)` with `opts.patterns: 'off' | 'weekday' | 'daytype'` (default chosen by tuning). New `basis: 'pattern'`.
- **`now` and past `at_time`:** unchanged (presence, high confidence).
- **Future `at_time`:**
  1. If the pattern is strong (`n ≥ N_MIN` and agreement ≥ `P_MIN`): medium, basis `pattern`. This wins over an away block that says otherwise, since a contradicting habit is how stale blocks show up. If the block agrees, still medium (basis `pattern`).
  2. Otherwise the existing rules (block / block_contradicted / recent_presence) apply.
  3. Then a weak pattern (`n ≥ 2`, agreement ≥ 60%) gives low confidence, basis `pattern`, instead of "no prediction".
- **`until_when` while away:**
  1. A strong return pattern (`n ≥ N_MIN` and IQR ≤ `SPREAD_MAX` minutes, median after now) gives medium, basis `pattern`, with the median as the return time. It wins over a block end.
  2. Otherwise the existing block rule applies.
  3. Then a weak pattern gives low confidence.
- **Policy (`decide`) is unchanged.** Medium is answered in `auto_when_confident`; low escalates there and is answered with a caveat in `always_auto`.
- Thresholds are named constants (`N_MIN`, `P_MIN`, `SPREAD_MAX`, defaults to be tuned, starting at 4 / 0.8 / 45).

### The simulation
- `npm run sim -- --patterns off|weekday|daytype` (default: the tuned choice). The results file records the option.
- The report compares runs; `off` reproduces today's numbers.
- Tuning: a small script or flag sweeps `N_MIN` × `P_MIN` × `SPREAD_MAX` × matcher on seeds 2–4. The chosen values are the most correct automatic answers whose confident-error rate is ≤ the `off` baseline.

### What else is touched
- **`Claim['basis']`** gains `'pattern'`. Check every switch on `basis` (template, prompts, scoring, mobile) still handles it.
- **The writer's facts** say nothing about the basis today, and keep it that way: no "usually", which would reveal a routine.
- **Evals:** the existing 24 fixtures have little history, so patterns don't apply and they should still pass (checked free by the oracle test). Add 2 fixtures with 8 weeks of generated history (one strong at-time pattern, one return pattern) so the fixture set covers the new path. A billed run needs Jack's OK.
- **DB:** no schema change. `ask` reads more rows per target (about 56 days × a few events); the existing index `(household_id, user_id, at desc)` covers it.

## Tests (free)
- Pattern functions: comparable days for each matcher, across a week boundary; unknown days are skipped; median and IQR; a return after midnight; hidden-period and join cutoffs are respected through `evidence`.
- `buildClaim`: a strong pattern gives medium/pattern; a weak one gives low; a pattern contradicting a block wins; an agreeing one stays medium; `patterns: 'off'` gives exactly today's claims (regression).
- Simulation: `--patterns off` reproduces the committed baseline numbers; a small seeded run with patterns gives deterministic results.
- Data: `evidence()` returns 56 days.

## Left to the builder
The exact comparable-day rules at edges (DST weeks, the first weeks of history), the tuning script's shape, and the extra fixtures' details.

## Calls I made (for Jack to check)
- 8 weeks of history, 56-day evidence.
- Strong = at least 4 comparable days with at least 80% agreement (at-time), or a return-time spread of at most 45 min (until-when), before tuning.
- A strong pattern beats a contradicting away block.
- Tune on seeds 2–4, report seed 1.
- The writer never mentions habits.
