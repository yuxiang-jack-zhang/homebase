import { Tabs } from 'expo-router';
import { useEffect } from 'react';
import { HouseholdSwitcher } from '../../components/HouseholdSwitcher';
import { startCalendarAwaySync } from '../../lib/calendarAway';

// lazy: false mounts the inbox tab at startup, so its hook notifies even if the tab is never opened.
export default function TabsLayout() {
  useEffect(startCalendarAwaySync, []); // calendar away periods: sync on open and on every foreground
  return (
    <Tabs screenOptions={{ lazy: false, headerTitle: () => <HouseholdSwitcher /> }}>
      <Tabs.Screen name="index" options={{ title: "Who's home" }} />
      <Tabs.Screen name="inbox" options={{ title: 'Inbox' }} />
      <Tabs.Screen name="stats" options={{ title: 'Stats' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
