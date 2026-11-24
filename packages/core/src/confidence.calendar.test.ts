import { describe, expect, it } from 'vitest';
import { answerUser, draftUser } from './agent/prompts.ts';
import { buildClaim } from './confidence.ts';
import type { AwayBlock, Evidence, PresenceEvent } from './types.ts';

// UTC household; NOW is Wednesday 2027-01-20 12:00.
const NOW = '2027-01-20T12:00:00.000Z';
const H = 3_600_000, MIN = 60_000, DAY = 24 * H;
const MIDNIGHT = Date.parse('2027-01-20T00:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const today = (h: number, m = 0) => iso(MIDNIGHT + h * H + m * MIN);
const period = (from: number, to: number) => ({ start: today(from), end: today(to) });

/** 8 weeks of one outing per day, from `leave` to `back` (minutes after midnight). */
function history(leave: number, back: number): PresenceEvent[] {
  const out: PresenceEvent[] = [];
  for (let i = 56; i >= 1; i--) {
    out.push({ kind: 'exit', at: iso(MIDNIGHT - i * DAY + leave * MIN) }, { kind: 'enter', at: iso(MIDNIGHT - i * DAY + back * MIN) });
  }
  return out;
}
const ev = (presence: PresenceEvent[], awayPeriods: Evidence['awayPeriods'], blocks: AwayBlock[] = []): Evidence =>
  ({ now: NOW, timezone: 'UTC', presence, blocks, awayPeriods });
const at = (t: string) => ({ kind: 'at_time', aboutTime: t } as const);
const until = { kind: 'until_when', aboutTime: null } as const;
const home = [{ kind: 'enter', at: today(8) } as PresenceEvent];
const away = [{ kind: 'exit', at: today(9) } as PresenceEvent];
const calendarAway = { predictedState: 'away', confidence: 'medium', basis: 'calendar' } as const;

describe('buildClaim with calendar away periods', () => {
  it('during a trip (out for over a day) a short event\'s end is not a "back at" time', () => {
    const onTrip = [{ kind: 'exit', at: iso(MIDNIGHT - 3 * DAY) } as PresenceEvent];
    expect(buildClaim(until, ev(onTrip, [period(11.5, 12.5)]))).toMatchObject({ basis: 'none' });
    expect(buildClaim(at(today(12, 15)), ev(onTrip, [period(11.5, 12.5)]))).toMatchObject(calendarAway); // away during it still holds
  });

  it('future at_time inside a period -> away/medium/calendar', () =>
    expect(buildClaim(at(today(15)), ev(home, [period(14, 17)]))).toMatchObject({ kind: 'at_time', aboutTime: today(15), predictedTime: null, ...calendarAway }));

  it('future at_time outside every period -> as without periods', () => {
    const periods = [period(14, 17), period(18, 19)];
    for (const t of [today(12, 30), today(17), today(17, 30), today(20)]) {
      expect(buildClaim(at(t), ev(home, periods))).toEqual(buildClaim(at(t), ev(home, undefined)));
    }
  });

  it('wins over a strong habit and over a block', () => {
    const homeAt3 = history(9 * 60, 13 * 60); // back by 13:00 every day
    expect(buildClaim(at(today(15)), ev(homeAt3, undefined))).toMatchObject({ predictedState: 'home', basis: 'pattern' });
    expect(buildClaim(at(today(15)), ev(homeAt3, [period(14, 17)]))).toMatchObject(calendarAway);
    const block: AwayBlock = { daysOfWeek: [3], startLocal: '14:00', endLocal: '16:00' };
    expect(buildClaim(until, ev(away, [period(9, 14)], [block]), { matcher: 'off' })).toMatchObject({ ...calendarAway, predictedTime: today(14) });
    expect(buildClaim(at(today(15)), ev(home, [period(14, 17)], [block]), { matcher: 'off' })).toMatchObject(calendarAway);
  });

  it('until_when while away inside a period -> back at its end, over the habit and the block', () => {
    const backAt6 = [...history(9 * 60, 18 * 60), ...away];
    expect(buildClaim(until, ev(backAt6, undefined))).toMatchObject({ predictedTime: today(18), basis: 'pattern' });
    const block: AwayBlock = { daysOfWeek: [3], startLocal: '09:00', endLocal: '17:00' };
    expect(buildClaim(until, ev(backAt6, [period(9, 14)], [block]))).toEqual({
      kind: 'until_when', aboutTime: null, predictedState: 'away', predictedTime: today(14), confidence: 'medium', basis: 'calendar',
    });
  });

  it('until_when while away with no period covering now -> as without periods', () =>
    expect(buildClaim(until, ev(away, [period(14, 17)]))).toEqual(buildClaim(until, ev(away, undefined))));

  it('home now during a period (they skipped it): presence wins, and later in that period is not claimed away', () => {
    const skipped = [period(9, 17)];
    expect(buildClaim(until, ev(home, skipped))).toMatchObject({ predictedState: 'home', basis: 'presence' });
    expect(buildClaim({ kind: 'now', aboutTime: null }, ev(home, skipped))).toMatchObject({ predictedState: 'home', basis: 'presence' });
    expect(buildClaim(at(today(15)), ev(home, skipped))).toEqual(buildClaim(at(today(15)), ev(home, undefined)));
    // A later event is still evidence.
    expect(buildClaim(at(today(18, 30)), ev(home, [...skipped, period(18, 20)]))).toMatchObject(calendarAway);
  });

  it('periods are ignored for now and past questions', () => {
    const periods = [period(6, 13)];
    expect(buildClaim({ kind: 'now', aboutTime: null }, ev(away, periods))).toEqual(buildClaim({ kind: 'now', aboutTime: null }, ev(away, undefined)));
    expect(buildClaim({ kind: 'now', aboutTime: null }, ev([], periods))).toMatchObject({ predictedState: null, basis: 'none' });
    expect(buildClaim(at(today(10)), ev(home, periods))).toMatchObject({ predictedState: 'home', basis: 'presence' });
    expect(buildClaim(at(today(7)), ev([], periods))).toMatchObject({ predictedState: null, basis: 'none' });
  });

  it('the writer never learns a calendar was the source', () => {
    const claim = buildClaim(until, ev(away, [period(9, 17)]))!;
    expect(claim.basis).toBe('calendar');
    for (const text of [answerUser('Sam', claim, false, 'UTC'), draftUser('Sam', claim, 'UTC')]) {
      expect(text).not.toMatch(/calendar|event|basis/i);
      expect(text).toMatch(/Predicted time: 5:00\sPM/);
    }
  });
});
