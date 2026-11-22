import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fakeModel } from '../packages/core/src/agent/model.ts';
import { cost, summarize } from './report.ts';
import { runFixture, type Fixture } from './run.ts';

const base: Fixture = {
  name: 'f', now: '2026-11-23T18:00:00Z', timezone: 'America/Los_Angeles', question: 'is Sam home?', householdWide: false,
  target: { name: 'Sam', settings: { visibility: true, answerMode: 'auto_when_confident' }, presence: [{ kind: 'enter', at: '2026-11-23T16:00:00Z' }], blocks: [] },
  expect: { kind: 'now', decision: 'answer', predictedState: 'home' },
};
const nowParse = { kind: 'now', aboutTime: null };

describe('runFixture', () => {
  it('scores a passing fixture', async () => {
    const r = await runFixture(fakeModel({ parse: nowParse, write: 'Yes, Sam is home.' }), base);
    expect(r).toMatchObject({ parseOk: true, decisionOk: true, wrongConfident: false, leaked: false });
    expect(r.usage).toHaveLength(2); // parse + write both recorded
  });

  it('scores a failing fixture and flags a wrong-confident answer', async () => {
    const f: Fixture = { ...base, expect: { kind: 'at_time', decision: 'escalate' } };
    const r = await runFixture(fakeModel({ parse: nowParse, write: 'Yes.' }), f);
    expect(r).toMatchObject({ parseOk: false, decisionOk: false, wrongConfident: true });
  });

  it('flags a wrong predictedState and a leaked substring', async () => {
    const f: Fixture = { ...base, expect: { kind: 'now', decision: 'answer', predictedState: 'away', askerTextMustNotContain: ['climbing'] } };
    const r = await runFixture(fakeModel({ parse: nowParse, write: 'He is at climbing.' }), f);
    expect(r).toMatchObject({ wrongConfident: true, leaked: true });
  });

  it('checks aboutTime within tolerance', async () => {
    const f: Fixture = { ...base, expect: { kind: 'at_time', aboutTimeWithinMin: { iso: '2026-11-23T23:00:00Z', minutes: 15 }, decision: 'escalate' } };
    const near = await runFixture(fakeModel({ parse: { kind: 'at_time', aboutTime: '2026-11-23T23:10:00Z' } }), f);
    const far = await runFixture(fakeModel({ parse: { kind: 'at_time', aboutTime: '2026-11-23T23:30:00Z' } }), f);
    expect([near.parseOk, far.parseOk]).toEqual([true, false]);
  });
});

describe('fixtures follow the core rules', () => {
  const files = readdirSync(new URL('./fixtures', import.meta.url)).filter((n) => n.endsWith('.json'));
  it('has the 20 required categories plus extras', () => expect(files.length).toBeGreaterThanOrEqual(20));
  it.each(files)('%s: a perfect parse yields the expected decision', async (file) => {
    const f: Fixture = JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8'));
    const parse = { kind: f.expect.kind, aboutTime: f.expect.aboutTimeWithinMin?.iso ?? null };
    const r = await runFixture(fakeModel({ parse, write: 'ok' }), f);
    expect(r.parseOk).toBe(true);
    expect(r.decision).toBe(f.expect.decision);
    if (f.expect.predictedState) expect(r.predictedState).toBe(f.expect.predictedState);
    if (f.expect.logPrediction !== undefined) expect(r.logPrediction).toBe(f.expect.logPrediction);
  });
});

describe('report', () => {
  const u = (model: string, latencyMs: number, i = 1_000_000, o = 1_000_000) => ({ inputTokens: i, outputTokens: o, model, latencyMs });
  const res = (usage: ReturnType<typeof u>[], over = {}) => ({
    name: 'x', parseOk: true, decisionOk: true, wrongConfident: false, leaked: false, decision: 'answer', predictedState: null, logPrediction: false, usage, ...over,
  });

  it('prices by the serving model', () => {
    expect(cost([u('claude-opus-5-5', 0)])).toBeCloseTo(24);
    expect(cost([u('claude-sonnet-5-5', 0), u('claude-haiku-5-5', 0)])).toBeCloseTo(12 + 0.6);
  });
  it('returns null cost for an unknown model', () => expect(cost([u('mystery', 0)])).toBeNull());

  it('aggregates accuracy, wrong-confident rate, latency and cost', () => {
    const rs = [
      res([u('claude-opus-5-5', 100)]),
      res([u('claude-opus-5-5', 300)], { decisionOk: false, wrongConfident: true }),
      res([u('claude-opus-5-5', 200)], { parseOk: false }),
      res([u('claude-opus-5-5', 400)]),
    ];
    const s = summarize(rs);
    expect(s).toMatchObject({ n: 4, parseAccuracy: 0.75, decisionAccuracy: 0.75, wrongConfidentRate: 0.25, p50LatencyMs: 200, p95LatencyMs: 400 });
    expect(s.costPerQuestion).toBeCloseTo(24);
    expect(summarize([res([u('mystery', 5)])]).costPerQuestion).toBeNull();
  });
});
