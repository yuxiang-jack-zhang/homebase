import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { HouseholdsProvider, useHouseholds } from '../hooks/useHouseholds';
import { useSession } from '../hooks/useSession';

const Spinner = () => (
  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
    <ActivityIndicator />
  </View>
);

// Gate: signed out -> auth; no household -> create/join; home not yet confirmed -> confirm; else tabs.
function SignedInStack() {
  const { loading, current, me } = useHouseholds();
  if (loading) return <Spinner />;
  const confirmed = !!me?.home_confirmed_at;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!current && confirmed}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      <Stack.Protected guard={!current || confirmed}>
        <Stack.Screen name="onboarding/household" />
      </Stack.Protected>
      <Stack.Protected guard={!!current && !confirmed}>
        <Stack.Screen name="onboarding/confirm-home" />
      </Stack.Protected>
    </Stack>
  );
}

export default function Root() {
  const session = useSession();
  if (session === undefined) return <Spinner />;
  return (
    <>
      <StatusBar style="auto" />
      {session ? (
        <HouseholdsProvider key={session.user.id} userId={session.user.id}>
          <SignedInStack />
        </HouseholdsProvider>
      ) : (
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" />
        </Stack>
      )}
    </>
  );
}
