import type { ModelUsage } from '../packages/core/src/agent/model.ts';

export interface FixtureResult {
  name: string; parseOk: boolean; decisionOk: boolean; wrongConfident: boolean; leaked: boolean;
  decision: string; predictedState: string | null; logPrediction: boolean; usage: ModelUsage[];
}

// USD per million tokens [input, output] for prompts <= 100K tokens. Keyed by prefix of the serving model id.
export const PRICES: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
};

/** Total USD for these calls, or null if any call's model has no known price. */
export function cost(usage: ModelUsage[]): number | null {
  let total = 0;
  for (const u of usage) {
    const key = Object.keys(PRICES).find((k) => u.model.startsWith(k));
    if (!key) return null;
    total += (u.inputTokens * PRICES[key][0] + u.outputTokens * PRICES[key][1]) / 1e6;
  }
  return total;
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
    leaks: rs.filter((r) => r.leaked).length,
    p50LatencyMs: pct(lat, 0.5),
    p95LatencyMs: pct(lat, 0.95),
    costPerQuestion: n && costs.every((c) => c !== null) ? (costs as number[]).reduce((a, b) => a + b, 0) / n : null,
  };
}

export function markdown(model: string, date: string, s: ReturnType<typeof summarize>): string {
  const p = (x: number) => `${(x * 100).toFixed(0)}%`;
  return [
    `\n### Eval ${date}: ${model}\n`,
    '| questions | parse acc | decision acc | wrong-confident | leaks | p50 ms | p95 ms | $/question |',
    '|---|---|---|---|---|---|---|---|',
    `| ${s.n} | ${p(s.parseAccuracy)} | ${p(s.decisionAccuracy)} | ${p(s.wrongConfidentRate)} | ${s.leaks} | ${s.p50LatencyMs} | ${s.p95LatencyMs} | ${s.costPerQuestion === null ? 'n/a' : s.costPerQuestion.toFixed(5)} |`,
    '',
  ].join('\n');
}
