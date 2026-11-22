import { blockCovering, blockEndAfter } from './blocks.ts';
import { presenceAt } from './presence.ts';
import type { Claim, Evidence, ParsedQuestion } from './types.ts';

const NONE = { predictedState: null, predictedTime: null, confidence: 'low', basis: 'none' } as const;
const HOUR = 3_600_000;

export function buildClaim(parsed: ParsedQuestion, ev: Evidence): Claim | null {
  const { now, timezone, presence, blocks } = ev;
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
    if (blockCovering(blocks, t, timezone)) {
      return blockCovering(blocks, now, timezone) && pNow === 'home'
        ? { ...base, predictedState: 'away', confidence: 'low', basis: 'block_contradicted' }
        : { ...base, predictedState: 'away', confidence: 'medium', basis: 'block' };
    }
    if (pNow === 'home' && Date.parse(t) - Date.parse(now) <= HOUR) {
      return { ...base, predictedState: 'home', confidence: 'medium', basis: 'recent_presence' };
    }
    return { ...base, ...NONE };
  }

  if (parsed.kind === 'until_when') {
    const base = { kind: 'until_when', aboutTime: null } as const;
    if (pNow === 'home') return { ...base, predictedState: 'home', predictedTime: now, confidence: 'high', basis: 'presence' };
    const block = pNow === 'away' ? blockCovering(blocks, now, timezone) : null;
    if (block) {
      return { ...base, predictedState: 'away', predictedTime: blockEndAfter(block, now, timezone), confidence: 'medium', basis: 'block' };
    }
    return { ...base, ...NONE };
  }

  return null;
}
