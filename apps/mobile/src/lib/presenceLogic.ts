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

type Ev = { household_id: string; kind: Kind };

/** Drop events that repeat my latest kind in that household (the server trigger is the real guarantee). */
export const dropRepeats = (events: Ev[], latest: Record<string, Kind | undefined>): Ev[] =>
  events.filter((e) => latest[e.household_id] !== e.kind);

/** Events to insert so my latest per household matches where I am now. */
export function decideInitialEvents(
  homes: { householdId: string; home: Home }[],
  pos: { lat: number; lng: number },
  latest: Record<string, Kind | undefined>,
): Ev[] {
  return dropRepeats(
    homes.map(({ householdId, home }): Ev => ({ household_id: householdId, kind: isInsideHome(home, pos) ? 'enter' : 'exit' })),
    latest,
  );
}

export const isUuid = (s: string | undefined | null): s is string =>
  !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export function presenceLabel(p: { kind: Kind; at: string } | undefined, now = new Date(), locale?: string): string {
  if (!p) return '—';
  const at = new Date(p.at);
  const time = at.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  const day = at.toDateString() === now.toDateString()
    ? '' : `${at.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' })}, `;
  return `${p.kind === 'enter' ? 'Home' : 'Away'} · since ${day}${time}`;
}
