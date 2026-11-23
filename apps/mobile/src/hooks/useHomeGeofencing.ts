import * as Location from 'expo-location';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';
import { geofenceError } from '../lib/errors';
import { startHomeGeofences, stopHomeGeofences, syncInitialPresence } from '../lib/geofence';
import { chooseRegions } from '../lib/presenceLogic';
import { useHouseholds } from './useHouseholds';

/** Keeps iOS geofence regions in step with my confirmed homes. Needs "Always" location. */
export function useHomeGeofencing(userId: string) {
  const { households, myMemberships, refresh } = useHouseholds();
  const [always, setAlways] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { regions, truncated } = useMemo(
    () => chooseRegions(households.map((h) => {
      const m = myMemberships.find((x) => x.household_id === h.id);
      return {
        householdId: h.id,
        home: { lat: h.home_lat, lng: h.home_lng, radiusM: h.home_radius_m },
        joinedAt: m?.joined_at ?? null,
        confirmed: !!m?.home_confirmed_at,
      };
    })),
    [households, myMemberships],
  );
  const regionsKey = JSON.stringify(regions);

  const checkPermission = useCallback(async () => {
    const p = await Location.getBackgroundPermissionsAsync();
    setAlways(p.granted);
  }, []);

  const live = useRef({ always, regions, userId });
  live.current = { always, regions, userId };
  const syncing = useRef(false);

  // Region registration re-fires state, so only the (deduped) position check runs on each foreground.
  const syncPresence = useCallback(async () => {
    const { always: ok, regions: rs, userId: uid } = live.current;
    if (syncing.current || !ok || !uid || rs.length === 0) return;
    syncing.current = true;
    try {
      await syncInitialPresence(rs);
      setError(null);
    } catch (e) {
      setError(geofenceError(e));
    } finally {
      syncing.current = false;
    }
  }, []);

  // On foreground: re-read permission (it may have changed in Settings), refresh households, repair presence.
  useEffect(() => {
    checkPermission().catch(() => setAlways(false));
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      checkPermission().catch(() => {});
      refresh().catch(() => {});
      syncPresence();
    });
    return () => sub.remove();
  }, [checkPermission, refresh, syncPresence]);

  // Restart regions only when the set of homes or the permission changes.
  useEffect(() => {
    if (always === null || !userId) return;
    let cancelled = false;
    (async () => {
      try {
        if (!always || regions.length === 0) return await stopHomeGeofences();
        await startHomeGeofences(regions);
        if (!cancelled) await syncPresence();
      } catch (e) {
        if (!cancelled) setError(geofenceError(e));
      }
    })();
    return () => { cancelled = true; };
    // regionsKey stands in for regions (same content, stable identity)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [always, regionsKey, userId, syncPresence]);

  const requestAlways = useCallback(async () => {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.granted) {
      const bg = await Location.requestBackgroundPermissionsAsync();
      setAlways(bg.granted);
      if (bg.granted) return;
    }
    // iOS asks for "Always" only once; after that the user must use Settings.
    await Linking.openSettings();
  }, []);

  return { always, truncated, error, requestAlways };
}
