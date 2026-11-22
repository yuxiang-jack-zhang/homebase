import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ensureNotificationPermission, notifyMember } from '../lib/notify';
import { newTargets } from '../lib/questionLogic';
import { supabase } from '../lib/supabase';

const SEEN_KEY = 'homebase.notifiedTargets';
const DEBOUNCE_MS = 1500; // the draft row is inserted just after its target; wait so the notification can carry it

export interface InboxItem {
  id: string; // question_target id
  askerName: string;
  question: string;
  draft: string | null;
  created_at: string;
}

/** Questions awaiting my reply in any of my households (RLS limits rows to mine). New ones fire one local notification each. */
export function useInbox(userId: string) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seen = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    const [t, p] = await Promise.all([
      supabase.from('question_targets')
        .select('id, created_at, questions(text, asker_id), responses(visibility, text)')
        .eq('user_id', userId).eq('status', 'awaiting_reply').order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, display_name'),
    ]);
    const err = t.error ?? p.error;
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    const names = Object.fromEntries((p.data ?? []).map((r) => [r.id, r.display_name]));
    const next = (t.data ?? []).filter((r) => r.questions).map((r): InboxItem => ({
      id: r.id,
      askerName: names[r.questions!.asker_id] ?? 'A roommate',
      question: r.questions!.text,
      draft: r.responses.find((x) => x.visibility === 'draft')?.text ?? null,
      created_at: r.created_at,
    }));
    setError(null);
    setItems(next);
    setLoading(false);

    if (!seen.current) {
      const raw = await AsyncStorage.getItem(SEEN_KEY).catch(() => null);
      seen.current = new Set<string>(raw ? JSON.parse(raw) : []);
    }
    const fresh = newTargets(next, seen.current);
    if (fresh.length === 0) return;
    // Mark first and persist before notifying, so a reload racing this one cannot notify twice.
    fresh.forEach((f) => seen.current!.add(f.id));
    await AsyncStorage.setItem(SEEN_KEY, JSON.stringify([...seen.current].slice(-200))).catch(() => {});
    await ensureNotificationPermission().catch(() => {});
    for (const f of fresh) {
      await notifyMember({ questionTargetId: f.id, askerName: f.askerName, question: f.question, draft: f.draft })
        .catch((e) => console.warn('[notify] schedule failed:', e));
    }
  }, [userId]);

  useEffect(() => {
    load();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = () => { clearTimeout(timer); timer = setTimeout(load, DEBOUNCE_MS); };
    const channel = supabase.channel(`inbox:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'question_targets', filter: `user_id=eq.${userId}` }, later)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'responses' }, later)
      .subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [userId, load]);

  /** Drop an item right after a successful reply, before realtime catches up. */
  const remove = useCallback((id: string) => setItems((cur) => cur.filter((i) => i.id !== id)), []);
  return { items, loading, error, reload: load, remove };
}
