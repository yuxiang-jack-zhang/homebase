import { describe, expect, it } from 'vitest';
import { fakeModel } from '../../packages/core/src/agent/model.ts';
import { PATTERN_DEFAULTS } from '../../packages/core/src/confidence.ts';
import { MODES } from './grade.ts';
import { parseSimArgs, simulate, type SimOptions } from './run.ts';

const base: SimOptions = { days: 2, seed: 1, perDay: 3, mode: 'auto_when_confident', noise: true, llm: false, model: 'claude-haiku-5-5', generator: 'claude-sonnet-5-5', ...PATTERN_DEFAULTS };

describe('parseSimArgs', () => {
  it('has the spec defaults', () => {
    expect(parseSimArgs([])).toEqual({ ...base, days: 14 });
  });

  it('reads every flag', () => {
    expect(parseSimArgs(['--days', '3', '--seed', '9', '--per-day', '2', '--mode', 'always_auto', '--no-noise', '--llm', '--model', 'claude-haiku-5-5', '--generator', 'g']))
      .toEqual({ ...PATTERN_DEFAULTS, days: 3, seed: 9, perDay: 2, mode: 'always_auto', noise: false, llm: true, model: 'claude-haiku-5-5', generator: 'g' });
  });

  it('reads the pattern options', () => {
    expect(parseSimArgs(['--patterns', 'daytype', '--n-min', '5', '--p-min', '0.85']))
      .toMatchObject({ matcher: 'daytype', nMin: 5, pMin: 0.85 });
    // LLM mode runs the production pipeline, which uses the default patterns: setting them there would be a lie in the report.
    expect(() => parseSimArgs(['--llm', '--patterns', 'off'])).toThrow(/--llm/);
    expect(() => parseSimArgs(['--patterns', 'sometimes'])).toThrow(/patterns/);
    expect(() => parseSimArgs(['--p-min', '2'])).toThrow(/p-min/);
  });

  it('rejects unknown flags, missing values, bad numbers and bad modes', () => {
    expect(() => parseSimArgs(['--wat'])).toThrow(/unknown/);
    expect(() => parseSimArgs(['--days'])).toThrow(/needs a value/);
    expect(() => parseSimArgs(['--days', '0'])).toThrow(/positive integer/);
    expect(() => parseSimArgs(['--mode', 'sometimes'])).toThrow(/mode/);
  });
});

describe('simulate (code mode)', () => {
  it('answers every question and grades it under all three modes, the same way for the same seed', async () => {
    const a = await simulate(base, { model: null });
    expect(a.rows).toHaveLength(6 * 2 * 3);
    for (const mode of MODES) {
      const counts = a.rows.reduce<Record<string, number>>((c, r) => ({ ...c, [r.grades[mode].outcome]: (c[r.grades[mode].outcome] ?? 0) + 1 }), {});
      expect(Object.values(counts).reduce((x, y) => x + y, 0)).toBe(a.rows.length);
    }
    expect(a.rows.every((r) => r.parseOk && r.calls.length === 0)).toBe(true); // oracle parse, no model
    expect(await simulate(base, { model: null })).toEqual(a);
  });

  it('a different seed changes the world', async () => {
    const a = await simulate(base, { model: null });
    const b = await simulate({ ...base, seed: 2 }, { model: null });
    expect(b.rows.map((r) => r.id)).not.toEqual(a.rows.map((r) => r.id));
  });
});

describe('simulate with patterns', () => {
  it('uses habits from the warm-up: more future questions answered than with patterns off, deterministically', async () => {
    const off = await simulate({ ...base, days: 3, matcher: 'off' }, { model: null });
    const on = await simulate({ ...base, days: 3, matcher: 'weekday' }, { model: null });
    const basis = (r: typeof on) => r.rows.filter((x) => x.claim?.basis === 'pattern').length;
    expect(basis(off)).toBe(0);
    expect(basis(on)).toBeGreaterThan(0);
    expect(await simulate({ ...base, days: 3, matcher: 'weekday' }, { model: null })).toEqual(on);
  });
});

describe('simulate (model mode)', () => {
  it('runs the real pipeline with the model and records its calls', async () => {
    const m = fakeModel({ parse: { kind: 'now', aboutTime: null }, write: 'Sure.' });
    const res = await simulate({ ...base, days: 1, llm: true }, { model: m });
    expect(res.rows).toHaveLength(18);
    expect(res.rows.every((r) => r.calls.length >= 1 && r.calls[0].step === 'parse')).toBe(true);
    expect(res.rows.filter((r) => r.parsed.kind === 'now').length).toBe(18);
    // Questions whose intent is not "now" were misparsed.
    expect(res.rows.filter((r) => !r.parseOk).length).toBe(res.rows.filter((r) => r.intent.kind !== 'now').length);
  });
});
