import type { Home } from '@homebase/core/src/types';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { decideInitialEvents, type Kind } from './presenceLogic';
import { supabase } from './supabase';

export const GEOFENCE_TASK = 'homebase-geofence';

/** The only thing that leaves the phone about my whereabouts: household, me, enter/exit, when. Never coordinates. */
async function insertEvents(rows: { household_id: string; kind: Kind }[]) {
  // The task may run headless after iOS relaunches the app; the session comes from AsyncStorage.
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) {
    console.warn('[geofence] no session, dropping presence event');
    return;
  }
  const at = new Date().toISOString();
  const { error } = await supabase.from('presence_events').insert(rows.map((r) => ({ ...r, user_id: userId, at })));
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
export async function syncInitialPresence(homes: { householdId: string; home: Home }[], userId: string) {
  if (homes.length === 0) return;
  const [{ coords }, { data, error }] = await Promise.all([
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
    supabase.from('current_presence').select('household_id, kind').eq('user_id', userId),
  ]);
  if (error) throw error;
  const latest = Object.fromEntries((data ?? []).map((r) => [r.household_id, r.kind]));
  const events = decideInitialEvents(homes, { lat: coords.latitude, lng: coords.longitude }, latest);
  if (events.length) await insertEvents(events); // position itself is dropped here
}
