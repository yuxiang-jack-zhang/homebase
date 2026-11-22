import { Link } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Button, ErrorText, Field, ui } from '../../components/ui';
import { supabase } from '../../lib/supabase';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (e) setError(e.message);
    setBusy(false);
  }

  return (
    <View style={[ui.screen, { justifyContent: 'center' }]}>
      <Text style={ui.title}>Homebase</Text>
      <Field placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <Field placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" />
      <ErrorText text={error} />
      <Button title="Sign in" onPress={submit} busy={busy} disabled={!email || !password} />
      <Link href="/sign-up" style={[ui.hint, { textAlign: 'center', marginTop: 16 }]}>New here? Create an account</Link>
    </View>
  );
}
