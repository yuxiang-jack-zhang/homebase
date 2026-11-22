import * as Location from 'expo-location';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Linking } from 'react-native';
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

  // On foreground: re-read permission (it may have changed in Settings) and refresh households.
  useEffect(() => {
    checkPermission().catch(() => setAlways(false));
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      checkPermission().catch(() => {});
      refresh().catch(() => {});
    });
    return () => sub.remove();
  }, [checkPermission, refresh]);

  useEffect(() => {
    if (always === null) return;
    let live = true;
    (async () => {
      try {
        if (!always || regions.length === 0) return await stopHomeGeofences();
        await startHomeGeofences(regions);
        await syncInitialPresence(regions, userId);
        if (live) setError(null);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { live = false; };
    // regionsKey stands in for regions (same content, stable identity)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [always, regionsKey, userId]);

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
