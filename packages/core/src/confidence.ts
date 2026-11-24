import { blockCovering, blockEndAfter } from './blocks.ts';
import { homeShareAt, localMinutes, RETURN_TOLERANCE_MIN, typicalReturn, type Matcher } from './patterns.ts';
import { presenceAt } from './presence.ts';
import type { AwayBlock, Claim, Evidence, ParsedQuestion } from './types.ts';

const NONE = { predictedState: null, predictedTime: null, confidence: 'low', basis: 'none' } as const;
const HOUR = 3_600_000;
const MIN = 60_000;

/** How habits from presence history are used (D74). `matcher: 'off'` gives the pre-pattern behaviour. */
export interface PatternOptions { matcher: 'off' | Matcher; nMin: number; pMin: number }
// Chosen on simulation seeds 2-4 (fewest confident errors that still beat 'off'), confirmed on fresh seeds 14-19 (D74).
export const PATTERN_DEFAULTS: PatternOptions = { matcher: 'weekday', nMin: 3, pMin: 0.95 };
// A weak habit (low confidence) still improves drafts, fallback guesses and always_auto answers.
const WEAK_N = 2, WEAK_P = 0.6;
/** A block the person added after the oldest day a habit is based on is newer information than the habit. */
const newerThan = (b: AwayBlock | null, oldest: string | null) => !!b?.createdAt && !!oldest && Date.parse(b.createdAt) > Date.parse(oldest);
// Out for longer than this means they're off their routine (a trip), so habits say nothing.
const OFF_ROUTINE_MS = 24 * HOUR;

export function buildClaim(parsed: ParsedQuestion, ev: Evidence, options: Partial<PatternOptions> = {}): Claim | null {
  const { now, timezone, presence, blocks } = ev;
  const o = { ...PATTERN_DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)) } as PatternOptions;
  const pNow = presenceAt(presence, now);
  const known = pNow !== 'unknown';
  const lastAt = presence.map((e) => Date.parse(e.at)).filter((t) => t <= Date.parse(now)).reduce((a, b) => Math.max(a, b), -Infinity);
  const offRoutine = pNow === 'away' && Date.parse(now) - lastAt > OFF_ROUTINE_MS;
  const usePatterns = o.matcher !== 'off' && !offRoutine;

  if (parsed.kind === 'now') {
    const base = { kind: 'now', aboutTime: null, predictedTime: null } as const;
    return known
      ? { ...base, predictedState: pNow, confidence: 'high', basis: 'presence' }
      : { ...base, ...NONE };
  }

  if (parsed.kind === 'at_time') {
    const t = parsed.aboutTime;
    if (t === null) return null;
    const base = { kind: 'at_time', aboutTime: t, predictedTime: null } as const;
    if (Date.parse(t) <= Date.parse(now)) {
      const p = presenceAt(presence, t);
      return p === 'unknown' ? { ...base, ...NONE } : { ...base, predictedState: p, confidence: 'high', basis: 'presence' };
    }
    let weak: Claim | null = null;
    if (usePatterns && o.matcher !== 'off') {
      // A strong habit wins over an away block that disagrees: that disagreement is how stale blocks show up.
      const { n, home, oldest } = homeShareAt(presence, t, timezone, o.matcher, now);
      const state = home * 2 >= n ? 'home' : 'away';
      const share = n ? Math.max(home, n - home) / n : 0;
      const block = blockCovering(blocks, t, timezone);
      const blockIsNewer = newerThan(block, oldest) && state === 'home';
      if (n >= o.nMin && share >= o.pMin && !blockIsNewer) return { ...base, predictedState: state, confidence: 'medium', basis: 'pattern' };
      if (n >= WEAK_N && share >= WEAK_P) weak = { ...base, predictedState: state, confidence: 'low', basis: 'pattern' };
    }
    if (blockCovering(blocks, t, timezone)) {
      return blockCovering(blocks, now, timezone) && pNow === 'home'
        ? { ...base, predictedState: 'away', confidence: 'low', basis: 'block_contradicted' }
        : { ...base, predictedState: 'away', confidence: 'medium', basis: 'block' };
    }
    if (pNow === 'home' && Date.parse(t) - Date.parse(now) <= HOUR) {
      return { ...base, predictedState: 'home', confidence: 'medium', basis: 'recent_presence' };
    }
    return weak ?? { ...base, ...NONE };
  }

  if (parsed.kind === 'until_when') {
    const base = { kind: 'until_when', aboutTime: null } as const;
    if (pNow === 'home') return { ...base, predictedState: 'home', predictedTime: now, confidence: 'high', basis: 'presence' };
    const block = pNow === 'away' ? blockCovering(blocks, now, timezone) : null;
    const blockEnd = block ? blockEndAfter(block, now, timezone) : null;
    let habitDisagrees = false;
    if (pNow === 'away' && usePatterns && o.matcher !== 'off') {
      // When they got back on comparable days they were out at this hour. Only a time still ahead, hit within the grading
      // tolerance on most of those days (days with no return count as misses), is a claim of its own.
      const r = typicalReturn(presence, now, timezone, o.matcher);
      const nowMin = localMinutes(Date.parse(now), timezone);
      if (r && r.median > nowMin && r.n >= o.nMin) {
        const back = new Date(Date.parse(now) + (r.median - nowMin) * MIN).toISOString();
        if (r.hit >= o.pMin && !newerThan(block, r.oldest)) return { ...base, predictedState: 'away', predictedTime: back, confidence: 'medium', basis: 'pattern' };
        habitDisagrees = !!blockEnd && !newerThan(block, r.oldest) && Math.abs(Date.parse(blockEnd) - Date.parse(back)) > RETURN_TOLERANCE_MIN * MIN;
      }
    }
    if (block && blockEnd) {
      // A habit an hour off an old block's end means the block is probably stale: still the best guess, but not confident.
      return { ...base, predictedState: 'away', predictedTime: blockEnd, confidence: habitDisagrees ? 'low' : 'medium', basis: 'block' };
    }
    return { ...base, ...NONE };
  }

  return null;
}
