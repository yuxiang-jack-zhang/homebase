import { describe, expect, it } from 'vitest';
import { nextArrivalAfter, presenceAt } from './presence.ts';
import type { PresenceEvent } from './types.ts';

const ev = (kind: 'enter' | 'exit', h: string): PresenceEvent => ({ kind, at: `2027-01-05T${h}:00Z` });
const T = (h: string) => `2027-01-05T${h}:00Z`;

describe('presenceAt', () => {
  it('unsorted events: last by time wins', () => {
    const events = [ev('enter', '10:00'), ev('exit', '09:00')];
    expect(presenceAt(events, T('11:00'))).toBe('home');
    expect(events[0].kind).toBe('enter'); // input not mutated
  });
  it('duplicate enters -> home', () => expect(presenceAt([ev('enter', '08:00'), ev('enter', '09:00')], T('10:00'))).toBe('home'));
  it('exit with no prior enter -> away', () => expect(presenceAt([ev('exit', '08:00')], T('10:00'))).toBe('away'));
  it('before first event -> unknown', () => expect(presenceAt([ev('enter', '08:00')], T('07:00'))).toBe('unknown'));
  it('event exactly at `at` counts', () => expect(presenceAt([ev('enter', '08:00')], T('08:00'))).toBe('home'));
});

describe('nextArrivalAfter', () => {
  const events = [ev('enter', '12:00'), ev('exit', '10:00'), ev('enter', '08:00')];
  it('first enter strictly after', () => expect(nextArrivalAfter(events, T('08:00'))).toBe(T('12:00')));
  it('none -> null', () => expect(nextArrivalAfter(events, T('12:00'))).toBeNull());
});
