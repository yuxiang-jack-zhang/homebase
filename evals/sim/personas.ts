// Simulated roommates. Each hides a timeline of away intervals; `blocks` are what they told the app.
// Behaviour is modelled on how people live, not on the confidence rules (spec anti-goal: no circular simulation).
import type { AwayBlock } from '../../packages/core/src/types.ts';
import { chance, uniform } from './random.ts';
import { dow, localMs, type Interval } from './world.ts';

export type PersonaId = 'nine_to_five' | 'stale_blocks' | 'shift_worker' | 'student' | 'traveler' | 'homebody';
type R = () => number;
export interface Persona {
  id: PersonaId; name: string; blocks: AwayBlock[];
  /** Hidden away intervals for days [fromDay, toDay), sorted and non-overlapping. */
  timeline(r: R, fromDay: number, toDay: number): Interval[];
}

const H = 60; // minutes
const int = (r: R, a: number, b: number) => Math.floor(uniform(r, a, b + 1)); // inclusive
const span = (day: number, fromMin: number, toMin: number): Interval => ({ from: localMs(day, Math.round(fromMin)), to: localMs(day, Math.round(toMin)) });

/** `n` outings on `day`, one after another between local minutes [start, end): each minDur-maxDur long, gaps of at least 30 min. */
function outings(r: R, day: number, n: number, start: number, end: number, minDur: number, maxDur: number): Interval[] {
  const out: Interval[] = [];
  let t = start + uniform(r, 0, 90);
  for (let i = 0; i < n; i++) {
    const room = end - t - (n - i - 1) * (minDur + 30); // leave space for the outings still to come
    if (room < minDur) break;
    const dur = uniform(r, minDur, Math.min(maxDur, room));
    out.push(span(day, t, t + dur));
    t += dur + uniform(r, 30, Math.max(30, Math.min(180, (end - t - dur) / Math.max(1, n - i))));
  }
  return out;
}

const workday = (r: R, day: number, gymP: number): Interval =>
  span(day, uniform(r, 8 * H + 15, 8 * H + 45), chance(r, gymP) ? uniform(r, 19 * H, 19 * H + 30) : uniform(r, 17 * H + 15, 18 * H + 15));
const weekendErrands = (r: R, day: number) => outings(r, day, int(r, 0, 2), 10 * H, 20 * H, 60, 180);
const isWeekday = (day: number) => dow(day) >= 1 && dow(day) <= 5;

function days(fromDay: number, toDay: number, each: (day: number) => Interval[]): Interval[] {
  const out: Interval[] = [];
  for (let d = fromDay; d < toDay; d++) out.push(...each(d));
  return out.sort((a, b) => a.from - b.from);
}

const WEEKDAY_9_5: AwayBlock[] = [{ daysOfWeek: [1, 2, 3, 4, 5], startLocal: '09:00', endLocal: '17:00' }];

const nineToFive = (r: R, from: number, to: number) => days(from, to, (d) => (isWeekday(d) ? [workday(r, d, 0.3)] : weekendErrands(r, d)));

export const PERSONAS: Persona[] = [
  {
    id: 'nine_to_five', name: 'Ava', blocks: WEEKDAY_9_5,
    timeline: nineToFive,
  },
  {
    // Moved to a hybrid job and never updated the app: in the office Tue-Thu only.
    id: 'stale_blocks', name: 'Ben', blocks: WEEKDAY_9_5,
    timeline: (r, from, to) => days(from, to, (d) => {
      const w = dow(d);
      if (w >= 2 && w <= 4) return [workday(r, d, 0.2)];
      if (w === 1 || w === 5) return outings(r, d, int(r, 1, 2), 10 * H, 18 * H, 20, 90);
      return weekendErrands(r, d);
    }),
  },
  {
    // Regular Tue and Thu nights (declared) plus one extra night a week that moves around (not declared).
    id: 'shift_worker', name: 'Cam', blocks: [{ daysOfWeek: [2, 4], startLocal: '21:30', endLocal: '06:30' }],
    timeline: (r, from, to) => {
      const extra = new Map<number, number>(); // week -> dow of the extra night
      return days(from, to, (d) => {
        const week = Math.floor(d / 7);
        if (!extra.has(week)) extra.set(week, [0, 1, 3, 5, 6][int(r, 0, 4)]);
        const night = dow(d) === 2 || dow(d) === 4 || dow(d) === extra.get(week);
        // Afternoon errands end by 18:30, before any shift starts.
        const errands = outings(r, d, int(r, 0, 1), 13 * H, 18 * H + 30, 30, 90);
        return night ? [...errands, span(d, 21 * H + 30, 30 * H + 30)] : errands;
      });
    },
  },
  {
    id: 'student', name: 'Dee', blocks: [],
    timeline: (r, from, to) => days(from, to, (d) => outings(r, d, int(r, 2, 4), 9 * H, 25 * H, 60, 240)),
  },
  {
    // The nine_to_five routine plus a 3-5 day trip with no away block for it.
    id: 'traveler', name: 'Eli', blocks: WEEKDAY_9_5,
    timeline: (r, from, to) => {
      const start = Math.max(3, int(r, 3, Math.max(3, to - 6)));
      const len = int(r, 3, 5);
      const trip = span(start, 7 * H, len * 24 * H + 19 * H);
      if (start >= to) return nineToFive(r, from, to); // run too short for a trip
      const routine = nineToFive(r, from, to).filter((iv) => iv.to < trip.from || iv.from > trip.to);
      return [...routine, trip].sort((a, b) => a.from - b.from);
    },
  },
  {
    id: 'homebody', name: 'Fay', blocks: [],
    timeline: (r, from, to) => days(from, to, (d) => outings(r, d, int(r, 0, 2), 10 * H, 21 * H, 20, 180)),
  },
];
