import { describe, expect, it } from 'vitest';
import { presenceAt } from '../../packages/core/src/presence.ts';
import { chance, pick, rng, uniform } from './random.ts';
import { dow, evidenceAt, geofenceEvents, isAway, iso, localMs, nextReturn, START_MS, type Interval } from './world.ts';

const H = 3_600_000;
const MIN = 60_000;

describe('rng', () => {
  it('is deterministic per seed and stays in [0, 1)', () => {
    const a = rng(1), b = rng(1), c = rng(2);
    const xs = Array.from({ length: 1000 }, () => a());
    expect(Array.from({ length: 1000 }, () => b())).toEqual(xs);
    expect(c()).not.toBe(xs[0]);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it('helpers respect their bounds', () => {
    const r = rng(3);
    for (let i = 0; i < 1000; i++) {
      const u = uniform(r, 5, 7);
      expect(u >= 5 && u < 7).toBe(true);
      expect(['a', 'b']).toContain(pick(r, ['a', 'b']));
    }
    expect(Array.from({ length: 1000 }, () => chance(r, 0)).some(Boolean)).toBe(false);
  });
});

describe('time', () => {
  it('day 0 local midnight is 2027-01-04T08:00Z and Los Angeles stays at UTC-8 across the run', () => {
    expect(iso(localMs(0, 0))).toBe('2027-01-04T08:00:00.000Z');
    expect(START_MS).toBe(localMs(0, 0));
    const offset = (ms: number) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'shortOffset' })
      .formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')!.value;
    expect(offset(localMs(-14, 0))).toBe('GMT-8');
    expect(offset(localMs(30, 0))).toBe('GMT-8');
  });

  it('dow uses AwayBlock numbering (0 = Sunday): day 0 is Monday, day -1 Sunday, day 5 Saturday', () => {
    expect([dow(0), dow(-1), dow(5), dow(6), dow(-14)]).toEqual([1, 0, 6, 0, 1]);
  });
});

describe('timeline truth', () => {
  const overnight: Interval[] = [{ from: localMs(0, 22 * 60), to: localMs(1, 6 * 60) }];

  it('isAway and nextReturn handle an interval crossing midnight', () => {
    expect(isAway(overnight, localMs(0, 21 * 60))).toBe(false);
    expect(isAway(overnight, localMs(0, 23 * 60))).toBe(true);
    expect(isAway(overnight, localMs(1, 5 * 60))).toBe(true);
    expect(isAway(overnight, localMs(1, 6 * 60))).toBe(false); // returns exactly at `to`
    expect(nextReturn(overnight, localMs(1, 1 * 60))).toBe(localMs(1, 6 * 60));
    expect(nextReturn(overnight, localMs(0, 12 * 60))).toBeNull();
  });
});

describe('geofenceEvents', () => {
  const tl: Interval[] = [{ from: localMs(0, 9 * 60), to: localMs(0, 17 * 60) }, { from: localMs(0, 19 * 60), to: localMs(0, 21 * 60) }];

  it('without noise is exactly an exit and an enter at the interval bounds', () => {
    expect(geofenceEvents(tl, rng(1), false)).toEqual([
      { kind: 'exit', at: iso(tl[0].from) }, { kind: 'enter', at: iso(tl[0].to) },
      { kind: 'exit', at: iso(tl[1].from) }, { kind: 'enter', at: iso(tl[1].to) },
    ]);
  });

  it('with noise delays each event 0-3 min and drops about 2%', () => {
    const many: Interval[] = Array.from({ length: 10_000 }, (_, i) => ({ from: START_MS + i * 4 * H, to: START_MS + i * 4 * H + H }));
    const ev = geofenceEvents(many, rng(7), true);
    const dropRate = 1 - ev.length / (2 * many.length);
    expect(dropRate).toBeGreaterThan(0.015);
    expect(dropRate).toBeLessThan(0.025);
    for (const e of ev) {
      const t = Date.parse(e.at);
      const base = Math.floor((t - START_MS) / (4 * H)) * 4 * H + START_MS + (e.kind === 'enter' ? H : 0);
      expect(t - base).toBeGreaterThanOrEqual(0);
      expect(t - base).toBeLessThanOrEqual(3 * MIN);
    }
    expect([...ev].sort((a, b) => a.at.localeCompare(b.at))).toEqual(ev);
  });

  it('missed exit: the app believes home while the hidden truth is away', () => {
    // Find a seed where the first exit of the first interval is dropped.
    let events: ReturnType<typeof geofenceEvents> = [];
    const day: Interval[] = Array.from({ length: 50 }, (_, i) => ({ from: START_MS + i * 4 * H, to: START_MS + i * 4 * H + H }));
    for (let s = 1; s < 500; s++) {
      events = geofenceEvents(day, rng(s), true);
      if (events.findIndex((e, i) => i > 0 && e.kind === 'enter' && events[i - 1].kind === 'enter') >= 0) break;
    }
    const i = events.findIndex((e, j) => j > 0 && e.kind === 'enter' && events[j - 1].kind === 'enter');
    expect(i).toBeGreaterThan(0);
    const missedFrom = day.find((iv) => iv.from > Date.parse(events[i - 1].at) && iv.to <= Date.parse(events[i].at) + 3 * MIN)!;
    const inside = missedFrom.from + 10 * MIN;
    expect(isAway(day, inside)).toBe(true);
    expect(presenceAt(events, iso(inside))).toBe('home');
  });
});

describe('evidenceAt', () => {
  const DAY = 24 * H;
  const now = START_MS + 20 * DAY;
  const old = { kind: 'enter' as const, at: iso(now - 15 * DAY) };
  const older = { kind: 'exit' as const, at: iso(now - 16 * DAY) };
  const recent = { kind: 'exit' as const, at: iso(now - 2 * DAY) };
  const future = { kind: 'enter' as const, at: iso(now + H) };

  it('keeps the 14-day window plus the latest event before it, and nothing after now', () => {
    expect(evidenceAt([older, old, recent, future], now)).toEqual([old, recent]);
  });

  it('keeps the latest pre-window event when the window is empty', () => {
    expect(evidenceAt([older, old], now)).toEqual([old]);
  });
});
