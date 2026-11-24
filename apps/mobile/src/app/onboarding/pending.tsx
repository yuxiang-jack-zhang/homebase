import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Button, ErrorText, ui } from '../../components/ui';
import { useHouseholds } from '../../hooks/useHouseholds';
import { friendlyError } from '../../lib/errors';
import { signOut } from '../../lib/geofence';
import { supabase } from '../../lib/supabase';

/** Asked to join, not yet approved: a pending member may see only the household's name and its owner. */
export default function PendingScreen() {
  const { pending, refresh } = useHouseholds();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, action: () => PromiseLike<{ error: unknown } | void>) {
    setBusy(key);
    setError(null);
    try {
      const res = await action();
      if (res?.error) throw res.error;
      await refresh(); // approval also arrives live; this is for the impatient
    } catch (e) {
      setError(friendlyError(e as Error));
    }
    setBusy(null);
  }

  return (
    <ScrollView style={ui.screen} contentContainerStyle={{ paddingTop: 48 }}>
      <Text style={ui.title}>Waiting for approval</Text>
      {pending.map((p) => (
        <View key={p.id} style={ui.option}>
          <Text style={ui.optionTitle}>Waiting for {p.name} to approve you</Text>
          <Text style={ui.hint}>{p.owner_name} will see your request in Settings.</Text>
          <Button title="Cancel request" alt busy={busy === p.id}
            onPress={() => run(p.id, () => supabase.rpc('leave_household', { p_household_id: p.id }))} />
        </View>
      ))}
      <Button title="Check again" busy={busy === 'refresh'} onPress={() => run('refresh', async () => {})} />
      <ErrorText text={error} />
      <Button title="Sign out" alt onPress={signOut} />
    </ScrollView>
  );
}
