import { describe, expect, it } from 'vitest';
import { comparableInstants, EVIDENCE_DAYS, homeShareAt, typicalReturn } from './patterns.ts';
import type { PresenceEvent } from './types.ts';

const LA = 'America/Los_Angeles';
const H = 3_600_000, MIN = 60_000, DAY = 24 * H;
// Wednesday 2027-01-20 12:00 local (UTC-8). No DST change between mid-November and mid-February.
const NOW = '2027-01-20T20:00:00.000Z';
const localClock = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

/** One exit/enter pair per day for `days` days before NOW, at local (UTC-8) clock minutes. */
function daily(days: number, leaveMin: number, backMin: number, skip: (dayIndex: number) => boolean = () => false): PresenceEvent[] {
  const out: PresenceEvent[] = [];
  const midnight = Date.parse('2027-01-20T08:00:00Z'); // local midnight of NOW's day
  for (let i = days; i >= 1; i--) {
    if (skip(i)) continue;
    const d = midnight - i * DAY;
    out.push({ kind: 'exit', at: new Date(d + leaveMin * MIN).toISOString() }, { kind: 'enter', at: new Date(d + backMin * MIN).toISOString() });
  }
  return out;
}

describe('comparableInstants', () => {
  it('weekday: the same local time on the 8 previous same weekdays, newest first', () => {
    const t = '2027-01-21T03:00:00.000Z'; // Wed 19:00 local, later today
    const xs = comparableInstants(t, LA, 'weekday', NOW);
    expect(xs).toHaveLength(8);
    expect(xs.every((x) => localClock(x, LA) === 'Wed 19:00')).toBe(true);
    expect(Date.parse(xs[0]) - Date.parse(xs[1])).toBe(7 * DAY);
  });

  it('daytype: a weekday time compares with previous weekdays, skipping weekends, and only instants before now', () => {
    const t = '2027-01-21T03:00:00.000Z'; // Wed 19:00, after NOW (Wed 12:00)
    const xs = comparableInstants(t, LA, 'daytype', NOW);
    expect(xs).toHaveLength(8);
    expect(xs.map((x) => localClock(x, LA).slice(0, 3))).toEqual(['Tue', 'Mon', 'Fri', 'Thu', 'Wed', 'Tue', 'Mon', 'Fri']);
    expect(xs.every((x) => Date.parse(x) < Date.parse(NOW))).toBe(true);
  });

  it('works in the household timezone, not UTC', () => {
    const tokyoNow = '2027-01-20T03:00:00.000Z'; // Wed 12:00 in Tokyo
    const xs = comparableInstants('2027-01-20T10:00:00.000Z', 'Asia/Tokyo', 'weekday', tokyoNow); // Wed 19:00 Tokyo
    expect(xs.every((x) => localClock(x, 'Asia/Tokyo') === 'Wed 19:00')).toBe(true);
  });

  it(`never looks back further than the ${EVIDENCE_DAYS}-day evidence window`, () => {
    const xs = comparableInstants('2027-01-21T03:00:00.000Z', LA, 'weekday', NOW, 20);
    expect(xs.every((x) => Date.parse(NOW) - Date.parse(x) <= EVIDENCE_DAYS * DAY)).toBe(true);
  });
});

describe('homeShareAt', () => {
  it('counts comparable days home vs away at that local time', () => {
    const ev = daily(56, 8 * 60, 18 * 60); // out 08:00-18:00 every day
    expect(homeShareAt(ev, '2027-01-21T03:00:00.000Z', LA, 'weekday', NOW)).toMatchObject({ n: 8, home: 8 }); // 19:00: home
    expect(homeShareAt(ev, '2027-01-21T01:00:00.000Z', LA, 'weekday', NOW)).toMatchObject({ n: 8, home: 0 }); // 17:00: away
    expect(homeShareAt(ev, '2027-01-21T03:00:00.000Z', LA, 'weekday', NOW).oldest).toBe('2026-11-26T03:00:00.000Z'); // Wed 2026-11-25 19:00 local, 8 Wednesdays back
  });

  it('skips days whose state is unknown (history shorter than 8 weeks)', () => {
    const ev = daily(20, 8 * 60, 18 * 60); // 20 days: Wednesdays 7 and 14 days back are known, 21 days back isn't
    expect(homeShareAt(ev, '2027-01-21T03:00:00.000Z', LA, 'weekday', NOW)).toMatchObject({ n: 2, home: 2 });
  });
});

describe('typicalReturn', () => {
  it('median return, and the share of comparable away-days back within 30 min of it', () => {
    const ev = daily(56, 8 * 60, 18 * 60, (i) => i % 7 === 0).concat(daily(56, 8 * 60, 18 * 60 + 40, (i) => i % 7 !== 0)); // Wednesdays back 18:40
    const r = typicalReturn(ev.sort((a, b) => a.at.localeCompare(b.at)), NOW, LA, 'weekday');
    expect(r).toMatchObject({ n: 8, median: 18 * 60 + 40, hit: 1 }); // NOW is a Wednesday
  });

  it('two peaks (gym days) are not a consistent return time', () => {
    // Wednesdays: back 18:00 on 5, 19:15 on 3 -> median 18:00, only 5/8 within 30 min.
    const ev = daily(56, 8 * 60, 18 * 60, (i) => [7, 21, 35].includes(i)).concat(daily(56, 8 * 60, 19 * 60 + 15, (i) => ![7, 21, 35].includes(i)));
    const r = typicalReturn(ev.sort((a, b) => a.at.localeCompare(b.at)), NOW, LA, 'weekday')!;
    expect(r.median).toBe(18 * 60);
    expect(r.hit).toBeCloseTo(5 / 8);
  });

  it('a day with no return by 05:00 counts as a miss', () => {
    const ev = daily(56, 8 * 60, 18 * 60, (i) => i === 7).concat([{ kind: 'exit', at: '2027-01-13T16:00:00.000Z' }]); // last Wednesday: left 08:00, never back
    const r = typicalReturn(ev.sort((a, b) => a.at.localeCompare(b.at)), NOW, LA, 'weekday')!;
    expect(r).toMatchObject({ n: 8, median: 18 * 60 });
    expect(r.hit).toBeCloseTo(7 / 8);
  });

  it('a return after midnight counts as minutes past 24:00', () => {
    const late = '2027-01-21T06:00:00.000Z'; // Wed 22:00 local
    const ev = daily(56, 20 * 60, 24 * 60 + 30); // out 20:00 to 00:30 next day
    expect(typicalReturn(ev, late, LA, 'weekday')).toMatchObject({ n: 8, median: 24 * 60 + 30 });
  });

  it('ignores days they were home at this time; null when there are none', () => {
    const ev = daily(56, 13 * 60, 14 * 60); // out only 13:00-14:00
    expect(typicalReturn(ev, NOW, LA, 'weekday')).toBeNull(); // at 12:00 they were home
  });
});
