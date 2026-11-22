import { describe, expect, it } from 'vitest';
import { scoreClaim } from './scoring.ts';
import type { PresenceEvent } from './types.ts';

const T = (hm: string, day = '05') => `2027-01-${day}T${hm}:00Z`;
const ev = (kind: 'enter' | 'exit', at: string): PresenceEvent => ({ kind, at });
const CREATED = T('12:00');
const base = { kind: 'at_time' as const, aboutTime: T('19:00'), predictedState: 'home' as const, predictedTime: null, createdAt: CREATED };
const until = { kind: 'until_when' as const, aboutTime: null, predictedState: 'away' as const, predictedTime: T('18:00'), createdAt: CREATED };
const recent = [ev('exit', T('09:00'))];

describe('scoreClaim at_time', () => {
  it('pending before aboutTime', () => expect(scoreClaim(base, recent, T('18:00'))).toBe('pending'));
  it('correct', () => expect(scoreClaim(base, [ev('enter', T('17:00'))], T('20:00'))).toBe('correct'));
  it('incorrect', () => expect(scoreClaim(base, recent, T('20:00'))).toBe('incorrect'));
  it('unscored without events in window', () =>
    expect(scoreClaim(base, [ev('enter', T('10:00', '01'))], T('20:00'))).toBe('unscored'));
  it('unscored when state unknown at aboutTime', () =>
    expect(scoreClaim(base, [ev('enter', T('19:30'))], T('20:00'))).toBe('unscored'));
  it('unscored with null aboutTime or predictedState', () => {
    expect(scoreClaim({ ...base, aboutTime: null }, recent, T('20:00'))).toBe('unscored');
    expect(scoreClaim({ ...base, predictedState: null }, recent, T('20:00'))).toBe('unscored');
  });
  it('window is inclusive on both ends', () => {
    expect(scoreClaim(base, [ev('enter', T('12:00', '03'))], T('20:00'))).toBe('correct'); // createdAt-48h
    expect(scoreClaim(base, [ev('enter', T('12:00', '03')), ev('exit', T('12:01', '03'))], T('20:00'))).toBe('incorrect');
    expect(scoreClaim(base, [ev('enter', T('11:59', '03'))], T('20:00'))).toBe('unscored');
    expect(scoreClaim({ ...base, aboutTime: T('19:00') }, [ev('exit', T('19:00'))], T('19:00'))).toBe('incorrect'); // at now
  });
});

describe('scoreClaim until_when', () => {
  it('arrival +20 min correct', () => expect(scoreClaim(until, [...recent, ev('enter', T('18:20'))], T('19:00'))).toBe('correct'));
  it('arrival exactly at tolerance correct', () => expect(scoreClaim(until, [...recent, ev('enter', T('18:30'))], T('19:00'))).toBe('correct'));
  it('arrival +40 min incorrect', () => expect(scoreClaim(until, [...recent, ev('enter', T('18:40'))], T('19:00'))).toBe('incorrect'));
  it('custom tolerance', () => expect(scoreClaim(until, [...recent, ev('enter', T('18:40'))], T('19:00'), 45)).toBe('correct'));
  it('early arrival beyond tolerance incorrect', () => expect(scoreClaim(until, [...recent, ev('enter', T('17:00'))], T('19:00'))).toBe('incorrect'));
  it('no arrival before deadline pending', () => expect(scoreClaim(until, recent, T('18:29'))).toBe('pending'));
  it('no arrival after deadline incorrect', () => expect(scoreClaim(until, recent, T('18:30'))).toBe('incorrect'));
  it('arrival exactly at createdAt is not counted (strict >)', () =>
    expect(scoreClaim(until, [ev('enter', CREATED)], T('18:00'))).toBe('pending'));
  it('no events in window unscored', () => expect(scoreClaim(until, [], T('19:00'))).toBe('unscored'));
  it('null predictedTime unscored', () => expect(scoreClaim({ ...until, predictedTime: null }, recent, T('19:00'))).toBe('unscored'));
});
