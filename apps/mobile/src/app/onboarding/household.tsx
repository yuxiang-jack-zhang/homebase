import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { Button, ErrorText, Field, ui } from '../../components/ui';
import { useHouseholds } from '../../hooks/useHouseholds';
import { friendlyError } from '../../lib/errors';
import { currentHome, deviceTimezone } from '../../lib/location';
import { supabase } from '../../lib/supabase';

export default function HouseholdScreen() {
  const router = useRouter();
  const { refresh, setCurrent, households } = useHouseholds();
  const [name, setName] = useState('');
  const [radius, setRadius] = useState('100');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null); // household exists; only the refresh may be pending
  const [error, setError] = useState<string | null>(null);

  const r = Number(radius);
  const radiusOk = Number.isInteger(r) && r >= 50 && r <= 500;

  async function create() {
    setBusy('create');
    setError(null);
    try {
      const home = await currentHome(); // sent only as the shared home
      const { data, error: e } = await supabase.rpc('create_household', {
        p_name: name.trim(), p_lat: home.lat, p_lng: home.lng, p_timezone: deviceTimezone(), p_radius_m: r,
      });
      if (e) throw e;
      setCreatedId(data.id);
      await finishCreate(data.id);
      return;
    } catch (e) {
      setError(friendlyError(e as Error));
    }
    setBusy(null);
  }

  // Separate from create() so a failed refresh offers Retry, never a second household.
  async function finishCreate(id: string) {
    setBusy('create');
    setError(null);
    try {
      await refresh();
      setCurrent(id);
      router.replace('/(tabs)/settings');
    } catch (e) {
      setError(friendlyError(e as Error));
    }
    setBusy(null);
  }

  async function join() {
    setBusy('join');
    setError(null);
    try {
      const { data, error: e } = await supabase.rpc('join_household', { p_invite_code: code });
      if (e) throw e;
      await refresh();
      setCurrent(data.id); // the gate now sends us to confirm-home
    } catch (e) {
      setError(friendlyError(e as Error));
    }
    setBusy(null);
  }

  return (
    <ScrollView style={ui.screen} contentContainerStyle={{ paddingTop: 48 }} keyboardShouldPersistTaps="handled">
      <Text style={ui.title}>Your household</Text>
      <Text style={ui.h2}>Create one</Text>
      <Field placeholder="Household name" value={name} onChangeText={setName} maxLength={60} />
      <Field placeholder="Home radius in meters (50-500)" value={radius} onChangeText={setRadius} keyboardType="number-pad" />
      <Text style={ui.hint}>Be at home when you tap the button: your current location becomes the shared home. Only home/away is ever shared, never where you are.</Text>
      {createdId ? (
        <Button title="Retry" onPress={() => finishCreate(createdId)} busy={busy === 'create'} />
      ) : (
        <Button title="Use my current location as home" onPress={create} busy={busy === 'create'} disabled={!name.trim() || !radiusOk || busy === 'join'} />
      )}
      <Text style={ui.h2}>Or join with an invite code</Text>
      <Field placeholder="Invite code" value={code} onChangeText={(t) => setCode(t.toUpperCase())} autoCapitalize="characters" autoCorrect={false} maxLength={12} />
      <Button title="Join" onPress={join} busy={busy === 'join'} disabled={!code.trim() || busy === 'create'} alt />
      <ErrorText text={error} />
      {households.length > 0 && <Button title="Cancel" alt onPress={() => router.back()} />}
    </ScrollView>
  );
}
