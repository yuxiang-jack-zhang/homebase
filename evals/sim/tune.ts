// Tunes the habit thresholds on the code simulation (D74): `npm run sim:tune`. Free, deterministic.
// Tuning seeds 2-4 are kept apart from the reported seed 1 so the headline numbers aren't fitted to it.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Matcher } from '../../packages/core/src/patterns.ts';
import { summarizeSim } from './report.ts';
import { parseSimArgs, simulate, type SimOptions } from './run.ts';

export interface TuneRow { matcher: Matcher; nMin: number; pMin: number; spreadMax: number; correct: number; wrongConfident: number; asked: number }
type Score = Pick<TuneRow, 'correct' | 'wrongConfident'>;

const SEEDS = [2, 3, 4];
const GRID = { matcher: ['weekday', 'daytype'] as Matcher[], nMin: [3, 4, 5, 6], pMin: [0.7, 0.75, 0.8, 0.85, 0.9, 0.95], spreadMax: [20, 30, 45, 60, 90] };

/** The most correct config whose confident-error rate is no worse than the baseline's (ties: fewer errors); null if none beats the baseline. */
export function pickBest(rows: TuneRow[], baseline: Score): TuneRow | null {
  const ok = rows.filter((r) => r.wrongConfident <= baseline.wrongConfident && r.correct > baseline.correct);
  ok.sort((a, b) => b.correct - a.correct || a.wrongConfident - b.wrongConfident);
  return ok[0] ?? null;
}

/** Mean auto_when_confident outcome over the tuning seeds. */
async function score(opts: SimOptions): Promise<Score & { asked: number }> {
  const runs = await Promise.all(SEEDS.map(async (seed) => summarizeSim(await simulate({ ...opts, seed }, { model: null })).modes.auto_when_confident));
  const mean = (f: (m: (typeof runs)[number]) => number) => runs.reduce((s, m) => s + f(m), 0) / runs.length;
  return { correct: mean((m) => m.answered_correct), wrongConfident: mean((m) => m.answered_wrong_confident), asked: mean((m) => m.escalated) };
}

async function main() {
  const base = { ...parseSimArgs([]), mode: 'auto_when_confident' as const };
  const baseline = await score({ ...base, matcher: 'off' });
  const rows: TuneRow[] = [];
  for (const matcher of GRID.matcher) for (const nMin of GRID.nMin) for (const pMin of GRID.pMin) for (const spreadMax of GRID.spreadMax) {
    rows.push({ matcher, nMin, pMin, spreadMax, ...(await score({ ...base, matcher, nMin, pMin, spreadMax })) });
  }
  const best = pickBest(rows, baseline);
  const bestOf = (m: Matcher) => pickBest(rows.filter((r) => r.matcher === m), baseline);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  mkdirSync(`${root}evals/results`, { recursive: true });
  const file = `${root}evals/results/sim-tune-${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(file, JSON.stringify({ seeds: SEEDS, days: base.days, baseline, best, bestWeekday: bestOf('weekday'), bestDaytype: bestOf('daytype'), rows }, null, 2) + '\n');
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.log(`baseline (off): correct ${pct(baseline.correct)}, confidently wrong ${pct(baseline.wrongConfident)}, asked ${pct(baseline.asked)}`);
  for (const [name, r] of [['best', best], ['best weekday', bestOf('weekday')], ['best daytype', bestOf('daytype')]] as const) {
    console.log(r ? `${name}: ${r.matcher} n≥${r.nMin} p≥${r.pMin} spread≤${r.spreadMax}m -> correct ${pct(r.correct)}, confidently wrong ${pct(r.wrongConfident)}, asked ${pct(r.asked)}` : `${name}: none beats the baseline`);
  }
  console.log(`wrote ${file}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
