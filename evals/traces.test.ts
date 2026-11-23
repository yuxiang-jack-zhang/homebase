import { describe, expect, it } from 'vitest';
import { summarizeTraces, tracesMarkdown, type TraceCallRow } from './traces.ts';

const call = (o: Partial<TraceCallRow>): TraceCallRow => ({
  step: 'parse', model: 'claude-opus-5-5', ok: true, stop_reason: 'end_turn', error: null,
  input_tokens: 1000, output_tokens: 100, latency_ms: 1000, ...o,
});

describe('summarizeTraces', () => {
  const runs = [
    { ok: true, latency_ms: 3000, agent_calls: [call({}), call({ step: 'answer', latency_ms: 2000 })] },
    { ok: true, latency_ms: 5000, agent_calls: [call({ latency_ms: 3000 }), call({ step: 'draft', ok: false, stop_reason: 'refusal' })] },
    { ok: false, latency_ms: 21000, agent_calls: [call({ ok: false, stop_reason: null, error: 'overloaded_error', input_tokens: 0, output_tokens: 0 })] },
  ];
  const s = summarizeTraces(runs);

  it('counts runs, failures and run latency percentiles', () => {
    expect(s).toMatchObject({ runs: 3, failedRuns: 1, p50RunMs: 5000, p95RunMs: 21000, unpricedCalls: 0 });
  });

  it('groups calls by step with latency, tokens and cost', () => {
    expect(s.steps.map((r) => [r.step, r.calls, r.failed])).toEqual([['answer', 1, 0], ['draft', 1, 1], ['parse', 3, 1]]);
    const parse = s.steps.find((r) => r.step === 'parse')!;
    expect(parse).toMatchObject({ p50Ms: 1000, p95Ms: 3000, inputTokens: 2000, outputTokens: 200 });
    expect(parse.usd).toBeCloseTo((2000 * 4 + 200 * 20) / 1e6); // Opus 5.5: $4 in, $20 out per MTok
    expect(s.usd).toBeCloseTo((4000 * 4 + 400 * 20) / 1e6);
  });

  it('names why calls produced nothing', () => {
    expect(s.failures).toEqual([{ reason: 'overloaded_error', calls: 1 }, { reason: 'refusal', calls: 1 }]);
  });

  it('renders markdown, including an empty window', () => {
    expect(tracesMarkdown(7, s)).toContain('| parse | 3 | 1 | 1000 | 3000 | 2000 | 200 |');
    expect(tracesMarkdown(1, summarizeTraces([]))).toContain('0 runs (0 failed)');
  });
});
