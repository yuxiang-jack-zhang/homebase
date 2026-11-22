import { useState } from 'react';
import { Alert, Text } from 'react-native';
import { useHouseholds } from '../hooks/useHouseholds';
import { friendlyError } from '../lib/errors';
import { currentHome } from '../lib/location';
import { supabase } from '../lib/supabase';
import { Button, ErrorText, Field, ui } from './ui';

/** Owner only (the screen hides it for members; update_home enforces it with not_owner). */
export function MoveHome({ householdId, radiusM }: { householdId: string; radiusM: number }) {
  const { refresh } = useHouseholds();
  const [radius, setRadius] = useState(String(radiusM));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const r = Number(radius);

  const confirmMove = () =>
    Alert.alert('Move home for everyone?', 'Everyone else will need to re-confirm.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Move home', style: 'destructive', onPress: move },
    ]);

  async function move() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const home = await currentHome(); // sent only as the shared home
      const { error: e } = await supabase.rpc('update_home', { p_household_id: householdId, p_lat: home.lat, p_lng: home.lng, p_radius_m: r });
      if (e) throw e;
      await refresh();
      setMsg('Home moved. Your roommates will be asked to confirm it.');
    } catch (e) {
      setError(friendlyError(e as Error));
    }
    setBusy(false);
  }

  return (
    <>
      <Text style={ui.hint}>Stand at the new home, then tap the button. Everyone else must re-confirm before their phone uses it.</Text>
      <Field placeholder="Radius in meters (50-500)" value={radius} onChangeText={setRadius} keyboardType="number-pad" />
      <Button title="Move home to my current location" onPress={confirmMove} busy={busy} disabled={!Number.isInteger(r) || r < 50 || r > 500} alt />
      {msg && <Text style={ui.hint}>{msg}</Text>}
      <ErrorText text={error} />
    </>
  );
}
