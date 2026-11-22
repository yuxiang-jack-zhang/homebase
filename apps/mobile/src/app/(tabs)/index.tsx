import { ScrollView, Text, View } from 'react-native';
import { Button, ErrorText, ui } from '../../components/ui';
import { useHomeGeofencing } from '../../hooks/useHomeGeofencing';
import { useHouseholds } from '../../hooks/useHouseholds';
import { usePresence } from '../../hooks/usePresence';
import { presenceLabel } from '../../lib/presenceLogic';

export default function WhosHome() {
  const { current, members, me } = useHouseholds();
  const userId = me?.user_id ?? '';
  const { presence, error } = usePresence(current?.id);
  const geo = useHomeGeofencing(userId);

  return (
    <ScrollView style={ui.screen}>
      {geo.always === false && (
        <View style={{ marginBottom: 16 }}>
          <Text style={ui.h2}>Allow location "Always"</Text>
          <Text style={ui.hint}>
            So your phone can notice when you arrive or leave home while the app is closed. Only home or away is shared, never where you are.
          </Text>
          <Button title="Allow Always" onPress={geo.requestAlways} />
        </View>
      )}
      {geo.truncated && <Text style={ui.hint}>iOS tracks at most 20 homes; only your 20 most recently joined households are watched.</Text>}
      <ErrorText text={geo.error ?? error} />
      {members.map((m) => (
        <View key={m.user_id} style={ui.row}>
          <Text style={ui.optionTitle}>{m.user_id === userId ? 'You' : m.display_name}</Text>
          <Text>{presenceLabel(presence[m.user_id])}</Text>
        </View>
      ))}
    </ScrollView>
  );
}
