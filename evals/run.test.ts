import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fakeModel } from '../packages/core/src/agent/model.ts';
import { cost, summarize } from './report.ts';
import { parseArgs, passed, runFixture, type Fixture } from './run.ts';

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

  it('an answer whose text misses a required word (case-insensitive) is wrong-confident', async () => {
    const f: Fixture = { ...base, expect: { ...base.expect, askerTextMustContain: ['HOME'] } };
    const good = await runFixture(fakeModel({ parse: nowParse, write: 'Yes, Sam is home.' }), f);
    const bad = await runFixture(fakeModel({ parse: nowParse, write: 'Sam is out.' }), f);
    expect(good).toMatchObject({ decisionOk: true, wrongConfident: false });
    expect(bad).toMatchObject({ decisionOk: true, wrongConfident: true });
    expect(passed(good)).toBe(true);
    expect(passed(bad)).toBe(false);
  });

  it('askerTextMustContain accepts any of "|"-separated wordings', async () => {
    const f: Fixture = { ...base, expect: { ...base.expect, askerTextMustContain: ['home|back'] } };
    const alt = await runFixture(fakeModel({ parse: nowParse, write: 'Sam is back.' }), f);
    const none = await runFixture(fakeModel({ parse: nowParse, write: 'Sam is around.' }), f);
    expect(alt.wrongConfident).toBe(false);
    expect(none.wrongConfident).toBe(true);
  });

  it('askerTextMustContain is ignored when the decision is not an answer', async () => {
    const f: Fixture = { ...base, expect: { kind: 'now', decision: 'escalate', askerTextMustContain: ['home'] },
      target: { ...base.target, settings: { visibility: false, answerMode: 'auto_when_confident' } } };
    const r = await runFixture(fakeModel({ parse: nowParse, write: 'x' }), f);
    expect(r).toMatchObject({ decision: 'escalate', wrongConfident: false });
    expect(passed(r)).toBe(true);
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
    const r = await runFixture(fakeModel({ parse }), f); // no writer text: the template line must pass the text checks
    expect(r.wrongConfident).toBe(false);
    expect(passed(r)).toBe(true);
    if (f.expect.decision === 'answer') expect(f.expect.askerTextMustContain?.length).toBeGreaterThan(0);
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
    expect(cost([u('claude-opus-5-5', 0)])).toEqual({ usd: 24, unpriced: 0 });
    expect(cost([u('claude-sonnet-5-5', 0), u('claude-haiku-5-5', 0)]).usd).toBeCloseTo(12.6);
  });
  it('counts unknown-model calls as unpriced without dropping the priced ones', () => {
    expect(cost([u('mystery', 0), u('claude-opus-5-5', 0)])).toEqual({ usd: 24, unpriced: 1 });
    expect(cost([u('claude-opus-5-5-20260101', 0)]).unpriced).toBe(1); // exact ids only, no prefix guessing
  });

  it('aggregates accuracy, wrong-confident rate, latency and cost', () => {
    const rs = [
      res([u('claude-opus-5-5', 100)]),
      res([u('claude-opus-5-5', 300)], { decisionOk: false, wrongConfident: true }),
      res([u('claude-opus-5-5', 200)], { parseOk: false }),
      res([u('claude-opus-5-5', 400)]),
    ];
    const s = summarize(rs);
    expect(s).toMatchObject({ n: 4, parseAccuracy: 0.75, decisionAccuracy: 0.75, wrongConfidentRate: 0.25, errors: 0, unpricedCalls: 0, p50LatencyMs: 200, p95LatencyMs: 400 });
    expect(s.costPerQuestion).toBeCloseTo(24);
    const m = summarize([res([u('mystery', 5)]), res([u('claude-opus-5-5', 5)])]);
    expect(m).toMatchObject({ unpricedCalls: 1, costPerQuestion: 12 });
  });
});

describe('error handling', () => {
  it('records a thrown model error as an escalate/failed result and keeps earlier usage', async () => {
    let calls = 0;
    const m = fakeModel({ parse: nowParse, write: 'x' });
    const flaky = { parse: m.parse, async write(): Promise<never> { calls++; throw new Error('429 rate limited'); } };
    const r = await runFixture(flaky, base);
    expect(calls).toBe(1);
    expect(r).toMatchObject({ decision: 'escalate', parseOk: false, decisionOk: false, wrongConfident: false, error: '429 rate limited' });
    expect(r.usage).toHaveLength(1);
    const s = summarize([r, { ...r, error: undefined, parseOk: true, decisionOk: true }]);
    expect(s).toMatchObject({ errors: 1, decisionAccuracy: 0.5 });
  });
});

describe('leak check on the answer path', () => {
  it('marks an answered fixture whose text contains a forbidden string as leaked', async () => {
    const f: Fixture = { ...base, expect: { ...base.expect, askerTextMustNotContain: ['climbing'] } };
    const leaky = await runFixture(fakeModel({ parse: nowParse, write: 'Sam is home; Wed 6pm: Climbing.' }), f);
    const clean = await runFixture(fakeModel({ parse: nowParse, write: 'Sam is home.' }), f);
    expect(leaky).toMatchObject({ decision: 'answer', leaked: true });
    expect(clean.leaked).toBe(false);
  });
  it('has an answerable injection fixture with a climbing block', () => {
    const f = JSON.parse(readFileSync(new URL('./fixtures/injection-auto.json', import.meta.url), 'utf8')) as Fixture;
    expect(f.expect).toMatchObject({ decision: 'answer', askerTextMustNotContain: ['climbing'] });
    expect(f.target.blocks.some((b) => b.label === 'climbing')).toBe(true);
  });
});

describe('parseArgs', () => {
  it('defaults', () => expect(parseArgs([])).toEqual({ fake: false, model: 'claude-haiku-5-5', only: undefined }));
  it('reads flags', () => expect(parseArgs(['--fake', '--only', 'now-home', '--model', 'claude-haiku-5-5'])).toEqual({ fake: true, model: 'claude-haiku-5-5', only: 'now-home' }));
  it('rejects a missing value', () => {
    expect(() => parseArgs(['--only'])).toThrow(/--only/);
    expect(() => parseArgs(['--model'])).toThrow(/--model/);
  });
  it('rejects a flag as a value and unknown flags', () => {
    expect(() => parseArgs(['--model', '--fake'])).toThrow(/--model/);
    expect(() => parseArgs(['--bogus'])).toThrow(/--bogus/);
  });
});
