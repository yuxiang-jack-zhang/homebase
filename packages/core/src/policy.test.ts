import { describe, expect, it } from 'vitest';
import { decide, fallbackAllowed, shouldLogPrediction } from './policy.ts';
import type { AnswerMode, Claim, Confidence, Decision } from './types.ts';

const NOW = '2027-01-05T12:00:00Z';
const PAST = '2027-01-05T10:00:00Z';
const FUTURE = '2027-01-05T19:00:00Z';

const claim = (o: Partial<Claim>): Claim => ({
  kind: 'now', aboutTime: null, predictedState: 'home', predictedTime: null,
  confidence: 'high', basis: 'presence', ...o,
});
const esc = (hw: boolean): Decision => (hw ? { action: 'unknown' } : { action: 'escalate' });
const ans = (caveat = false): Decision => ({ action: 'answer', caveat });
const set = (visibility: boolean, answerMode: AnswerMode) => ({ visibility, answerMode });
const modes: AnswerMode[] = ['ask_me', 'auto_when_confident', 'always_auto'];

describe('decide', () => {
  describe.each([true, false])('householdWide=%s', (hw) => {
    const d = (c: Claim | null, s = set(true, 'ask_me')) => decide({ claim: c, settings: s, householdWide: hw, now: NOW });

    it('null claim escalates', () => expect(d(null)).toEqual(esc(hw)));

    it.each(modes)('visibility off escalates every kind/timing (%s)', (m) => {
      const s = set(false, m);
      for (const c of [
        claim({ kind: 'now' }),
        claim({ kind: 'at_time', aboutTime: PAST }),
        claim({ kind: 'at_time', aboutTime: FUTURE }),
        claim({ kind: 'until_when', predictedState: 'home' }),
        claim({ kind: 'until_when', predictedState: 'away', predictedTime: FUTURE }),
      ]) expect(d(c, s)).toEqual(esc(hw));
    });

    it.each(modes)('now/history with state answers regardless of mode (%s)', (m) => {
      expect(d(claim({ kind: 'now' }), set(true, m))).toEqual(ans());
      expect(d(claim({ kind: 'at_time', aboutTime: PAST }), set(true, m))).toEqual(ans());
      expect(d(claim({ kind: 'at_time', aboutTime: NOW }), set(true, m))).toEqual(ans());
    });

    it('now/history without state escalates', () => {
      expect(d(claim({ kind: 'now', predictedState: null }))).toEqual(esc(hw));
      expect(d(claim({ kind: 'at_time', aboutTime: PAST, predictedState: null }))).toEqual(esc(hw));
    });

    it('until_when already home answers, even ask_me', () =>
      expect(d(claim({ kind: 'until_when', predictedState: 'home' }))).toEqual(ans()));

    describe('future', () => {
      const futures = (confidence: Confidence) => [
        claim({ kind: 'at_time', aboutTime: FUTURE, confidence }),
        claim({ kind: 'until_when', predictedState: 'away', predictedTime: FUTURE, confidence }),
      ];
      it('ask_me escalates', () => {
        for (const c of futures('high')) expect(d(c, set(true, 'ask_me'))).toEqual(esc(hw));
      });
      it.each([['high', ans()], ['medium', ans()], ['low', esc(hw)]] as const)(
        'auto_when_confident %s', (conf, want) => {
          for (const c of futures(conf)) expect(d(c, set(true, 'auto_when_confident'))).toEqual(want);
        });
      it.each([['high', false], ['medium', false], ['low', true]] as const)(
        'always_auto %s caveat=%s', (conf, caveat) => {
          for (const c of futures(conf)) expect(d(c, set(true, 'always_auto'))).toEqual(ans(caveat));
        });
    });
  });
});

describe('fallbackAllowed', () => {
  it('false for ask_me', () => expect(fallbackAllowed(set(true, 'ask_me'), claim({}))).toBe(false));
  it.each(['auto_when_confident', 'always_auto'] as const)('%s needs a prediction', (m) => {
    expect(fallbackAllowed(set(true, m), claim({}))).toBe(true);
    expect(fallbackAllowed(set(true, m), claim({ predictedState: null, predictedTime: NOW }))).toBe(true);
    expect(fallbackAllowed(set(true, m), claim({ predictedState: null }))).toBe(false);
    expect(fallbackAllowed(set(true, m), null)).toBe(false);
  });
});

describe('shouldLogPrediction', () => {
  it('future at_time with state', () => {
    expect(shouldLogPrediction(claim({ kind: 'at_time', aboutTime: FUTURE }), NOW)).toBe(true);
    expect(shouldLogPrediction(claim({ kind: 'at_time', aboutTime: FUTURE, predictedState: null }), NOW)).toBe(false);
  });
  it('false for past at_time', () => {
    expect(shouldLogPrediction(claim({ kind: 'at_time', aboutTime: PAST }), NOW)).toBe(false);
    expect(shouldLogPrediction(claim({ kind: 'at_time', aboutTime: NOW }), NOW)).toBe(false);
  });
  it('until_when away with time only; false when already home', () => {
    expect(shouldLogPrediction(claim({ kind: 'until_when', predictedState: 'away', predictedTime: FUTURE }), NOW)).toBe(true);
    expect(shouldLogPrediction(claim({ kind: 'until_when', predictedState: 'away', predictedTime: null }), NOW)).toBe(false);
    expect(shouldLogPrediction(claim({ kind: 'until_when', predictedState: 'home' }), NOW)).toBe(false);
  });
  it('false for now', () => expect(shouldLogPrediction(claim({ kind: 'now' }), NOW)).toBe(false));
});
