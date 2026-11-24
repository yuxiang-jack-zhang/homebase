import { describe, expect, it } from 'vitest';
import { pickBest, type TuneRow } from './tune.ts';

const row = (correct: number, wrong: number, nMin = 4): TuneRow =>
  ({ matcher: 'weekday', nMin, pMin: 0.8, spreadMax: 45, correct, wrongConfident: wrong, asked: 1 - correct - wrong });

describe('pickBest', () => {
  it('takes the most correct config whose confident-error rate is no worse than the baseline', () => {
    const rows = [row(0.9, 0.06, 3), row(0.85, 0.05, 4), row(0.8, 0.04, 5)];
    expect(pickBest(rows, { correct: 0.6, wrongConfident: 0.05 })?.nMin).toBe(4);
  });

  it('returns null when nothing beats the baseline without more confident errors', () => {
    expect(pickBest([row(0.9, 0.06), row(0.55, 0.04)], { correct: 0.6, wrongConfident: 0.05 })).toBeNull();
  });

  it('breaks ties on fewer confident errors', () => {
    expect(pickBest([row(0.8, 0.05, 3), row(0.8, 0.03, 6)], { correct: 0.6, wrongConfident: 0.05 })?.nMin).toBe(6);
  });
});
