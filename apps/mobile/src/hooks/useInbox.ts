import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ensureNotificationPermission, notifyMember } from '../lib/notify';
import { newTargets, notifyDecision, seedOnFirstRun } from '../lib/questionLogic';
import { subscribeLive } from '../lib/live';
import { supabase } from '../lib/supabase';

const SEEN_KEY = 'homebase.notifiedTargets';
const DEBOUNCE_MS = 1500;
const RECHECK_MS = 5500; // a draft-less question gets one re-check after the draft grace period

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
  const seq = useRef(0);
  const recheck = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Resolved once so concurrent loads share one set; corrupt storage means an empty set.
  const seenP = useRef<Promise<{ set: Set<string>; first: boolean }>>(undefined);
  const getSeen = () => (seenP.current ??= AsyncStorage.getItem(SEEN_KEY).then((raw) => {
    try {
      return { set: new Set<string>(raw ? JSON.parse(raw) : []), first: raw === null };
    } catch {
      return { set: new Set<string>(), first: false };
    }
  }, () => ({ set: new Set<string>(), first: false })));

  const load = useCallback(async () => {
    if (!userId) return;
    const mine = ++seq.current; // drop out-of-order or post-switch responses
    const [t, p] = await Promise.all([
      supabase.from('question_targets')
        .select('id, created_at, questions(text, asker_id), responses(visibility, text)')
        .eq('user_id', userId).eq('status', 'awaiting_reply').order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, display_name'),
    ]);
    if (mine !== seq.current) return;
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

    const seen = await getSeen();
    const now = Date.now();
    const persist = () => AsyncStorage.setItem(SEEN_KEY, JSON.stringify([...seen.set].slice(-200))).catch(() => {});
    const seed = seedOnFirstRun(next, seen.first, now);
    if (seen.first) {
      seen.first = false;
      seed.forEach((id) => seen.set.add(id));
      await persist(); // also creates the key, so the next launch isn't "first" again
    }
    const ready = newTargets(next, seen.set).filter((i) => notifyDecision(i, now) === 'notify');
    const waiting = newTargets(next, seen.set).length > ready.length;
    if (waiting) {
      clearTimeout(recheck.current);
      recheck.current = setTimeout(load, RECHECK_MS);
    }
    if (ready.length === 0) return;
    // Mark and persist before notifying, so a racing load cannot notify twice.
    ready.forEach((f) => seen.set.add(f.id));
    await persist();
    await ensureNotificationPermission().catch(() => {});
    for (const f of ready) {
      await notifyMember({ questionTargetId: f.id, askerName: f.askerName, question: f.question, draft: f.draft })
        .catch((e) => console.warn('[notify] schedule failed:', e));
    }
  }, [userId]);

  useEffect(() => {
    seq.current++;
    setItems([]);
    if (!userId) return;
    load();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = () => { clearTimeout(timer); timer = setTimeout(load, DEBOUNCE_MS); };
    const channel = supabase.channel(`inbox:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'question_targets', filter: `user_id=eq.${userId}` }, later)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'responses' }, later);
    const stop = subscribeLive(channel, later);
    return () => {
      clearTimeout(timer);
      clearTimeout(recheck.current);
      stop();
    };
  }, [userId, load]);

  /** Drop an item right after a successful reply, before realtime catches up. */
  const remove = useCallback((id: string) => setItems((cur) => cur.filter((i) => i.id !== id)), []);
  return { items, loading, error, reload: load, remove };
}
