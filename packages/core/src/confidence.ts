import { blockCovering, blockEndAfter } from './blocks.ts';
import { homeShareAt, localMinutes, typicalReturn, type Matcher } from './patterns.ts';
import { presenceAt } from './presence.ts';
import type { Claim, Evidence, ParsedQuestion } from './types.ts';

const NONE = { predictedState: null, predictedTime: null, confidence: 'low', basis: 'none' } as const;
const HOUR = 3_600_000;
const MIN = 60_000;

/** How habits from presence history are used (D74). `matcher: 'off'` gives the pre-pattern behaviour. */
export interface PatternOptions { matcher: 'off' | Matcher; nMin: number; pMin: number; spreadMax: number }
export const PATTERN_DEFAULTS: PatternOptions = { matcher: 'off', nMin: 4, pMin: 0.8, spreadMax: 45 };
// A weak habit (low confidence) still improves drafts, fallback guesses and always_auto answers.
const WEAK_N = 2, WEAK_P = 0.6;

export function buildClaim(parsed: ParsedQuestion, ev: Evidence, options: Partial<PatternOptions> = {}): Claim | null {
  const { now, timezone, presence, blocks } = ev;
  const o = { ...PATTERN_DEFAULTS, ...options };
  const pNow = presenceAt(presence, now);
  const known = pNow !== 'unknown';

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
    if (o.matcher !== 'off') {
      // A strong habit wins over an away block that disagrees: that disagreement is how stale blocks show up.
      const { n, home } = homeShareAt(presence, t, timezone, o.matcher, now);
      const state = home * 2 >= n ? 'home' : 'away';
      const share = n ? Math.max(home, n - home) / n : 0;
      if (n >= o.nMin && share >= o.pMin) return { ...base, predictedState: state, confidence: 'medium', basis: 'pattern' };
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
    let weak: Claim | null = null;
    if (pNow === 'away' && o.matcher !== 'off') {
      // When they usually got back on comparable days they were out at this hour; only a time still ahead counts.
      const r = typicalReturn(presence, now, timezone, o.matcher);
      const nowMin = localMinutes(Date.parse(now), timezone);
      if (r && r.median > nowMin) {
        const back = new Date(Date.parse(now) + (r.median - nowMin) * MIN).toISOString();
        const claim = { ...base, predictedState: 'away', predictedTime: back } as const;
        if (r.n >= o.nMin && r.iqr <= o.spreadMax) return { ...claim, confidence: 'medium', basis: 'pattern' };
        if (r.n >= WEAK_N) weak = { ...claim, confidence: 'low', basis: 'pattern' };
      }
    }
    const block = pNow === 'away' ? blockCovering(blocks, now, timezone) : null;
    if (block) {
      return { ...base, predictedState: 'away', predictedTime: blockEndAfter(block, now, timezone), confidence: 'medium', basis: 'block' };
    }
    return weak ?? { ...base, ...NONE };
  }

  return null;
}
