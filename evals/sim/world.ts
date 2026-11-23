import type { PresenceEvent } from '../../packages/core/src/types.ts';
import { chance, uniform } from './random.ts';

export const TIMEZONE = 'America/Los_Angeles';
const MIN = 60_000;
const DAY = 1440 * MIN;
// Day 0 is Monday 2027-01-04. No DST change in the simulated range, so local time is a fixed UTC-8 (asserted in tests).
export const START_MS = Date.UTC(2027, 0, 4, 8, 0);

/** UTC ms of local wall-clock `minute` (may be < 0 or >= 1440) on simulated `day`. */
export const localMs = (day: number, minute: number) => START_MS + day * DAY + minute * MIN;
export const iso = (ms: number) => new Date(ms).toISOString();
/** Local day of week of simulated `day`, numbered like AwayBlock.daysOfWeek (0 = Sunday). */
export const dow = (day: number) => (((day + 1) % 7) + 7) % 7;
/** Simulated day containing `ms`, and the local minute within it. */
export const dayOf = (ms: number) => Math.floor((ms - START_MS) / DAY);
export const minuteOf = (ms: number) => Math.floor((ms - START_MS - dayOf(ms) * DAY) / MIN);

/** A hidden away period: out from `from` (inclusive) until `to` (exclusive), UTC ms. */
export interface Interval { from: number; to: number }

export const isAway = (timeline: Interval[], ms: number) => timeline.some((iv) => iv.from <= ms && ms < iv.to);
export const nextReturn = (timeline: Interval[], ms: number) => timeline.find((iv) => iv.from <= ms && ms < iv.to)?.to ?? null;

const MAX_DELAY = 3 * MIN;
const DROP_P = 0.02;

/** What the phone reports: exit at each leave, enter at each return; with noise, each delayed 0-3 min and 2% dropped. */
export function geofenceEvents(timeline: Interval[], r: () => number, noise: boolean): PresenceEvent[] {
  const out: { kind: 'enter' | 'exit'; ms: number }[] = [];
  for (const iv of timeline) {
    for (const [kind, ms] of [['exit', iv.from], ['enter', iv.to]] as const) {
      if (!noise) { out.push({ kind, ms }); continue; }
      const delay = uniform(r, 0, MAX_DELAY);
      if (!chance(r, DROP_P)) out.push({ kind, ms: Math.round(ms + delay) });
    }
  }
  return out.sort((a, b) => a.ms - b.ms).map((e) => ({ kind: e.kind, at: iso(e.ms) }));
}

/** The presence `ask` would read at `nowMs`: the last 14 days plus the latest event before them (data.ts evidence()). */
export function evidenceAt(events: PresenceEvent[], nowMs: number): PresenceEvent[] {
  const since = nowMs - 14 * DAY;
  const past = events.filter((e) => Date.parse(e.at) <= nowMs);
  const before = past.filter((e) => Date.parse(e.at) < since).slice(-1);
  return [...before, ...past.filter((e) => Date.parse(e.at) >= since)];
}
