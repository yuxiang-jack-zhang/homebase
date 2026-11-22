import { isInsideHome } from '@homebase/core/src/geo';
import type { Home } from '@homebase/core/src/types';

export const MAX_REGIONS = 20; // iOS limit per app

export interface HomeRow { householdId: string; home: Home; joinedAt: string | null; confirmed: boolean }
export type Kind = 'enter' | 'exit';

/** Confirmed homes only; if over the iOS cap keep the most recently joined. */
export function chooseRegions(rows: HomeRow[], max = MAX_REGIONS) {
  const confirmed = rows
    .filter((r) => r.confirmed)
    .sort((a, b) => (b.joinedAt ?? '').localeCompare(a.joinedAt ?? ''));
  return {
    regions: confirmed.slice(0, max).map(({ householdId, home }) => ({ householdId, home })),
    truncated: confirmed.length > max,
  };
}

/** Events to insert so my latest per household matches where I am now. */
export function decideInitialEvents(
  homes: { householdId: string; home: Home }[],
  pos: { lat: number; lng: number },
  latest: Record<string, Kind | undefined>,
): { household_id: string; kind: Kind }[] {
  return homes.flatMap(({ householdId, home }) => {
    const kind: Kind = isInsideHome(home, pos) ? 'enter' : 'exit';
    return latest[householdId] === kind ? [] : [{ household_id: householdId, kind }];
  });
}

export function presenceLabel(p: { kind: Kind; at: string } | undefined, now = new Date()): string {
  if (!p) return '—';
  const at = new Date(p.at);
  const time = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = at.toDateString() === now.toDateString()
    ? '' : `${at.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}, `;
  return `${p.kind === 'enter' ? 'Home' : 'Away'} · since ${day}${time}`;
}
