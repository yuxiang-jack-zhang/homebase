import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Text, View } from 'react-native';
import { Button, ui } from '../components/ui';
import { HouseholdsProvider, useHouseholds } from '../hooks/useHouseholds';
import { useSession } from '../hooks/useSession';
import { gate } from '../lib/gate';
import { initNotifications } from '../lib/notify';
import '../lib/geofence'; // registers the geofence task at startup, even on a headless relaunch

const Spinner = () => (
  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
    <ActivityIndicator />
  </View>
);

function SignedInStack() {
  const { loading, error, households, current, me, pending, reload } = useHouseholds();
  const state = gate({
    signedIn: true, loading, error, households, current, confirmed: !!me?.home_confirmed_at, pending: pending.length > 0,
  });
  if (state === 'loading') return <Spinner />;
  if (state === 'error') {
    return (
      <View style={[ui.screen, { justifyContent: 'center' }]}>
        <Text style={ui.title}>Couldn't load your households</Text>
        <Text style={ui.hint}>{error}</Text>
        <Button title="Retry" onPress={reload} />
      </View>
    );
  }
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={state === 'tabs'}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      <Stack.Protected guard={state === 'onboarding' || state === 'tabs'}>
        <Stack.Screen name="onboarding/household" />
      </Stack.Protected>
      <Stack.Protected guard={state === 'pending'}>
        <Stack.Screen name="onboarding/pending" />
      </Stack.Protected>
      <Stack.Protected guard={state === 'confirm-home'}>
        <Stack.Screen name="onboarding/confirm-home" />
      </Stack.Protected>
      <Stack.Protected guard={false}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}

export default function Root() {
  const session = useSession();
  useEffect(() => { initNotifications().catch((e) => console.warn('[notify] init failed:', e)); }, []);
  if (session === undefined) return <Spinner />;
  return (
    <>
      <StatusBar style="auto" />
      {session ? (
        <HouseholdsProvider key={session.user.id} userId={session.user.id}>
          <SignedInStack />
        </HouseholdsProvider>
      ) : (
        // expo-router registers every route and "/" resolves to (tabs), so guard the signed-in ones explicitly.
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" />
          <Stack.Protected guard={false} redirectTo="/sign-in">
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="onboarding/household" />
            <Stack.Screen name="onboarding/pending" />
            <Stack.Screen name="onboarding/confirm-home" />
          </Stack.Protected>
        </Stack>
      )}
    </>
  );
}
