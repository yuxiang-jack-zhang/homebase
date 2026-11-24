import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Calendar from 'expo-calendar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking, Switch, Text, View } from 'react-native';
import { CALENDAR_EXPLAINED_KEY, loadAwayCalendars, saveAwayCalendars, syncCalendarAway } from '../lib/calendarAway';
import { friendlyError } from '../lib/errors';
import { Button, ErrorText, Row, ui } from './ui';

/** Explains once, before the first iOS prompt; resolves whether to go on and ask. */
async function explainOnce(): Promise<boolean> {
  if (await AsyncStorage.getItem(CALENDAR_EXPLAINED_KEY).catch(() => null)) return true;
  await AsyncStorage.setItem(CALENDAR_EXPLAINED_KEY, '1').catch(() => {});
  return new Promise((resolve) =>
    Alert.alert(
      'Use your calendar',
      "Homebase can treat events in calendars you choose (like Work) as times you're away, so roommates get better answers. Only start and end times are shared; titles, places and notes stay on your phone.",
      [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Continue', onPress: () => resolve(true) },
      ],
    ));
}

/** "Calendars that mean I'm away": the device's calendars as toggles, stored on this phone only. */
export function AwayCalendars() {
  const [perm, setPerm] = useState<Calendar.PermissionResponse | null>(null);
  const [calendars, setCalendars] = useState<{ id: string; title: string }[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const latest = useRef(chosen); // two quick toggles must build on each other, not on the same render's list
  latest.current = chosen;
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: Calendar.PermissionResponse) => {
    setPerm(p);
    if (!p.granted) return;
    const [cals, saved] = await Promise.all([Calendar.getCalendars(Calendar.EntityTypes.EVENT), loadAwayCalendars()]);
    setCalendars(cals.map((c) => ({ id: c.id, title: c.title })));
    setChosen(saved ?? []);
  }, []);

  useEffect(() => {
    Calendar.getCalendarPermissions().then(load).catch((e) => setError(friendlyError(e)));
  }, [load]);

  async function ask() {
    try {
      if (await explainOnce()) await load(await Calendar.requestCalendarPermissions());
    } catch (e) {
      setError(friendlyError(e as Error));
    }
  }

  async function toggle(id: string, on: boolean) {
    const cur = latest.current;
    const next = on ? [...cur, id] : cur.filter((x) => x !== id);
    latest.current = next;
    setChosen(next);
    try {
      await saveAwayCalendars(next);
      await syncCalendarAway();
      setError(null);
    } catch (e) {
      setError(friendlyError(e as Error));
    }
  }

  return (
    <View>
      <Text style={ui.hint}>Events in these calendars tell Homebase you're probably away. Only start and end times are shared; titles stay on your phone.</Text>
      {perm && !perm.granted && (perm.canAskAgain
        ? <Button title="Choose calendars" alt onPress={ask} />
        : <Button title="Allow calendar access in Settings" alt onPress={() => Linking.openSettings()} />)}
      {perm?.granted && calendars.map((c) => (
        <Row key={c.id}>
          <Text style={{ flex: 1 }}>{c.title}</Text>
          <Switch accessibilityLabel={c.title} value={chosen.includes(c.id)} onValueChange={(v) => toggle(c.id, v)} />
        </Row>
      ))}
      <ErrorText text={error} />
    </View>
  );
}
