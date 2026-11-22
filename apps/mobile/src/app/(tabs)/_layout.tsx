import { Tabs } from 'expo-router';
import { HouseholdSwitcher } from '../../components/HouseholdSwitcher';

// Later tasks add tabs (who's home, inbox, stats) next to settings.
export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerTitle: () => <HouseholdSwitcher /> }}>
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
