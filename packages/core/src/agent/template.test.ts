import { describe, expect, it } from 'vitest';
import type { Claim } from '../types.ts';
import { templateAnswer } from './template.ts';

const claim = (o: Partial<Claim>): Claim => ({
  kind: 'now', aboutTime: null, predictedState: 'home', predictedTime: null,
  confidence: 'high', basis: 'presence', ...o,
});

describe('templateAnswer', () => {
  it('null claim or no prediction -> unknown', () => {
    expect(templateAnswer('Sam', null, false)).toBe('Sam: unknown');
    expect(templateAnswer('Sam', claim({ predictedState: null, confidence: 'low', basis: 'none' }), true)).toBe('Sam: unknown');
  });
  it('now', () => {
    expect(templateAnswer('Sam', claim({}), false)).toBe('Sam: home');
    expect(templateAnswer('Sam', claim({ predictedState: 'away' }), false)).toBe('Sam: away');
  });
  it('at_time hedges below high confidence, in the given timezone', () => {
    const c = claim({ kind: 'at_time', aboutTime: '2027-01-06T03:00:00Z', predictedState: 'away', confidence: 'medium', basis: 'block' });
    expect(templateAnswer('Sam', c, false, 'America/Los_Angeles')).toBe('Sam: probably away at 7:00 PM');
  });
  it('until_when', () => {
    expect(templateAnswer('Sam', claim({ kind: 'until_when', predictedTime: '2027-01-05T12:00:00Z' }), false)).toBe('Sam: home now');
    const away = claim({ kind: 'until_when', predictedState: 'away', predictedTime: '2027-01-05T21:00:00Z', confidence: 'medium', basis: 'block' });
    expect(templateAnswer('Sam', away, false)).toBe('Sam: probably away until about 9:00 PM');
  });
  it('caveat appends "not sure"', () => {
    expect(templateAnswer('Sam', claim({}), true)).toBe('Sam: home (not sure)');
  });
});
