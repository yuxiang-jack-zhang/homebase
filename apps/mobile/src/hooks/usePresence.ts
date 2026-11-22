import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { supabase } from '../lib/supabase';
import type { Kind } from '../lib/presenceLogic';

export type Presence = Record<string, { kind: Kind; at: string }>; // by user id

/** Latest home/away per member of a household. RLS hides members with visibility off. */
export function usePresence(householdId: string | undefined) {
  const [presence, setPresence] = useState<Presence>({});
  const [error, setError] = useState<string | null>(null);

  const idRef = useRef(householdId);
  idRef.current = householdId;

  const load = useCallback(async () => {
    if (!householdId) return;
    const { data, error: e } = await supabase
      .from('current_presence').select('user_id, kind, at').eq('household_id', householdId);
    if (idRef.current !== householdId) return; // switched households while loading
    if (e) return setError(e.message);
    setError(null);
    setPresence(Object.fromEntries((data ?? []).map((r) => [r.user_id, { kind: r.kind, at: r.at }])));
  }, [householdId]);

  useEffect(() => {
    setPresence({});
    if (!householdId) return;
    load();
    const channel = supabase
      .channel(`presence:${householdId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'presence_events', filter: `household_id=eq.${householdId}` },
        (p) => {
          const r = p.new as { user_id: string; kind: Kind; at: string };
          // Events can arrive out of order; keep the newest per user.
          setPresence((cur) => (cur[r.user_id] && Date.parse(cur[r.user_id].at) > Date.parse(r.at) ? cur : { ...cur, [r.user_id]: { kind: r.kind, at: r.at } }));
        })
      .subscribe();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') load(); });
    return () => {
      sub.remove();
      supabase.removeChannel(channel);
    };
  }, [householdId, load]);

  return { presence, error };
}
