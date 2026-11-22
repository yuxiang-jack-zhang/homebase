import type { ModelUsage } from '../packages/core/src/agent/model.ts';

export interface FixtureResult {
  name: string; parseOk: boolean; decisionOk: boolean; wrongConfident: boolean; leaked: boolean;
  decision: string; predictedState: string | null; logPrediction: boolean; usage: ModelUsage[]; error?: string;
}

// USD per million tokens [input, output] for prompts <= 100K tokens. Keyed by the exact serving model id (no prefix guessing; unknown ids are reported as unpriced).
export const PRICES: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
};

/** USD for the calls with a known price, plus how many calls had none. */
export function cost(usage: ModelUsage[]): { usd: number; unpriced: number } {
  let usd = 0, unpriced = 0;
  for (const u of usage) {
    const price = PRICES[u.model];
    if (!price) { unpriced++; continue; }
    usd += (u.inputTokens * price[0] + u.outputTokens * price[1]) / 1e6;
  }
  return { usd, unpriced };
}

const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] : 0); // nearest rank

export function summarize(rs: FixtureResult[]) {
  const n = rs.length;
  const rate = (f: (r: FixtureResult) => boolean) => (n ? rs.filter(f).length / n : 0);
  const lat = rs.map((r) => r.usage.reduce((s, u) => s + u.latencyMs, 0)).sort((a, b) => a - b); // per question: parse + write
  const costs = rs.map((r) => cost(r.usage));
  return {
    n,
    parseAccuracy: rate((r) => r.parseOk),
    decisionAccuracy: rate((r) => r.decisionOk),
    wrongConfidentRate: rate((r) => r.wrongConfident),
    errors: rs.filter((r) => r.error !== undefined).length,
    leaks: rs.filter((r) => r.leaked).length,
    p50LatencyMs: pct(lat, 0.5),
    p95LatencyMs: pct(lat, 0.95),
    unpricedCalls: costs.reduce((a, c) => a + c.unpriced, 0),
    costPerQuestion: n ? costs.reduce((a, c) => a + c.usd, 0) / n : null, // priced calls only
  };
}

export function markdown(model: string, date: string, s: ReturnType<typeof summarize>): string {
  const p = (x: number) => `${(x * 100).toFixed(0)}%`;
  return [
    `\n### Eval ${date}: ${model}\n`,
    '| questions | errors | parse acc | decision acc | wrong-confident | leaks | p50 ms | p95 ms | $/question |',
    '|---|---|---|---|---|---|---|---|---|',
    `| ${s.n} | ${s.errors} | ${p(s.parseAccuracy)} | ${p(s.decisionAccuracy)} | ${p(s.wrongConfidentRate)} | ${s.leaks} | ${s.p50LatencyMs} | ${s.p95LatencyMs} | ${s.costPerQuestion === null ? 'n/a' : s.costPerQuestion.toFixed(5)}${s.unpricedCalls ? ` (+${s.unpricedCalls} unpriced calls)` : ''} |`,
    '',
  ].join('\n');
}
