// Habits from a person's own presence history (D74): what they usually were at this time of day on comparable days.
import { presenceAt } from './presence.ts';
import type { PresenceEvent, PresenceState } from './types.ts';

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
/**
 * UTC ms of a local wall-clock time (minutes may run past 24:00). A repeated fall-back time gives one of its two instants;
 * a time skipped by spring forward gives the first instant after the gap (02:30 -> 03:00), the moment that day reached it.
 */
function wallToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const offsetAt = (ms: number) => { const p = parts(ms, tz); return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - Math.floor(ms / MIN) * MIN; };
  const guess = wall - offsetAt(wall), ms = wall - offsetAt(guess);
  if (offsetAt(ms) === wall - ms) return ms;
  // In a gap the two candidates straddle the clock change (the earlier one still has the old offset): find it to the minute.
  let lo = Math.min(guess, ms), hi = Math.max(guess, ms);
  while (hi - lo > MIN) {
    const mid = lo + Math.floor((hi - lo) / MIN / 2) * MIN;
    if (offsetAt(mid) === offsetAt(hi)) hi = mid; else lo = mid;
  }
  return hi;
}
/** Wall-clock minutes of `ms` after the local midnight starting `dayOf`'s day, past 1440 on later days (so DST nights read as the clock does). */
function wallMinutes(ms: number, dayOf: number, tz: string): number {
  const a = parts(ms, tz), b = parts(dayOf, tz);
  return (Date.UTC(a.y, a.mo - 1, a.d) - Date.UTC(b.y, b.mo - 1, b.d)) / MIN + a.h * 60 + a.mi;
}
/** The instant `minutes` of wall clock after the local midnight starting `day`'s day. */
export function atLocalMinutes(day: string, minutes: number, tz: string): string {
  const p = parts(Date.parse(day), tz);
  return new Date(wallToUtc(p.y, p.mo, p.d, 0, minutes, tz)).toISOString();
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

/** For a question at most this far ahead, today's state still matters: a day that started differently says little about `t`. */
export const NEAR_TERM_MS = 2 * 60 * MIN;

/**
 * On comparable days, how often they were home at `t`'s local time, and the oldest day counted. Days with no known state
 * then are skipped. Within NEAR_TERM_MS of `now`, with `current` known, only days in that state at now's time of day count.
 */
export function homeShareAt(
  events: PresenceEvent[], t: string, tz: string, matcher: Matcher, now: string, current: PresenceState = 'unknown',
): { n: number; home: number; oldest: string | null } {
  const lead = Date.parse(t) - Date.parse(now);
  // shortcut: the "now" sample is `lead` elapsed before each comparable instant, an hour off if a clock change falls in
  // between (a 00:00-03:00 question on two nights a year); compute it per comparable day if that ever matters.
  const sameStart = (x: string) => current === 'unknown' || lead > NEAR_TERM_MS || presenceAt(events, new Date(Date.parse(x) - lead).toISOString()) === current;
  const known = comparableInstants(t, tz, matcher, now).filter(sameStart).map((x) => ({ x, s: presenceAt(events, x) })).filter((d) => d.s !== 'unknown');
  return { n: known.length, home: known.filter((d) => d.s === 'home').length, oldest: known.at(-1)?.x ?? null };
}

const quantile = (sorted: number[], q: number) => {
  const i = (sorted.length - 1) * q, lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.ceil(i)] - sorted[lo]) * (i - lo);
};

/** A predicted return counts as right within this many minutes (the simulation grades "when are you back?" the same way). */
export const RETURN_TOLERANCE_MIN = 30;
/** How far after a comparable instant a return still counts: a long day out, the same at every hour, and under the 24 h trip guard. */
const RETURN_LOOKAHEAD_MS = 18 * 60 * MIN;

/**
 * On comparable days when they were out at `now`'s local time: the median local time they got back (minutes after that
 * day's midnight on the wall clock, past 24:00 for the next day), and the share of those days back within
 * RETURN_TOLERANCE_MIN of it. A day with no return within RETURN_LOOKAHEAD_MS counts as a miss. Null if they never got back on any.
 */
export function typicalReturn(events: PresenceEvent[], now: string, tz: string, matcher: Matcher): { n: number; median: number; hit: number; oldest: string } | null {
  const sorted = [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const backs: number[] = [];
  let n = 0, oldest = '';
  for (const x of comparableInstants(now, tz, matcher, now)) {
    if (presenceAt(sorted, x) !== 'away') continue;
    n++;
    oldest = x;
    const xMs = Date.parse(x);
    const enter = sorted.find((e) => e.kind === 'enter' && Date.parse(e.at) > xMs && Date.parse(e.at) <= xMs + RETURN_LOOKAHEAD_MS);
    if (enter) backs.push(wallMinutes(Date.parse(enter.at), xMs, tz));
  }
  if (!backs.length) return null;
  backs.sort((a, b) => a - b);
  const median = Math.round(quantile(backs, 0.5));
  return { n, median, hit: backs.filter((b) => Math.abs(b - median) <= RETURN_TOLERANCE_MIN).length / n, oldest };
}
