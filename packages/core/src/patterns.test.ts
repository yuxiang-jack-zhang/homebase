import { describe, expect, it } from 'vitest';
import { comparableInstants, EVIDENCE_DAYS, homeShareAt, typicalReturn } from './patterns.ts';
import type { PresenceEvent } from './types.ts';

const LA = 'America/Los_Angeles';
const H = 3_600_000, MIN = 60_000, DAY = 24 * H;
// Wednesday 2027-01-20 12:00 local (UTC-8). No DST change between mid-November and mid-February.
const NOW = '2027-01-20T20:00:00.000Z';
const localClock = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
const laWall = (iso: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: LA, dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
/** The instant of a Los Angeles wall-clock time (never a DST-gap or repeated time here). */
const la = (date: string, time: string) => ['-07:00', '-08:00'].map((o) => new Date(`${date}T${time}:00${o}`).toISOString()).find((x) => laWall(x) === `${date} ${time}`)!;
const nextDate = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`) + DAY).toISOString().slice(0, 10);
/** Out 21:00, back 03:30 the next morning (LA wall clock), every evening from `from` to `to`. */
function lateNights(from: string, to: string): PresenceEvent[] {
  const out: PresenceEvent[] = [];
  for (let d = from; d <= to; d = nextDate(d)) out.push({ kind: 'exit', at: la(d, '21:00') }, { kind: 'enter', at: la(nextDate(d), '03:30') });
  return out;
}

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

  it('DST: a time skipped by spring forward maps to the first valid instant (03:00); fall back keeps the wall clock', () => {
    const spring = comparableInstants('2027-03-21T09:30:00.000Z', LA, 'weekday', '2027-03-22T00:00:00.000Z'); // Sun 02:30 PDT
    expect(spring[0]).toBe('2027-03-14T10:00:00.000Z'); // 2027-03-14 02:30 never happened: 03:00 PDT
    expect(spring.slice(1).every((x) => localClock(x, LA) === 'Sun 02:30')).toBe(true);
    const fall = comparableInstants('2026-11-08T20:00:00.000Z', LA, 'weekday', '2026-11-09T00:00:00.000Z'); // Sun 12:00 PST
    expect(fall.slice(0, 2)).toEqual(['2026-11-01T20:00:00.000Z', '2026-10-25T19:00:00.000Z']); // PST, then PDT
    expect(fall.every((x) => localClock(x, LA) === 'Sun 12:00')).toBe(true);
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

  it('a day with no return within 18 h counts as a miss', () => {
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

  it('looks ahead the same 18 h either side of midnight', () => {
    const ev = daily(56, 22 * 60, 34 * 60); // out 22:00 to 10:00 the next morning
    expect(typicalReturn(ev, '2027-01-21T07:59:00.000Z', LA, 'weekday')).toMatchObject({ n: 8, median: 34 * 60, hit: 1 }); // Wed 23:59
    expect(typicalReturn(ev, '2027-01-21T08:01:00.000Z', LA, 'weekday')).toMatchObject({ n: 8, median: 10 * 60, hit: 1 }); // Thu 00:01
  });

  it('DST nights: return times are wall-clock minutes after that day\'s midnight (spring forward and fall back)', () => {
    // Saturdays out 21:00, back 03:30 Sunday; one comparable Saturday night is the clock change.
    const spring = lateNights('2027-01-20', '2027-03-19');
    expect(typicalReturn(spring, la('2027-03-20', '22:00'), LA, 'weekday')).toMatchObject({ n: 8, median: 27 * 60 + 30, hit: 1 });
    const fall = lateNights('2026-09-10', '2026-11-06');
    // n 7: across fall back the 8th Saturday is 56 days + 1 h back, outside the evidence window (which `ask` reads as elapsed time).
    expect(typicalReturn(fall, la('2026-11-07', '22:00'), LA, 'weekday')).toMatchObject({ n: 7, median: 27 * 60 + 30, hit: 1 });
  });

  it('ignores days they were home at this time; null when there are none', () => {
    const ev = daily(56, 13 * 60, 14 * 60); // out only 13:00-14:00
    expect(typicalReturn(ev, NOW, LA, 'weekday')).toBeNull(); // at 12:00 they were home
  });
});
