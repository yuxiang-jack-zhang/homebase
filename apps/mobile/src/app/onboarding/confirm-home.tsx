import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { HomeMap } from '../../components/HomeMap';
import { Button, ErrorText, ui } from '../../components/ui';
import { useHouseholds } from '../../hooks/useHouseholds';
import { friendlyError } from '../../lib/errors';
import { supabase } from '../../lib/supabase';

// Keyed by household so `confirmed` never carries over when the user switches households.
export default function ConfirmHomeScreen() {
  const { current } = useHouseholds();
  return <ConfirmHome key={current?.id} />;
}

function ConfirmHome() {
  const { current, households, setCurrent, refresh } = useHouseholds();
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false); // confirm_home succeeded; only the refresh may be pending
  const [error, setError] = useState<string | null>(null);
  if (!current) return null;

  async function reloadAfterConfirm() {
    setBusy(true);
    setError(null);
    try {
      await refresh(); // the gate moves us on once the membership is confirmed
    } catch (e) {
      setError(friendlyError(e as Error));
    }
    setBusy(false);
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.rpc('confirm_home', { p_household_id: current!.id });
    if (e) {
      setError(friendlyError(e));
      setBusy(false);
      return;
    }
    setConfirmed(true);
    await reloadAfterConfirm();
  }

  // Other households to switch to, an escape from this screen. (No leave-household RPC exists.)
  const others = households.filter((h) => h.id !== current.id);

  return (
    <ScrollView style={ui.screen} contentContainerStyle={{ paddingTop: 48 }}>
      <Text style={ui.title}>Is this your home?</Text>
      <Text style={[ui.hint, { marginBottom: 12 }]}>
        {current.name}: your phone will report only home or away when you cross the blue circle ({current.home_radius_m} m).
      </Text>
      <HomeMap lat={current.home_lat} lng={current.home_lng} radiusM={current.home_radius_m} />
      <ErrorText text={error} />
      {confirmed ? (
        <Button title="Retry" onPress={reloadAfterConfirm} busy={busy} />
      ) : (
        <Button title="Confirm this is my home" onPress={confirm} busy={busy} />
      )}
      <Text style={[ui.hint, { marginTop: 12 }]}>Not your home? Ask the household owner to move it, then confirm again.</Text>
      {others.map((h) => (
        <Button key={h.id} title={`Switch to ${h.name}`} alt onPress={() => setCurrent(h.id)} />
      ))}
      <Button title="Sign out" alt onPress={() => supabase.auth.signOut()} />
    </ScrollView>
  );
}
