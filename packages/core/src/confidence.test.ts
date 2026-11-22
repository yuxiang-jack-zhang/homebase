import { describe, expect, it } from 'vitest';
import { buildClaim } from './confidence.ts';
import type { AwayBlock, Evidence, ParsedQuestion, PresenceEvent } from './types.ts';

const TZ = 'UTC';
const N = '2027-01-05T12:00:00Z'; // Tuesday
const at = (h: string) => `2027-01-05T${h}:00Z`;
const enter = (h: string): PresenceEvent => ({ kind: 'enter', at: at(h) });
const exit = (h: string): PresenceEvent => ({ kind: 'exit', at: at(h) });
const tueBlock: AwayBlock = { daysOfWeek: [2], startLocal: '14:00', endLocal: '18:00' };
const nowBlock: AwayBlock = { daysOfWeek: [2], startLocal: '11:00', endLocal: '13:00' };
const ev = (presence: PresenceEvent[], blocks: AwayBlock[] = []): Evidence => ({ now: N, timezone: TZ, presence, blocks });
const q = (kind: ParsedQuestion['kind'], aboutTime: string | null = null): ParsedQuestion => ({ kind, aboutTime });

describe('buildClaim', () => {
  it('unclear -> null', () => expect(buildClaim(q('unclear'), ev([]))).toBeNull());
  it('at_time with null time -> null', () => expect(buildClaim(q('at_time'), ev([]))).toBeNull());

  it('now, known presence -> high/presence', () =>
    expect(buildClaim(q('now'), ev([enter('08:00')]))).toEqual({ kind: 'now', aboutTime: null, predictedState: 'home', predictedTime: null, confidence: 'high', basis: 'presence' }));
  it('now, away -> high/presence', () =>
    expect(buildClaim(q('now'), ev([exit('08:00')]))).toMatchObject({ predictedState: 'away', confidence: 'high', basis: 'presence' }));
  it('now, unknown -> low/none', () =>
    expect(buildClaim(q('now'), ev([]))).toMatchObject({ predictedState: null, confidence: 'low', basis: 'none' }));

  it('past at_time, known -> high from history', () =>
    expect(buildClaim(q('at_time', at('09:00')), ev([enter('08:00'), exit('10:00')]))).toMatchObject({ kind: 'at_time', aboutTime: at('09:00'), predictedState: 'home', confidence: 'high', basis: 'presence' }));
  it('past at_time, unknown -> low/none', () =>
    expect(buildClaim(q('at_time', at('07:00')), ev([enter('08:00')]))).toMatchObject({ predictedState: null, confidence: 'low', basis: 'none' }));
  it('T == N counts as past', () =>
    expect(buildClaim(q('at_time', N), ev([exit('08:00')]))).toMatchObject({ predictedState: 'away', confidence: 'high' }));

  it('future, block covers T, not covering N -> away/medium/block', () =>
    expect(buildClaim(q('at_time', at('15:00')), ev([enter('08:00')], [tueBlock]))).toMatchObject({ predictedState: 'away', confidence: 'medium', basis: 'block' }));
  it('future, block covers T and N but P(N) away -> away/medium/block', () => {
    const b: AwayBlock = { daysOfWeek: [2], startLocal: '11:00', endLocal: '18:00' };
    expect(buildClaim(q('at_time', at('15:00')), ev([exit('11:30')], [b]))).toMatchObject({ confidence: 'medium', basis: 'block' });
  });
  it('future, block covers T and N while home -> away/low/block_contradicted', () => {
    const b: AwayBlock = { daysOfWeek: [2], startLocal: '11:00', endLocal: '18:00' };
    expect(buildClaim(q('at_time', at('15:00')), ev([enter('08:00')], [b]))).toMatchObject({ predictedState: 'away', confidence: 'low', basis: 'block_contradicted' });
  });
  it('future, no block, home, within 60 min -> home/medium/recent_presence', () =>
    expect(buildClaim(q('at_time', at('13:00')), ev([enter('08:00')], [nowBlock]))).toMatchObject({ predictedState: 'home', confidence: 'medium', basis: 'recent_presence' }));
  it('future, no block, home, 61 min -> null/low/none', () =>
    expect(buildClaim(q('at_time', '2027-01-05T13:01:00Z'), ev([enter('08:00')]))).toMatchObject({ predictedState: null, confidence: 'low', basis: 'none' }));
  it('future, no block, away -> null/low/none', () =>
    expect(buildClaim(q('at_time', at('12:30')), ev([exit('08:00')]))).toMatchObject({ predictedState: null, confidence: 'low', basis: 'none' }));

  it('until_when, home -> home at N, high', () =>
    expect(buildClaim(q('until_when'), ev([enter('08:00')]))).toMatchObject({ kind: 'until_when', predictedState: 'home', predictedTime: N, confidence: 'high', basis: 'presence' }));
  it('until_when, away in block -> block end, medium', () =>
    expect(buildClaim(q('until_when'), ev([exit('11:30')], [nowBlock]))).toMatchObject({ predictedState: 'away', predictedTime: '2027-01-05T13:00:00.000Z', confidence: 'medium', basis: 'block' }));
  it('until_when, away without block -> null/low/none', () =>
    expect(buildClaim(q('until_when'), ev([exit('11:30')]))).toEqual({ kind: 'until_when', aboutTime: null, predictedState: null, predictedTime: null, confidence: 'low', basis: 'none' }));
  it('until_when, unknown -> null/low/none', () =>
    expect(buildClaim(q('until_when'), ev([], [nowBlock]))).toMatchObject({ predictedState: null, confidence: 'low', basis: 'none' }));
});
