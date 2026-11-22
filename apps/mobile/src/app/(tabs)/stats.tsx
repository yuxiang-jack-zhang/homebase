import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { ErrorText, ui } from '../../components/ui';
import { useAccuracy } from '../../hooks/useAccuracy';
import { useHouseholds } from '../../hooks/useHouseholds';
import type { StatRow } from '../../lib/stats';

function Card({ r }: { r: StatRow }) {
  return (
    <View style={ui.option}>
      <Text style={ui.optionTitle}>{r.label}: {r.accuracy}</Text>
      <Text style={ui.hint}>{r.correct} correct · {r.incorrect} incorrect · {r.unscored} unscored</Text>
    </View>
  );
}

export default function Stats() {
  const { current } = useHouseholds();
  const { rows, overall, loaded, error, reload } = useAccuracy(current?.id);
  const [refreshing, setRefreshing] = useState(false);
  useFocusEffect(useCallback(() => { void reload(); }, [reload]));
  const empty = loaded && rows.length === 0;
  return (
    <ScrollView
      style={ui.screen}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); try { await reload(); } finally { setRefreshing(false); } }} />}
    >
      <ErrorText text={error} />
      <Text style={ui.hint}>Only future predictions count</Text>
      {empty && <Text style={ui.hint}>No predictions yet.</Text>}
      {!empty && overall && <Card r={overall} />}
      {rows.map((r) => <Card key={r.kind} r={r} />)}
    </ScrollView>
  );
}
