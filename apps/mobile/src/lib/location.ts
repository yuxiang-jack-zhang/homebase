import * as Location from 'expo-location';

/** One foreground reading. Callers send it ONLY as the shared home, never as the member's own position. */
export async function currentHome(): Promise<{ lat: number; lng: number }> {
  const { granted } = await Location.requestForegroundPermissionsAsync();
  if (!granted) throw new Error('Location permission is needed to use your current location as home.');
  const { coords } = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return { lat: coords.latitude, lng: coords.longitude };
}

export const deviceTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
