import type { Home } from '@homebase/core/src/types';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { clearCalendarAway } from './calendarAway';
import { decideInitialEvents, dropRepeats, isUuid, type Kind } from './presenceLogic';
import { supabase } from './supabase';

export const GEOFENCE_TASK = 'homebase-geofence';

/**
 * The only thing that leaves the phone about my whereabouts: household, me, enter/exit, when. Never coordinates.
 * Shared by the task and syncInitialPresence. Region monitoring re-fires the current state on every registration,
 * so skip kinds equal to my latest; the presence_events trigger (0004) is the race-proof guarantee.
 */
async function insertEvents(rows: { household_id: string; kind: Kind }[]) {
  // The task may run headless after iOS relaunches the app; the session comes from the keychain (secureStorage).
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) {
    console.warn('[geofence] no session, dropping presence event');
    return;
  }
  const valid = rows.filter((r) => isUuid(r.household_id));
  if (valid.length < rows.length) console.warn('[geofence] dropping event with a bad region identifier');
  if (valid.length === 0) return;
  const { data: cur, error: e1 } = await supabase
    .from('current_presence').select('household_id, kind').eq('user_id', userId);
  // Data-loss rule: if the dedupe read fails, insert anyway; the 0004 trigger dedupes server-side.
  if (e1) console.warn('[geofence] current_presence read failed, skipping client dedupe:', e1.message);
  const latest = Object.fromEntries((cur ?? []).map((r) => [r.household_id, r.kind]));
  const fresh = dropRepeats(valid, latest);
  if (fresh.length === 0) return;
  const at = new Date().toISOString();
  const { error } = await supabase.from('presence_events').insert(fresh.map((r) => ({ ...r, user_id: userId, at })));
  if (error) console.warn('[geofence] insert failed:', error.message);
}

// Must be defined at module top level so iOS can run it on a cold relaunch.
TaskManager.defineTask<{ eventType: Location.GeofencingEventType; region: Location.LocationRegion }>(
  GEOFENCE_TASK,
  async ({ data, error }) => {
    try {
      if (error) throw error;
      const kind: Kind = data.eventType === Location.GeofencingEventType.Enter ? 'enter' : 'exit';
      await insertEvents([{ household_id: data.region.identifier!, kind }]); // identifier = household id
    } catch (e) {
      console.warn('[geofence] task failed:', e instanceof Error ? e.message : e);
    }
  },
);

export async function stopHomeGeofences() {
  if (await Location.hasStartedGeofencingAsync(GEOFENCE_TASK)) await Location.stopGeofencingAsync(GEOFENCE_TASK);
}

/** Stop watching homes before signing out, so the regions don't keep firing (or carry over to the next account). */
export async function signOut() {
  await stopHomeGeofences().catch((e) => console.warn('[geofence] stop failed:', e instanceof Error ? e.message : e));
  await clearCalendarAway().catch(() => {}); // server periods and this device's choice (the next person chooses their own)
  await supabase.auth.signOut();
}

export async function startHomeGeofences(homes: { householdId: string; home: Home }[]) {
  await Location.startGeofencingAsync(
    GEOFENCE_TASK,
    homes.map(({ householdId, home }) => ({
      identifier: householdId,
      latitude: home.lat,
      longitude: home.lng,
      radius: home.radiusM,
      notifyOnEnter: true,
      notifyOnExit: true,
    })),
  );
}

/** Region events only fire on crossings, so record where I am now if it disagrees with my latest event. */
export async function syncInitialPresence(homes: { householdId: string; home: Home }[]) {
  if (homes.length === 0) return;
  const { coords } = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  // insertEvents drops the ones that match my latest; the position itself is dropped here.
  await insertEvents(decideInitialEvents(homes, { lat: coords.latitude, lng: coords.longitude }, {}));
}
