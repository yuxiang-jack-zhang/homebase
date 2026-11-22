import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ask } from '../lib/api';
import { friendlyError } from '../lib/errors';
import { Button, ErrorText, Field, ui } from './ui';

const EVERYONE = 'everyone';

export function AskBox({ householdId, others, onAsked }: {
  householdId: string;
  others: { user_id: string; display_name: string }[];
  onAsked?: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]); // user ids, or [EVERYONE]
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = text.trim();
  const ready = picked.length > 0 && trimmed.length > 0 && trimmed.length <= 280;
  const toggle = (id: string) =>
    setPicked((p) => (id === EVERYONE ? (p[0] === EVERYONE ? [] : [EVERYONE])
      : p.includes(id) ? p.filter((x) => x !== id) : [...p.filter((x) => x !== EVERYONE), id]));

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await ask({ householdId, target: picked[0] === EVERYONE ? 'everyone' : { userIds: picked }, text: trimmed });
      setText('');
      setPicked([]);
      onAsked?.();
    } catch (e) {
      setError(friendlyError(e as Error));
    } finally {
      setBusy(false);
    }
  };

  const chips = [...others.map((m) => ({ id: m.user_id, label: m.display_name })), { id: EVERYONE, label: 'Everyone' }];
  return (
    <View>
      <Text style={ui.h2}>Ask</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        {chips.map((c) => (
          <Pressable
            key={c.id}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: picked.includes(c.id) }}
            onPress={() => toggle(c.id)}
            style={[ui.option, { marginBottom: 0 }, picked.includes(c.id) && ui.optionOn]}>
            <Text>{c.label}</Text>
          </Pressable>
        ))}
      </View>
      <Field placeholder="Ask, e.g. will you be home at 7?" value={text} onChangeText={setText} maxLength={280} />
      <ErrorText text={error} />
      <Button title="Send" onPress={send} busy={busy} disabled={!ready} />
    </View>
  );
}
