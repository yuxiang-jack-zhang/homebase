import { describe, expect, it } from 'vitest';
import type { ModeGrade, Outcome } from './grade.ts';
import { simMarkdown, summarizeSim } from './report.ts';
import type { SimResult, SimRow } from './run.ts';

const g = (outcome: Outcome, draftCorrect: boolean | null = null, fallbackCorrect: boolean | null = null): ModeGrade => ({ outcome, draftCorrect, fallbackCorrect });
const row = (o: Partial<SimRow>, all: ModeGrade): SimRow => ({
  id: 'x', persona: 'student', kind: 'now', text: 't', style: 'template', intent: { kind: 'now', aboutTime: null },
  parsed: { kind: 'now', aboutTime: null }, parseOk: true, claim: null, askerText: null, calls: [], latencyMs: 0,
  grades: { ask_me: all, auto_when_confident: all, always_auto: all }, ...o,
});

const result: SimResult = {
  options: { days: 1, seed: 1, perDay: 3, mode: 'auto_when_confident', noise: true, llm: false, model: 'x', generator: 'y' },
  rows: [
    row({ persona: 'student' }, g('answered_correct')),
    row({ persona: 'student', kind: 'at_time' }, g('answered_wrong_confident')),
    row({ persona: 'homebody', kind: 'at_time' }, g('escalated', true, false)),
    row({ persona: 'homebody', kind: 'until_when' }, g('unknown')),
  ],
};

describe('summarizeSim', () => {
  const s = summarizeSim(result);

  it('gives outcome shares and draft/fallback accuracy per mode', () => {
    expect(s.modes.auto_when_confident).toMatchObject({
      n: 4, answered_correct: 0.25, answered_wrong_confident: 0.25, answered_wrong_caveated: 0, escalated: 0.25, unknown: 0.25,
      draftAccuracy: 1, fallbackAccuracy: 0, draftGraded: 1, fallbackGraded: 1,
    });
  });

  it('breaks the run mode down by persona and by kind', () => {
    expect(s.byPersona.map((p) => [p.key, p.n, p.answered_correct])).toEqual([['homebody', 2, 0], ['student', 2, 0.5]]);
    expect(s.byKind.map((k) => [k.key, k.n])).toEqual([['at_time', 2], ['now', 1], ['until_when', 1]]);
  });

  it('leaves model stats empty in code mode', () => {
    expect(s.model).toBeNull();
  });
});

describe('simMarkdown', () => {
  it('has one row per mode and the breakdown tables', () => {
    const md = simMarkdown('code', '2026-11-23', summarizeSim(result));
    expect(md).toContain('| auto_when_confident | 4 | 25% | 25% | 0% | 25% | 25% | 100% (1/1) | 0% (0/1) |');
    expect(md).toContain('| ask_me |');
    expect(md).toContain('| always_auto |');
    expect(md).toContain('| student | 2 |');
    expect(md).toContain('| until_when | 1 |');
  });
});
