// Tunes the habit thresholds on the code simulation (D74): `npm run sim:tune`. Free, deterministic.
// Tuning seeds 2-4 are kept apart from the reported seed 1 so the headline numbers aren't fitted to it.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Matcher } from '../../packages/core/src/patterns.ts';
import { summarizeSim } from './report.ts';
import { parseSimArgs, simulate, type SimOptions } from './run.ts';

export interface TuneRow { matcher: Matcher; nMin: number; pMin: number; correct: number; wrongConfident: number; asked: number }
type Score = Pick<TuneRow, 'correct' | 'wrongConfident'>;

const SEEDS = [2, 3, 4];
// Fixed before the sweep (D74): never inspected while designing or tuning. Acceptance: total confidently-wrong with the
// chosen setting <= total with patterns off on these seeds.
const HELD_OUT = [8, 9, 10, 11, 12, 13];
const GRID = { matcher: ['weekday', 'daytype'] as Matcher[], nMin: [3, 4, 5, 6, 7, 8], pMin: [0.7, 0.75, 0.8, 0.85, 0.875, 0.95] }; // n <= 8, so 0.875 = 7/8, 0.95 = all

/** The most correct config whose confident-error rate is no worse than the baseline's (ties: fewer errors); null if none beats the baseline. */
export function pickBest(rows: TuneRow[], baseline: Score): TuneRow | null {
  const ok = rows.filter((r) => r.wrongConfident <= baseline.wrongConfident && r.correct > baseline.correct);
  ok.sort((a, b) => b.correct - a.correct || a.wrongConfident - b.wrongConfident);
  return ok[0] ?? null;
}

/** Mean auto_when_confident outcome over the tuning seeds. */
async function score(opts: SimOptions, seeds = SEEDS): Promise<Score & { asked: number }> {
  const runs = await Promise.all(seeds.map(async (seed) => summarizeSim(await simulate({ ...opts, seed }, { model: null })).modes.auto_when_confident));
  const mean = (f: (m: (typeof runs)[number]) => number) => runs.reduce((s, m) => s + f(m), 0) / runs.length;
  return { correct: mean((m) => m.answered_correct), wrongConfident: mean((m) => m.answered_wrong_confident), asked: mean((m) => m.escalated) };
}

async function main() {
  const base = { ...parseSimArgs([]), mode: 'auto_when_confident' as const };
  const baseline = await score({ ...base, matcher: 'off' });
  const rows: TuneRow[] = [];
  for (const matcher of GRID.matcher) for (const nMin of GRID.nMin) for (const pMin of GRID.pMin) {
    rows.push({ matcher, nMin, pMin, ...(await score({ ...base, matcher, nMin, pMin })) });
  }
  const best = pickBest(rows, baseline);
  // Held-out check, totals over HELD_OUT (means x seeds x questions).
  const total = async (o: SimOptions) => {
    const sc = await score(o, HELD_OUT), q = HELD_OUT.length * base.days * base.perDay * 6;
    return { correct: Math.round(sc.correct * q), wrongConfident: Math.round(sc.wrongConfident * q), asked: Math.round(sc.asked * q) };
  };
  const heldOut = best ? { off: await total({ ...base, matcher: 'off' }), best: await total({ ...base, ...best }) } : null;
  const passed = !!heldOut && heldOut.best.wrongConfident <= heldOut.off.wrongConfident;
  const bestOf = (m: Matcher) => pickBest(rows.filter((r) => r.matcher === m), baseline);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  mkdirSync(`${root}evals/results`, { recursive: true });
  const file = `${root}evals/results/sim-tune-${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(file, JSON.stringify({ seeds: SEEDS, heldOutSeeds: HELD_OUT, days: base.days, baseline, best, heldOut, passed, bestWeekday: bestOf('weekday'), bestDaytype: bestOf('daytype'), rows }, null, 2) + '\n');
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.log(`baseline (off): correct ${pct(baseline.correct)}, confidently wrong ${pct(baseline.wrongConfident)}, asked ${pct(baseline.asked)}`);
  for (const [name, r] of [['best', best], ['best weekday', bestOf('weekday')], ['best daytype', bestOf('daytype')]] as const) {
    console.log(r ? `${name}: ${r.matcher} n≥${r.nMin} p≥${r.pMin} -> correct ${pct(r.correct)}, confidently wrong ${pct(r.wrongConfident)}, asked ${pct(r.asked)}` : `${name}: none beats the baseline`);
  }
  if (heldOut) console.log(`held-out seeds ${HELD_OUT.join(',')} totals: off ${JSON.stringify(heldOut.off)} | best ${JSON.stringify(heldOut.best)} -> ${passed ? 'PASS' : 'FAIL'}`);
  console.log(`wrote ${file}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
