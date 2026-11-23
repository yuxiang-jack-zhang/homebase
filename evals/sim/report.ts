import type { AnswerMode } from '../../packages/core/src/types.ts';
import { cost } from '../report.ts';
import { MODES, type Outcome } from './grade.ts';
import type { SimResult, SimRow } from './run.ts';

const OUTCOMES: Outcome[] = ['answered_correct', 'answered_wrong_confident', 'answered_wrong_caveated', 'escalated', 'unknown'];
type Tally = { n: number; draftAccuracy: number | null; fallbackAccuracy: number | null; draftGraded: number; fallbackGraded: number } & Record<Outcome, number>;

const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] : 0); // nearest rank

/** Outcome shares (0-1) and draft/fallback accuracy for `rows` under `mode`. Accuracy is null when nothing was graded. */
function tally(rows: SimRow[], mode: AnswerMode): Tally {
  const n = rows.length;
  const grades = rows.map((r) => r.grades[mode]);
  const share = (o: Outcome) => (n ? grades.filter((g) => g.outcome === o).length / n : 0);
  const graded = (xs: (boolean | null)[]) => xs.filter((x): x is boolean => x !== null);
  const acc = (xs: boolean[]) => (xs.length ? xs.filter(Boolean).length / xs.length : null);
  const drafts = graded(grades.map((g) => g.draftCorrect)), guesses = graded(grades.map((g) => g.fallbackCorrect));
  return {
    n, ...(Object.fromEntries(OUTCOMES.map((o) => [o, share(o)])) as Record<Outcome, number>),
    draftAccuracy: acc(drafts), fallbackAccuracy: acc(guesses), draftGraded: drafts.length, fallbackGraded: guesses.length,
  };
}

function groupBy(rows: SimRow[], key: (r: SimRow) => string, mode: AnswerMode) {
  const keys = [...new Set(rows.map(key))].sort();
  return keys.map((k) => ({ key: k, ...tally(rows.filter((r) => key(r) === k), mode) }));
}

export function summarizeSim(res: SimResult) {
  const { rows, options } = res;
  const withCalls = rows.filter((r) => r.calls.length);
  const lat = withCalls.map((r) => r.latencyMs).sort((a, b) => a - b);
  const usage = rows.flatMap((r) => r.calls.map((c) => c.usage));
  const phrased = rows.filter((r) => !r.error);
  return {
    options,
    modes: Object.fromEntries(MODES.map((m) => [m, tally(rows, m)])) as Record<AnswerMode, Tally>,
    byPersona: groupBy(rows, (r) => r.persona, options.mode),
    byKind: groupBy(rows, (r) => r.kind, options.mode),
    model: withCalls.length === 0 ? null : {
      // Questions whose phrasing failed kept template text; they still count everywhere except parse accuracy.
      parseAccuracy: phrased.length ? phrased.filter((r) => r.parseOk).length / phrased.length : null,
      generationErrors: rows.length - phrased.length,
      noOutputCalls: rows.flatMap((r) => r.calls).filter((c) => !c.ok).length,
      p50LatencyMs: pct(lat, 0.5), p95LatencyMs: pct(lat, 0.95),
      costPerQuestion: cost(usage).usd / rows.length,
      unpricedCalls: cost(usage).unpriced,
    },
  };
}
export type SimSummary = ReturnType<typeof summarizeSim>;

const p = (x: number | null) => (x === null ? 'n/a' : `${Math.round(x * 100)}%`);
/** Accuracy with its count, so 0% of 1 doesn't read like 0% of 100. */
const frac = (x: number | null, of: number) => (x === null ? 'n/a' : `${p(x)} (${Math.round(x * of)}/${of})`);
const HEAD = '| correct | wrong, confident | wrong, caveated | asked roommate | unknown |';
const cells = (t: Tally) => `${p(t.answered_correct)} | ${p(t.answered_wrong_confident)} | ${p(t.answered_wrong_caveated)} | ${p(t.escalated)} | ${p(t.unknown)}`;

export function simMarkdown(label: string, date: string, s: SimSummary): string {
  const o = s.options;
  const lines = [
    `\n### Simulated roommates ${date}: ${label} (seed ${o.seed}, ${o.days} days, ${o.perDay}/roommate/day, noise ${o.noise ? 'on' : 'off'})\n`,
    `| answer mode | n ${HEAD} draft right | guess right |`,
    '|---|---|---|---|---|---|---|---|---|',
    ...MODES.map((m) => `| ${m} | ${s.modes[m].n} | ${cells(s.modes[m])} | ${frac(s.modes[m].draftAccuracy, s.modes[m].draftGraded)} | ${frac(s.modes[m].fallbackAccuracy, s.modes[m].fallbackGraded)} |`),
    '',
    `By roommate (${o.mode}):\n`,
    `| roommate | n ${HEAD}`,
    '|---|---|---|---|---|---|---|',
    ...s.byPersona.map((r) => `| ${r.key} | ${r.n} | ${cells(r)} |`),
    '',
    `By question kind (${o.mode}):\n`,
    `| kind | n ${HEAD}`,
    '|---|---|---|---|---|---|---|',
    ...s.byKind.map((r) => `| ${r.key} | ${r.n} | ${cells(r)} |`),
    '',
  ];
  if (s.model) {
    const m = s.model;
    lines.push(
      `Model: parse accuracy ${p(m.parseAccuracy)} · p50 ${m.p50LatencyMs} ms, p95 ${m.p95LatencyMs} ms · $${m.costPerQuestion.toFixed(5)}/question` +
        `${m.unpricedCalls ? ` (+${m.unpricedCalls} unpriced calls)` : ''} · ${m.noOutputCalls} call(s) with no output · ${m.generationErrors} phrasing failure(s)\n`,
    );
  }
  return lines.join('\n');
}
