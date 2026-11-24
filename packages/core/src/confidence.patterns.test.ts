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

  it('is off by default until tuned (production behaviour unchanged)', () => {
    expect(PATTERN_DEFAULTS.matcher).toBe('off');
    expect(buildClaim(at(today(19)), ev(outNow))).toMatchObject({ basis: 'none', predictedState: null });
  });

  it('a strong habit becomes a medium-confidence claim', () => {
    expect(buildClaim(at(today(19)), ev(outNow), on)).toMatchObject({ predictedState: 'home', confidence: 'medium', basis: 'pattern' });
    expect(buildClaim(at(today(15)), ev(outNow), on)).toMatchObject({ predictedState: 'away', confidence: 'medium', basis: 'pattern' });
  });

  it('a weak habit (too few days or too mixed) is low confidence', () => {
    const short = [...history(9 * 60, () => 18 * 60, 15), { kind: 'exit', at: today(9) } as PresenceEvent]; // 2 Wednesdays
    expect(buildClaim(at(today(19)), ev(short), on)).toMatchObject({ predictedState: 'home', confidence: 'low', basis: 'pattern' });
    // Home at 18:30 on 5 of 8 Wednesdays: 62% agreement, below 80%.
    const mixed = [...history(9 * 60, (i) => ([7, 14, 21].includes(i) ? 19 * 60 : 18 * 60)), { kind: 'exit', at: today(9) } as PresenceEvent];
    expect(buildClaim(at(today(18, 30)), ev(mixed), on)).toMatchObject({ predictedState: 'home', confidence: 'low', basis: 'pattern' });
  });

  it('a strong habit beats a stale away block; an agreeing block stays medium/pattern', () => {
    const staleBlock: AwayBlock = { daysOfWeek: [3], startLocal: '18:00', endLocal: '23:00' }; // says away at 19:00
    expect(buildClaim(at(today(19)), ev(outNow, [staleBlock]), on)).toMatchObject({ predictedState: 'home', confidence: 'medium', basis: 'pattern' });
    const agreeing: AwayBlock = { daysOfWeek: [3], startLocal: '09:00', endLocal: '18:00' };
    expect(buildClaim(at(today(15)), ev(outNow, [agreeing]), on)).toMatchObject({ predictedState: 'away', confidence: 'medium', basis: 'pattern' });
  });

  it('until_when while out: a consistent return time is used, beating the block end', () => {
    const block: AwayBlock = { daysOfWeek: [3], startLocal: '09:00', endLocal: '17:00' }; // says back at 17:00
    expect(buildClaim(until, ev(outNow, [block]), on)).toMatchObject({ predictedState: 'away', predictedTime: today(18), confidence: 'medium', basis: 'pattern' });
  });

  it('until_when: a spread-out return time is low confidence; a typical return already past falls back to the block', () => {
    const spread = [...history(9 * 60, (i) => 15 * 60 + (i % 5) * 60), { kind: 'exit', at: today(9) } as PresenceEvent];
    expect(buildClaim(until, ev(spread), on)).toMatchObject({ confidence: 'low', basis: 'pattern' });
    const early = [...history(9 * 60, () => 11 * 60), { kind: 'exit', at: today(9) } as PresenceEvent]; // usually back by 11, it's 12
    const block: AwayBlock = { daysOfWeek: [3], startLocal: '09:00', endLocal: '17:00' };
    expect(buildClaim(until, ev(early, [block]), on)).toMatchObject({ basis: 'block', predictedTime: today(17) });
  });

  it('now and past questions still come from presence', () => {
    expect(buildClaim({ kind: 'now', aboutTime: null }, ev(outNow), on)).toMatchObject({ predictedState: 'away', confidence: 'high', basis: 'presence' });
    expect(buildClaim(at(today(10)), ev(outNow), on)).toMatchObject({ predictedState: 'away', confidence: 'high', basis: 'presence' });
  });
});
