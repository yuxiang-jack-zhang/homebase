import { z } from 'zod';
import { localMs, type Interval } from '../world.ts';

// Plan times are "HH:MM" from local midnight of the plan's day; up to 29:00 means the early hours of the next day.
const HHMM = z.string().regex(/^\d{2}:\d{2}$/, 'HH:MM');
export const OutingSchema = z.object({ leave: HHMM, back: HHMM, why: z.string() });
export const PlanSchema = z.object({
  outings: z.array(OutingSchema),
  needs: z.array(z.object({ at: HHMM, what: z.string() })),
  questions: z.array(z.object({ at: HHMM, about: z.string(), why: z.string() })),
});
export const PlanChangeSchema = z.object({ backBy: HHMM.optional(), outings: z.array(OutingSchema) });
export type Outing = z.infer<typeof OutingSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type PlanChange = z.infer<typeof PlanChangeSchema>;

const EARLIEST = 5 * 60, LATEST = 29 * 60;
const HOME_GAP = 15; // minutes home before leaving again after an overnight return

export function hhmm(s: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m || Number(m[1]) > 29 || Number(m[2]) > 59) throw new Error(`bad time ${s}`);
  return Number(m[1]) * 60 + Number(m[2]);
}
export const fmt = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** null when the outings are a valid day, else why not. */
export function validOutings(outings: Outing[], earliest = EARLIEST): string | null {
  let prev = -Infinity;
  for (const x of outings) {
    let leave: number, back: number;
    try { leave = hhmm(x.leave); back = hhmm(x.back); } catch { return `bad time format in ${x.leave}-${x.back}`; }
    if (back <= leave) return `back before leave in ${x.leave}-${x.back}`;
    if (leave < earliest || back > LATEST) return `out of range: ${x.leave}-${x.back}`;
    if (leave <= prev) return `overlap at ${x.leave}`;
    prev = back;
  }
  return null;
}

export const toIntervals = (day: number, outings: Outing[]): Interval[] =>
  outings.map((x) => ({ from: localMs(day, hhmm(x.leave)), to: localMs(day, hhmm(x.back)) }));

/**
 * The plan after a change made at `nowMin`: the past is fixed, an outing in progress can only end at or after now
 * (at `backBy` when given), and new outings must start after that. An invalid result keeps the old plan.
 */
export function applyChange(outings: Outing[], change: PlanChange, nowMin: number): Outing[] {
  const done = outings.filter((x) => hhmm(x.back) <= nowMin);
  const current = outings.find((x) => hhmm(x.leave) <= nowMin && nowMin < hhmm(x.back));
  let floor = nowMin - 1; // home now: may leave right away
  const out = [...done];
  if (current) {
    const back = change.backBy ? Math.max(nowMin, hhmm(change.backBy)) : hhmm(current.back);
    out.push({ ...current, back: fmt(back) });
    floor = back;
  }
  out.push(...change.outings.filter((x) => { try { return hhmm(x.leave) > floor; } catch { return false; } }));
  return validOutings(out, 0) === null ? out : outings;
}

/** Today's outings moved past yesterday's overnight return (`minMin`, minutes of today). */
export function clipAfter(outings: Outing[], minMin: number): Outing[] {
  const start = minMin + HOME_GAP;
  return outings
    .map((x) => (hhmm(x.leave) < start ? { ...x, leave: fmt(start) } : x))
    .filter((x) => hhmm(x.leave) < hhmm(x.back));
}
