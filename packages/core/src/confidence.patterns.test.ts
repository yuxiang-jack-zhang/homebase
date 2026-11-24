import { describe, expect, it } from 'vitest';
import { buildClaim, PATTERN_DEFAULTS } from './confidence.ts';
import type { AwayBlock, Evidence, PresenceEvent } from './types.ts';

// UTC household; NOW is Wednesday 2027-01-20 12:00.
const NOW = '2027-01-20T12:00:00.000Z';
const H = 3_600_000, MIN = 60_000, DAY = 24 * H;
const MIDNIGHT = Date.parse('2027-01-20T00:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const today = (h: number, m = 0) => iso(MIDNIGHT + h * H + m * MIN);

/** 8 weeks of one outing per day; `back` may vary per day index (1 = yesterday). */
function history(leave: number, back: (i: number) => number, days = 56): PresenceEvent[] {
  const out: PresenceEvent[] = [];
  for (let i = days; i >= 1; i--) {
    out.push({ kind: 'exit', at: iso(MIDNIGHT - i * DAY + leave * MIN) }, { kind: 'enter', at: iso(MIDNIGHT - i * DAY + back(i) * MIN) });
  }
  return out;
}
const ev = (presence: PresenceEvent[], blocks: AwayBlock[] = []): Evidence => ({ now: NOW, timezone: 'UTC', presence, blocks });
const on = { matcher: 'weekday' } as const;
const at = (t: string) => ({ kind: 'at_time', aboutTime: t } as const);
const until = { kind: 'until_when', aboutTime: null } as const;

describe('buildClaim with patterns', () => {
  const nineToSix = history(9 * 60, () => 18 * 60); // out 09:00-18:00 every day; home now? no: at 12:00 today they'd be out, but today has no events
  const outNow = [...nineToSix, { kind: 'exit', at: today(9) } as PresenceEvent];

  it('is on by default (D74); matcher off restores the old behaviour; an explicit undefined option keeps the default', () => {
    expect(PATTERN_DEFAULTS.matcher).not.toBe('off');
    expect(buildClaim(at(today(19)), ev(outNow))).toMatchObject({ basis: 'pattern', confidence: 'medium' });
    expect(buildClaim(at(today(19)), ev(outNow), { matcher: 'off' })).toMatchObject({ basis: 'none', predictedState: null });
    expect(buildClaim(at(today(19)), ev(outNow), { matcher: undefined })).toMatchObject({ basis: 'pattern' });
  });

  it('a strong habit becomes a medium-confidence claim', () => {
    expect(buildClaim(at(today(19)), ev(outNow), on)).toMatchObject({ predictedState: 'home', confidence: 'medium', basis: 'pattern' });
    expect(buildClaim(at(today(15)), ev(outNow), on)).toMatchObject({ predictedState: 'away', confidence: 'medium', basis: 'pattern' });
  });

  it('a weak habit (too few days or too mixed) is low confidence', () => {
    const short = [...history(9 * 60, () => 18 * 60, 15), { kind: 'exit', at: today(9) } as PresenceEvent]; // 2 Wednesdays
    expect(buildClaim(at(today(19)), ev(short), on)).toMatchObject({ predictedState: 'home', confidence: 'low', basis: 'pattern' });
    // Home at 18:30 on 5 of 8 Wednesdays: 62% agreement, below the strong threshold.
    const mixed = [...history(9 * 60, (i) => ([7, 14, 21].includes(i) ? 19 * 60 : 18 * 60)), { kind: 'exit', at: today(9) } as PresenceEvent];
    expect(buildClaim(at(today(18, 30)), ev(mixed), on)).toMatchObject({ predictedState: 'home', confidence: 'low', basis: 'pattern' });
  });

  it('a strong habit beats an away block older than its history; an agreeing block stays medium/pattern', () => {
    const staleBlock: AwayBlock = { daysOfWeek: [3], startLocal: '18:00', endLocal: '23:00' }; // says away at 19:00
    expect(buildClaim(at(today(19)), ev(outNow, [staleBlock]), on)).toMatchObject({ predictedState: 'home', confidence: 'medium', basis: 'pattern' });
    const agreeing: AwayBlock = { daysOfWeek: [3], startLocal: '09:00', endLocal: '18:00' };
    expect(buildClaim(at(today(15)), ev(outNow, [agreeing]), on)).toMatchObject({ predictedState: 'away', confidence: 'medium', basis: 'pattern' });
  });

  it('a block added after the history it contradicts wins (a new class this week)', () => {
    const newClass: AwayBlock = { daysOfWeek: [3], startLocal: '18:00', endLocal: '21:00', createdAt: iso(MIDNIGHT - DAY) };
    expect(buildClaim(at(today(19)), ev(outNow, [newClass]), on)).toMatchObject({ predictedState: 'away', basis: 'block' });
  });

  it('until_when while out: a consistent return time is used, beating an old block end', () => {
    const block: AwayBlock = { daysOfWeek: [3], startLocal: '09:00', endLocal: '17:00' }; // says back at 17:00
    expect(buildClaim(until, ev(outNow, [block]), on)).toMatchObject({ predictedState: 'away', predictedTime: today(18), confidence: 'medium', basis: 'pattern' });
    const newBlock = { ...block, createdAt: iso(MIDNIGHT - DAY) };
    expect(buildClaim(until, ev(outNow, [newBlock]), on)).toMatchObject({ basis: 'block', predictedTime: today(17), confidence: 'medium' });
  });

  it('until_when: two-peaked returns give no pattern claim; an old block that the habit contradicts drops to low', () => {
    // Wednesdays: back 18:00 on 5, 19:15 on 3.
    const twoPeaks = [...history(9 * 60, (i) => ([7, 21, 35].includes(i) ? 19 * 60 + 15 : 18 * 60)), { kind: 'exit', at: today(9) } as PresenceEvent];
    expect(buildClaim(until, ev(twoPeaks), on)).toMatchObject({ basis: 'none' });
    const block: AwayBlock = { daysOfWeek: [3], startLocal: '09:00', endLocal: '17:00' }; // 17:00 is an hour off the habit
    expect(buildClaim(until, ev(twoPeaks, [block]), on)).toMatchObject({ basis: 'block', predictedTime: today(17), confidence: 'low' });
    const close: AwayBlock = { daysOfWeek: [3], startLocal: '09:00', endLocal: '18:00' };
    expect(buildClaim(until, ev(twoPeaks, [close]), on)).toMatchObject({ basis: 'block', confidence: 'medium' });
  });

  it('until_when: a typical return already past falls back to the block', () => {
    const early = [...history(9 * 60, () => 11 * 60), { kind: 'exit', at: today(9) } as PresenceEvent];
    // At 12:00 on past Wednesdays they were home (back at 11), so no away-day history at this hour: block rule applies.
    const block: AwayBlock = { daysOfWeek: [3], startLocal: '09:00', endLocal: '17:00' };
    expect(buildClaim(until, ev(early, [block]), on)).toMatchObject({ basis: 'block', predictedTime: today(17) });
  });

  it('habits are ignored while someone has been away for over a day (a trip): no pattern claim at all', () => {
    const onTrip = [...nineToSix.filter((e) => Date.parse(e.at) < MIDNIGHT - 3 * DAY), { kind: 'exit', at: iso(MIDNIGHT - 3 * DAY + 9 * H) } as PresenceEvent];
    expect(buildClaim(at(today(19)), ev(onTrip), on)).toMatchObject({ basis: 'none', predictedState: null });
    expect(buildClaim(until, ev(onTrip), on)).toMatchObject({ basis: 'none' });
  });

  it('now and past questions still come from presence', () => {
    expect(buildClaim({ kind: 'now', aboutTime: null }, ev(outNow), on)).toMatchObject({ predictedState: 'away', confidence: 'high', basis: 'presence' });
    expect(buildClaim(at(today(10)), ev(outNow), on)).toMatchObject({ predictedState: 'away', confidence: 'high', basis: 'presence' });
  });
});
