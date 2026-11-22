import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Button, ErrorText, Field, ui } from '../../components/ui';
import { useHouseholds } from '../../hooks/useHouseholds';
import { useInbox, type InboxItem } from '../../hooks/useInbox';
import { reply } from '../../lib/api';
import { friendlyError } from '../../lib/errors';
import { dismissForQuestion } from '../../lib/notify';

function Item({ item, onDone }: { item: InboxItem; onDone: (notice?: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const send = async (req: { action: 'approve' | 'yes' | 'no' | 'not_sure' } | { action: 'text'; text: string }) => {
    setBusy(true);
    setError(null);
    try {
      await reply({ questionTargetId: item.id, ...req });
      void dismissForQuestion(item.id);
      onDone();
    } catch (e) {
      const msg = friendlyError(e as Error);
      // Already answered elsewhere: the item leaves, and the screen (which outlives it) shows why.
      if ((e as Error).message === 'not_awaiting_reply') {
        void dismissForQuestion(item.id);
        onDone(msg);
      } else setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={ui.option}>
      <Text style={ui.hint}>{item.askerName} asks</Text>
      <Text style={ui.optionTitle}>{item.question}</Text>
      {item.draft && <Text style={{ marginTop: 6 }}>Suggested answer: {item.draft}</Text>}
      <ErrorText text={error} />
      {typing ? (
        <>
          <Field placeholder="Your reply" value={text} onChangeText={setText} maxLength={280} />
          <Button title="Send reply" busy={busy} disabled={!text.trim()} onPress={() => send({ action: 'text', text: text.trim() })} />
          <Button title="Cancel" alt onPress={() => setTyping(false)} />
        </>
      ) : (
        <>
          {item.draft && <Button title="Approve" busy={busy} onPress={() => send({ action: 'approve' })} />}
          <Button title="Yes" busy={busy} alt onPress={() => send({ action: 'yes' })} />
          <Button title="No" busy={busy} alt onPress={() => send({ action: 'no' })} />
          <Button title="Not sure" busy={busy} alt onPress={() => send({ action: 'not_sure' })} />
          <Button title="Reply" busy={busy} alt onPress={() => setTyping(true)} />
        </>
      )}
    </View>
  );
}

export default function Inbox() {
  const { me } = useHouseholds();
  const { items, loading, error, remove } = useInbox(me?.user_id ?? '');
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <ScrollView style={ui.screen}>
      <ErrorText text={error} />
      {notice && <Text accessibilityRole="alert" style={ui.hint}>{notice}</Text>}
      {!loading && items.length === 0 && <Text style={ui.hint}>Nothing waiting for you.</Text>}
      {items.map((i) => <Item key={i.id} item={i} onDone={(n) => { setNotice(n ?? null); remove(i.id); }} />)}
    </ScrollView>
  );
}
