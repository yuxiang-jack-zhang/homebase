import { describe, expect, it } from 'vitest';
import { classifyFeedback } from './feedback.ts';
import type { Claim } from './types.ts';

const c = (o: Partial<Claim>): Claim => ({
  kind: 'now', aboutTime: null, predictedState: 'home', predictedTime: null, confidence: 'high', basis: 'presence', ...o,
});

describe('classifyFeedback', () => {
  it('approve/text ignore the claim', () => {
    expect(classifyFeedback(null, 'approve')).toBe('approved');
    expect(classifyFeedback(c({}), 'approve')).toBe('approved');
    expect(classifyFeedback(null, 'text')).toBe('edited');
    expect(classifyFeedback(c({ kind: 'until_when' }), 'text')).toBe('edited');
  });
  it.each(['now', 'at_time'] as const)('yes/no vs state for %s', (kind) => {
    expect(classifyFeedback(c({ kind }), 'yes')).toBe('approved');
    expect(classifyFeedback(c({ kind }), 'no')).toBe('rejected');
    expect(classifyFeedback(c({ kind, predictedState: 'away' }), 'yes')).toBe('rejected');
    expect(classifyFeedback(c({ kind, predictedState: 'away' }), 'no')).toBe('approved');
  });
  it('null when it cannot be judged', () => {
    expect(classifyFeedback(null, 'yes')).toBeNull();
    expect(classifyFeedback(c({ predictedState: null }), 'no')).toBeNull();
    expect(classifyFeedback(c({ kind: 'until_when' }), 'yes')).toBeNull();
    expect(classifyFeedback(c({}), 'not_sure')).toBeNull();
  });
});
