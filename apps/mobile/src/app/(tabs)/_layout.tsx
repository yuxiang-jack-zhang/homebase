import { Tabs } from 'expo-router';
import { HouseholdSwitcher } from '../../components/HouseholdSwitcher';

// lazy: false mounts the inbox tab at startup, so its hook notifies even if the tab is never opened.
export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ lazy: false, headerTitle: () => <HouseholdSwitcher /> }}>
      <Tabs.Screen name="index" options={{ title: "Who's home" }} />
      <Tabs.Screen name="inbox" options={{ title: 'Inbox' }} />
      <Tabs.Screen name="stats" options={{ title: 'Stats' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
