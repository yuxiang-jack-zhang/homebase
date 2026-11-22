import type { PresenceEvent, PresenceState } from './types.ts';

const byTime = (a: PresenceEvent, b: PresenceEvent) => Date.parse(a.at) - Date.parse(b.at);

export function presenceAt(events: PresenceEvent[], at: string): PresenceState {
  const t = Date.parse(at);
  const last = [...events].sort(byTime).filter((e) => Date.parse(e.at) <= t).pop();
  return last ? (last.kind === 'enter' ? 'home' : 'away') : 'unknown';
}

export function nextArrivalAfter(events: PresenceEvent[], after: string): string | null {
  const t = Date.parse(after);
  return [...events].sort(byTime).find((e) => e.kind === 'enter' && Date.parse(e.at) > t)?.at ?? null;
}
