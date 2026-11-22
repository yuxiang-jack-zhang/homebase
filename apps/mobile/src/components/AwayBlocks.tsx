import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Tables } from '@homebase/core/src/db.types';
import { crossesMidnight, validateBlock } from '../lib/blockForm';
import { friendlyError } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { Button, ErrorText, Field, ui } from './ui';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hhmm = (t: string) => t.slice(0, 5); // Postgres returns HH:MM:SS

export function AwayBlocks({ householdId, userId }: { householdId: string; userId: string }) {
  const [blocks, setBlocks] = useState<Tables<'away_blocks'>[]>([]);
  const [adding, setAdding] = useState(false);
  const [days, setDays] = useState<number[]>([]);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    // RLS: only my own rows come back.
    const { data, error: e } = await supabase.from('away_blocks').select('*').eq('household_id', householdId).eq('user_id', userId);
    if (e) setError(friendlyError(e));
    else setBlocks(data);
  }, [householdId, userId]);
  useEffect(() => { load(); }, [load]);

  async function add() {
    const r = validateBlock({ days, start, end, label });
    if (!r.ok) return setError(r.error);
    const { error: e } = await supabase.from('away_blocks').insert({ household_id: householdId, user_id: userId, ...r.value });
    if (e) return setError(friendlyError(e));
    setError(null);
    setAdding(false);
    setDays([]);
    setLabel('');
    load();
  }

  async function remove(id: string) {
    const { error: e } = await supabase.from('away_blocks').delete().eq('id', id);
    if (e) setError(friendlyError(e));
    else load();
  }

  return (
    <View>
      <Text style={ui.hint}>Regular times you are usually out (work, class). Homebase uses them to guess when you are away.</Text>
      {blocks.map((b) => (
        <View key={b.id} style={ui.row}>
          <View style={{ flex: 1 }}>
            <Text style={ui.optionTitle}>{b.label ?? 'Away'}</Text>
            <Text style={ui.hint}>
              {[...b.days_of_week].sort().map((d) => DAYS[d]).join(' ')} {hhmm(b.start_local)}-{hhmm(b.end_local)}
              {crossesMidnight(hhmm(b.start_local), hhmm(b.end_local)) ? ' (overnight)' : ''}
            </Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${b.label ?? 'away block'}`} onPress={() => remove(b.id)}>
            <Text style={{ color: '#b00020' }}>Delete</Text>
          </Pressable>
        </View>
      ))}
      {adding ? (
        <View style={{ marginTop: 8 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {DAYS.map((d, i) => {
              const on = days.includes(i);
              return (
                <Pressable
                  key={d}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  onPress={() => setDays(on ? days.filter((x) => x !== i) : [...days, i])}
                  style={[ui.option, on && ui.optionOn, { marginBottom: 0, paddingVertical: 8, paddingHorizontal: 10 }]}>
                  <Text>{d}</Text>
                </Pressable>
              );
            })}
          </View>
          <Field placeholder="Start (HH:MM, 24-hour)" value={start} onChangeText={setStart} keyboardType="numbers-and-punctuation" />
          <Field placeholder="End (HH:MM, 24-hour)" value={end} onChangeText={setEnd} keyboardType="numbers-and-punctuation" />
          {crossesMidnight(start, end) && <Text style={ui.hint}>End is earlier than start, so this block runs overnight into the next day.</Text>}
          <Field placeholder="Label (optional)" value={label} onChangeText={setLabel} maxLength={40} />
          <Button title="Save block" onPress={add} />
          <Button title="Cancel" alt onPress={() => { setAdding(false); setError(null); }} />
        </View>
      ) : (
        <Button title="Add away block" alt onPress={() => setAdding(true)} />
      )}
      <ErrorText text={error} />
    </View>
  );
}
