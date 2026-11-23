import { describe, expect, it } from 'vitest';
import type { Claim } from '../../packages/core/src/types.ts';
import { claimCorrect, gradeAllModes, outcome, parseCorrect } from './grade.ts';
import type { SimQuestion } from './questions.ts';
import { iso, localMs, type Interval } from './world.ts';

const MIN = 60_000;
const ask = localMs(0, 12 * 60);
// Away 10:00-14:00 on day 0.
const tl: Interval[] = [{ from: localMs(0, 10 * 60), to: localMs(0, 14 * 60) }];
const q = (kind: SimQuestion['intent']['kind'], aboutMs: number | null = null, askMs = ask): SimQuestion =>
  ({ id: 'q', day: 0, askMs, askerId: 'nine_to_five', targetId: 'stale_blocks', intent: { kind, aboutMs }, text: '', style: 'template' });
const claim = (o: Partial<Claim>): Claim =>
  ({ kind: 'now', aboutTime: null, predictedState: null, predictedTime: null, confidence: 'high', basis: 'presence', ...o });

describe('claimCorrect', () => {
  it('now and at_time compare the predicted state with the hidden truth at the intended instant', () => {
    expect(claimCorrect(claim({ predictedState: 'away' }), q('now'), tl)).toBe(true);
    expect(claimCorrect(claim({ predictedState: 'home' }), q('now'), tl)).toBe(false);
    const at15 = q('at_time', localMs(0, 15 * 60));
    expect(claimCorrect(claim({ kind: 'at_time', predictedState: 'home' }), at15, tl)).toBe(true);
    expect(claimCorrect(claim({ kind: 'at_time', predictedState: 'away' }), at15, tl)).toBe(false);
  });

  it('a claim that predicts nothing is ungraded (null)', () => {
    expect(claimCorrect(null, q('now'), tl)).toBeNull();
    expect(claimCorrect(claim({ confidence: 'low', basis: 'none' }), q('now'), tl)).toBeNull();
  });

  it('until_when while truly home is correct only when the claim says home', () => {
    const home = q('until_when', null, localMs(0, 16 * 60));
    expect(claimCorrect(claim({ kind: 'until_when', predictedState: 'home', predictedTime: iso(home.askMs) }), home, tl)).toBe(true);
    // Missed enter: the app still thinks they're out.
    expect(claimCorrect(claim({ kind: 'until_when', predictedState: 'away', predictedTime: iso(localMs(0, 17 * 60)) }), home, tl)).toBe(false);
  });

  it('until_when while away is correct within 30 min of the true return', () => {
    const away = q('until_when');
    const back = (min: number) => claim({ kind: 'until_when', predictedState: 'away', predictedTime: iso(localMs(0, 14 * 60) + min * MIN), confidence: 'medium', basis: 'block' });
    expect(claimCorrect(back(29), away, tl)).toBe(true);
    expect(claimCorrect(back(-30), away, tl)).toBe(true);
    expect(claimCorrect(back(31), away, tl)).toBe(false);
    expect(claimCorrect(claim({ kind: 'until_when', predictedState: 'home', predictedTime: iso(ask) }), away, tl)).toBe(false);
  });
});

describe('outcome', () => {
  it('maps decision and correctness', () => {
    expect(outcome({ action: 'answer', caveat: false }, true)).toBe('answered_correct');
    expect(outcome({ action: 'answer', caveat: false }, false)).toBe('answered_wrong_confident');
    expect(outcome({ action: 'answer', caveat: true }, false)).toBe('answered_wrong_caveated');
    expect(outcome({ action: 'answer', caveat: true }, true)).toBe('answered_correct');
    expect(outcome({ action: 'escalate' }, true)).toBe('escalated');
    expect(outcome({ action: 'unknown' }, null)).toBe('unknown');
  });
});

describe('gradeAllModes', () => {
  const future = q('at_time', localMs(0, 13 * 60), localMs(0, 9 * 60)); // asked 09:00 about 13:00 (truly away)
  const nowIso = iso(future.askMs);
  const at = (confidence: Claim['confidence'], basis: Claim['basis']) =>
    claim({ kind: 'at_time', aboutTime: iso(future.intent.aboutMs!), predictedState: 'away', confidence, basis });

  it('low confidence: ask_me and auto_when_confident escalate (draft and fallback graded), always_auto answers with a caveat', () => {
    const g = gradeAllModes(at('low', 'block_contradicted'), future, tl, nowIso);
    expect(g.ask_me).toEqual({ outcome: 'escalated', draftCorrect: true, fallbackCorrect: null }); // ask_me never shows a guess
    expect(g.auto_when_confident).toEqual({ outcome: 'escalated', draftCorrect: true, fallbackCorrect: true });
    expect(g.always_auto).toEqual({ outcome: 'answered_correct', draftCorrect: null, fallbackCorrect: null });
  });

  it('medium confidence is answered in auto_when_confident', () => {
    expect(gradeAllModes(at('medium', 'block'), future, tl, nowIso).auto_when_confident.outcome).toBe('answered_correct');
  });

  it('a now question with presence is answered in every mode, ask_me included', () => {
    const g = gradeAllModes(claim({ predictedState: 'home' }), q('now'), tl, iso(ask));
    expect([g.ask_me.outcome, g.auto_when_confident.outcome, g.always_auto.outcome]).toEqual(Array(3).fill('answered_wrong_confident'));
  });
});

describe('parseCorrect', () => {
  const t = localMs(0, 19 * 60);
  it('needs the same kind and, for at_time, a time within 15 min', () => {
    expect(parseCorrect({ kind: 'now', aboutTime: null }, { kind: 'now', aboutMs: null })).toBe(true);
    expect(parseCorrect({ kind: 'unclear', aboutTime: null }, { kind: 'now', aboutMs: null })).toBe(false);
    expect(parseCorrect({ kind: 'at_time', aboutTime: iso(t + 15 * MIN) }, { kind: 'at_time', aboutMs: t })).toBe(true);
    expect(parseCorrect({ kind: 'at_time', aboutTime: iso(t - 16 * MIN) }, { kind: 'at_time', aboutMs: t })).toBe(false);
  });
});
