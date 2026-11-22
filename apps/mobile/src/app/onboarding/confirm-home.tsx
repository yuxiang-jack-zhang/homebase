import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { HomeMap } from '../../components/HomeMap';
import { Button, ErrorText, ui } from '../../components/ui';
import { useHouseholds } from '../../hooks/useHouseholds';
import { friendlyError } from '../../lib/errors';
import { supabase } from '../../lib/supabase';

export default function ConfirmHome() {
  const { current, refresh } = useHouseholds();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!current) return null;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const { error: e } = await supabase.rpc('confirm_home', { p_household_id: current!.id });
      if (e) throw e;
      await refresh(); // the gate moves us on once the membership is confirmed
    } catch (e) {
      setError(friendlyError(e as Error));
      setBusy(false);
    }
  }

  return (
    <ScrollView style={ui.screen} contentContainerStyle={{ paddingTop: 48 }}>
      <Text style={ui.title}>Is this your home?</Text>
      <Text style={[ui.hint, { marginBottom: 12 }]}>
        {current.name}: your phone will report only home or away when you cross the blue circle ({current.home_radius_m} m).
      </Text>
      <HomeMap lat={current.home_lat} lng={current.home_lng} radiusM={current.home_radius_m} />
      <ErrorText text={error} />
      <Button title="Confirm this is my home" onPress={confirm} busy={busy} />
    </ScrollView>
  );
}
