import { Tabs } from 'expo-router';
import { HouseholdSwitcher } from '../../components/HouseholdSwitcher';

// Later tasks add tabs (inbox, stats) next to these.
export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerTitle: () => <HouseholdSwitcher /> }}>
      <Tabs.Screen name="index" options={{ title: "Who's home" }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
