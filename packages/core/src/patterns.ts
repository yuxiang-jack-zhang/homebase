// Habits from a person's own presence history (D74): what they usually were at this time of day on comparable days.
import { presenceAt } from './presence.ts';
import type { PresenceEvent } from './types.ts';

/** Days of presence history `ask` reads (data.ts evidence()); eight weeks gives eight samples per weekday. */
export const EVIDENCE_DAYS = 56;
export type Matcher = 'weekday' | 'daytype';

const MIN = 60_000, DAY = 86_400_000;
const fmts = new Map<string, Intl.DateTimeFormat>();
function parts(ms: number, tz: string) {
  let f = fmts.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' });
    fmts.set(tz, f);
  }
  const p: Record<string, string> = {};
  for (const { type, value } of f.formatToParts(new Date(ms))) p[type] = value;
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, weekend: p.weekday === 'Sat' || p.weekday === 'Sun' };
}
/** Minutes since local midnight. */
export const localMinutes = (ms: number, tz: string) => { const p = parts(ms, tz); return p.h * 60 + p.mi; };
/** UTC ms of a local wall-clock time; the offset is read at the guess, then corrected once (enough outside the DST hour). */
function wallToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const offsetAt = (ms: number) => { const p = parts(ms, tz); return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - Math.floor(ms / MIN) * MIN; };
  const guess = wall - offsetAt(wall);
  return wall - offsetAt(guess);
}

/** The same local time as `t` on up to `max` previous comparable days, newest first, only before `now` and within the evidence window. */
export function comparableInstants(t: string, tz: string, matcher: Matcher, now: string, max = 8): string[] {
  const p = parts(Date.parse(t), tz), nowMs = Date.parse(now), out: string[] = [];
  for (let k = 1; k <= EVIDENCE_DAYS && out.length < max; k++) {
    if (matcher === 'weekday' && k % 7 !== 0) continue;
    const ms = wallToUtc(p.y, p.mo, p.d - k, p.h, p.mi, tz);
    if (ms >= nowMs || nowMs - ms > EVIDENCE_DAYS * DAY) continue;
    if (matcher === 'daytype' && parts(ms, tz).weekend !== p.weekend) continue;
    out.push(new Date(ms).toISOString());
  }
  return out;
}

/** On comparable days, how often they were home at `t`'s local time, and the oldest day counted. Days with no known state then are skipped. */
export function homeShareAt(events: PresenceEvent[], t: string, tz: string, matcher: Matcher, now: string): { n: number; home: number; oldest: string | null } {
  const known = comparableInstants(t, tz, matcher, now).map((x) => ({ x, s: presenceAt(events, x) })).filter((d) => d.s !== 'unknown');
  return { n: known.length, home: known.filter((d) => d.s === 'home').length, oldest: known.at(-1)?.x ?? null };
}

const quantile = (sorted: number[], q: number) => {
  const i = (sorted.length - 1) * q, lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.ceil(i)] - sorted[lo]) * (i - lo);
};

/** A predicted return counts as right within this many minutes (the simulation grades "when are you back?" the same way). */
export const RETURN_TOLERANCE_MIN = 30;

/**
 * On comparable days when they were out at `now`'s local time: the median local time they got back (minutes after that
 * day's midnight, past 24:00 for after midnight, up to 05:00), and the share of those days back within
 * RETURN_TOLERANCE_MIN of it. A day with no return by 05:00 counts as a miss. Null if they never got back on any.
 */
export function typicalReturn(events: PresenceEvent[], now: string, tz: string, matcher: Matcher): { n: number; median: number; hit: number; oldest: string } | null {
  const sorted = [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const backs: number[] = [];
  let n = 0, oldest = '';
  for (const x of comparableInstants(now, tz, matcher, now)) {
    if (presenceAt(sorted, x) !== 'away') continue;
    n++;
    oldest = x;
    const xMs = Date.parse(x), startMin = localMinutes(xMs, tz);
    const limit = xMs + (29 * 60 - startMin) * MIN; // 05:00 the next morning
    const enter = sorted.find((e) => e.kind === 'enter' && Date.parse(e.at) > xMs && Date.parse(e.at) <= limit);
    if (enter) backs.push(startMin + Math.round((Date.parse(enter.at) - xMs) / MIN));
  }
  if (!backs.length) return null;
  backs.sort((a, b) => a - b);
  const median = Math.round(quantile(backs, 0.5));
  return { n, median, hit: backs.filter((b) => Math.abs(b - median) <= RETURN_TOLERANCE_MIN).length / n, oldest };
}
