import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Calendar from 'expo-calendar';
import { AppState } from 'react-native';
import { supabase } from './supabase';

// Calendar busy/free as away evidence (docs/superpowers/specs/2026-11-24-calendar-away-design.md).
// Only start and end times leave the phone; titles, locations, notes and attendees never do.

/** JSON array of the calendar ids that mean "I'm away" on this device. Missing = never set up (nothing to sync). */
export const AWAY_CALENDARS_KEY = 'homebase.awayCalendars';
export const CALENDAR_EXPLAINED_KEY = 'homebase.calendarPermissionExplained';

const MIN = 60_000, DAY = 86_400_000;
const WINDOW_MS = 14 * DAY;
// Server limits (sync_calendar_away): at most 200 periods, each 1 minute to 24 hours.
const MAX_PERIODS = 200, MIN_MS = MIN, MAX_MS = DAY;

export type Period = { start: string; end: string };
type CalEvent = Pick<Calendar.ExpoCalendarEvent, 'startDate' | 'endDate' | 'allDay'> & { availability?: string; status?: string };

/**
 * Timed busy events -> away periods: all-day, free and cancelled events skipped; events over 24 hours (before clipping)
 * dropped, since a multi-day event is a trip and its end would make a confident but wrong "back at" time; the rest clipped
 * to [now, now + 14 days], overlapping or touching ones merged, anything under a minute or over 24 hours dropped, earliest
 * 200 kept. shortcut: declined invites still count (EventKit gives no own-attendee status here).
 */
export function toPeriods(events: CalEvent[], now: Date): Period[] {
  const lo = now.getTime(), hi = lo + WINDOW_MS;
  const spans = events
    .filter((e) => !e.allDay && e.availability !== 'free' && e.status !== 'canceled')
    .filter((e) => new Date(e.endDate).getTime() - new Date(e.startDate).getTime() <= MAX_MS)
    .map((e) => [Math.max(new Date(e.startDate).getTime(), lo), Math.min(new Date(e.endDate).getTime(), hi)])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  const merged: number[][] = [];
  for (const [s, e] of spans) {
    const last = merged.at(-1);
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged
    .filter(([s, e]) => e - s >= MIN_MS && e - s <= MAX_MS)
    .slice(0, MAX_PERIODS)
    .map(([s, e]) => ({ start: new Date(s).toISOString(), end: new Date(e).toISOString() }));
}

export async function loadAwayCalendars(): Promise<string[] | null> {
  const raw = await AsyncStorage.getItem(AWAY_CALENDARS_KEY).catch(() => null);
  return raw === null ? null : (JSON.parse(raw) as string[]);
}

export const saveAwayCalendars = (ids: string[]) => AsyncStorage.setItem(AWAY_CALENDARS_KEY, JSON.stringify(ids));

/**
 * Replaces my future periods on the server with the chosen calendars' next 14 days. With no permission or no chosen calendar
 * left it sends an empty list, which clears what was shared. Does nothing if calendars were never set up on this device.
 */
export async function syncCalendarAway(): Promise<void> {
  const chosen = await loadAwayCalendars();
  if (chosen === null) return;
  let periods: Period[] = [];
  if (chosen.length && (await Calendar.getCalendarPermissions()).granted) {
    // EventKit searches every calendar when given none, so ids of deleted calendars must not reach listEvents alone.
    const existing = new Set((await Calendar.getCalendars(Calendar.EntityTypes.EVENT)).map((c) => c.id));
    const ids = chosen.filter((id) => existing.has(id));
    const now = new Date();
    if (ids.length) periods = toPeriods(await Calendar.listEvents(ids, now, new Date(now.getTime() + WINDOW_MS)), now);
  }
  const { error } = await supabase.rpc('sync_calendar_away', { p_periods: periods });
  if (error) throw error;
}

/** On sign-out: clears what was shared (best effort) and this device's choice, so nothing keeps answering for a signed-out user. */
export async function clearCalendarAway(): Promise<void> {
  const { error } = await supabase.rpc('sync_calendar_away', { p_periods: [] });
  if (error) console.warn('[calendar] clear failed:', error.message);
  await AsyncStorage.removeItem(AWAY_CALENDARS_KEY).catch(() => {});
}

/** Syncs now and on every return to the foreground. Returns the cleanup. */
export function startCalendarAwaySync(): () => void {
  const run = () => { syncCalendarAway().catch((e) => console.warn('[calendar] sync failed:', e instanceof Error ? e.message : e)); };
  run();
  const sub = AppState.addEventListener('change', (s) => { if (s === 'active') run(); });
  return () => sub.remove();
}
