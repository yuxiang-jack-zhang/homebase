import type { AwayBlock } from './types.ts';

const MIN = 60_000;
const DAY = 1440;

const fmts = new Map<string, Intl.DateTimeFormat>();
function fmt(timeZone: string) {
  let f = fmts.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
    fmts.set(timeZone, f);
  }
  return f;
}

/** Wall-clock time in `tz` as minutes since epoch, as if that wall clock were UTC. */
function localMinutes(utcMs: number, tz: string): number {
  const p: Record<string, number> = {};
  for (const { type, value } of fmt(tz).formatToParts(new Date(utcMs))) p[type] = Number(value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) / MIN;
}

/**
 * UTC instant for wall-clock `localMin`, strictly after `atMs`. Candidates use the zone offsets in force
 * around `atMs`, so a repeated hour (fall back) yields both passes and a skipped hour (spring forward)
 * yields none that round-trip; then we take the earliest candidate after `atMs`.
 */
function localToUtcAfter(localMin: number, atMs: number, tz: string): number {
  const DAY_MS = DAY * MIN;
  const offsets = new Set([-DAY_MS, 0, DAY_MS].map((d) => localMinutes(atMs + d, tz) - (atMs + d) / MIN));
  const after = [...offsets].map((o) => (localMin - o) * MIN).filter((c) => c > atMs).sort((x, y) => x - y);
  return after.find((c) => localMinutes(c, tz) === localMin) ?? after[0];
}

const hhmm = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

/** Local end (wall-clock minutes) of the occurrence of `b` covering local time `now`, or null. */
function coveringEnd(b: AwayBlock, now: number): number | null {
  const start = hhmm(b.startLocal);
  const end = hhmm(b.endLocal);
  if (start === end) return null;
  const len = end > start ? end - start : end + DAY - start;
  const today = Math.floor(now / DAY) * DAY;
  for (const dayStart of [today, today - DAY]) { // the occurrence may have started yesterday
    const dow = new Date(dayStart * MIN).getUTCDay();
    const s = dayStart + start;
    if (b.daysOfWeek.includes(dow) && s <= now && now < s + len) return s + len;
  }
  return null;
}

export function blockCovering(blocks: AwayBlock[], at: string, timezone: string): AwayBlock | null {
  const now = localMinutes(Date.parse(at), timezone);
  return blocks.find((b) => coveringEnd(b, now) !== null) ?? null;
}

export function blockEndAfter(block: AwayBlock, at: string, timezone: string): string {
  const atMs = Date.parse(at);
  const end = coveringEnd(block, localMinutes(atMs, timezone));
  if (end === null) throw new Error('block does not cover the given time');
  return new Date(localToUtcAfter(end, atMs, timezone)).toISOString();
}
