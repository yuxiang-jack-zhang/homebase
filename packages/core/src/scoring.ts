import { nextArrivalAfter, presenceAt } from './presence.ts';
import type { Outcome, PresenceEvent } from './types.ts';

const MIN = 60_000;

export function scoreClaim(
  p: { kind: 'at_time' | 'until_when'; aboutTime: string | null; predictedState: 'home' | 'away' | null; predictedTime: string | null; createdAt: string },
  events: PresenceEvent[], now: string, toleranceMin = 30,
): Outcome {
  const lo = Date.parse(p.createdAt) - 48 * 60 * MIN;
  const hi = Date.parse(now);
  if (!events.some((e) => Date.parse(e.at) >= lo && Date.parse(e.at) <= hi)) return 'unscored';

  if (p.kind === 'at_time') {
    if (!p.aboutTime || !p.predictedState) return 'unscored';
    if (hi < Date.parse(p.aboutTime)) return 'pending';
    const s = presenceAt(events, p.aboutTime);
    return s === 'unknown' ? 'unscored' : s === p.predictedState ? 'correct' : 'incorrect';
  }

  if (!p.predictedTime) return 'unscored';
  const want = Date.parse(p.predictedTime);
  const tol = toleranceMin * MIN;
  const a = nextArrivalAfter(events, p.createdAt);
  if (a) return Math.abs(Date.parse(a) - want) <= tol ? 'correct' : 'incorrect';
  return hi < want + tol ? 'pending' : 'incorrect';
}
