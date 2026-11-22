import { ActionSheetIOS, Pressable, Text } from 'react-native';
import { useHouseholds } from '../hooks/useHouseholds';

export function HouseholdSwitcher() {
  const { households, current, setCurrent } = useHouseholds();
  if (!current) return null;
  const choose = () =>
    ActionSheetIOS.showActionSheetWithOptions(
      { options: [...households.map((h) => h.name), 'Cancel'], cancelButtonIndex: households.length, title: 'Switch household' },
      (i) => {
        if (i < households.length) setCurrent(households[i].id);
      },
    );
  return (
    <Pressable onPress={choose} accessibilityRole="button" accessibilityLabel="Switch household" hitSlop={8}>
      <Text style={{ fontSize: 17, fontWeight: '600' }}>{current.name}{households.length > 1 ? ' ▾' : ''}</Text>
    </Pressable>
  );
}
