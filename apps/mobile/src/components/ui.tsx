import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';

export const ui = StyleSheet.create({
  screen: { flex: 1, padding: 16, backgroundColor: '#fff' },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 12 },
  h2: { fontSize: 18, fontWeight: '600', marginTop: 24, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 16, marginBottom: 10 },
  button: { backgroundColor: '#111', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 6 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  buttonAlt: { backgroundColor: '#eee' },
  buttonAltText: { color: '#111' },
  error: { color: '#b00020', marginVertical: 6 },
  hint: { color: '#666', fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  option: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, marginBottom: 8 },
  optionOn: { borderColor: '#111', backgroundColor: '#f2f2f2' },
  optionTitle: { fontSize: 16, fontWeight: '600' },
});

export function Button({ title, onPress, busy, alt, disabled }: {
  title: string; onPress: () => void; busy?: boolean; alt?: boolean; disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={busy || disabled}
      style={[ui.button, alt && ui.buttonAlt, (busy || disabled) && { opacity: 0.5 }]}>
      {busy ? <ActivityIndicator color={alt ? '#111' : '#fff'} /> : <Text style={[ui.buttonText, alt && ui.buttonAltText]}>{title}</Text>}
    </Pressable>
  );
}

export const Field = (p: TextInputProps) => <TextInput placeholderTextColor="#999" style={ui.input} {...p} />;

export const ErrorText = ({ text }: { text: string | null }) => (text ? <Text style={ui.error}>{text}</Text> : null);

export const Row = ({ children }: { children: React.ReactNode }) => <View style={ui.row}>{children}</View>;
