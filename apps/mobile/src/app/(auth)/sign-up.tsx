import { Link } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Button, ErrorText, Field, ui } from '../../components/ui';
import { supabase } from '../../lib/supabase';

export default function SignUp() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    // The profiles trigger requires display_name in the user metadata.
    const { data, error: e } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { display_name: name.trim() } },
    });
    if (e) setError(e.message);
    else if (!data.session) setNotice('Check your email to confirm your account, then sign in.');
    setBusy(false);
  }

  const nameOk = name.trim().length >= 1 && name.trim().length <= 40;
  return (
    <View style={[ui.screen, { justifyContent: 'center' }]}>
      <Text style={ui.title}>Create account</Text>
      <Field placeholder="Display name (shown to roommates)" value={name} onChangeText={setName} maxLength={40} autoComplete="name" />
      <Field placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <Field placeholder="Password (6+ characters)" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
      <ErrorText text={error} />
      {notice && <Text style={ui.hint}>{notice}</Text>}
      <Button title="Sign up" onPress={submit} busy={busy} disabled={!nameOk || !email || password.length < 6} />
      <Link href="/sign-in" style={[ui.hint, { textAlign: 'center', marginTop: 16 }]}>Already have an account? Sign in</Link>
    </View>
  );
}
