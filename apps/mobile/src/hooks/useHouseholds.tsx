import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import type { Tables } from '@homebase/core/src/db.types';
import { friendlyError } from '../lib/errors';
import { supabase } from '../lib/supabase';

const CURRENT_KEY = 'homebase.currentHousehold';

export type Household = Tables<'households'>;
export type Membership = Tables<'household_members'>;
export type Member = Membership & { display_name: string };

interface Value {
  households: Household[];
  current: Household | null;
  setCurrent: (id: string) => void;
  members: Member[];
  me: Membership | null;
  /** My membership in every household (for geofencing across households). */
  myMemberships: Membership[];
  loading: boolean;
  error: string | null;
  /** Re-run the initial load after a failure. */
  reload: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<Value | null>(null);

export function HouseholdsProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const [households, setHouseholds] = useState<Household[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    // RLS limits all three to my households and their members.
    const [h, m, p] = await Promise.all([
      supabase.from('households').select('*').order('created_at'),
      supabase.from('household_members').select('*'),
      supabase.from('profiles').select('id, display_name'),
    ]);
    const err = h.error ?? m.error ?? p.error;
    if (err) throw err;
    setHouseholds(h.data ?? []);
    setMemberships(m.data ?? []);
    setNames(Object.fromEntries((p.data ?? []).map((r) => [r.id, r.display_name])));
  }, []);

  const reload = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      setCurrentId(await AsyncStorage.getItem(CURRENT_KEY));
      await refresh();
    } catch (e) {
      setError(friendlyError(e as Error));
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  useEffect(() => { reload(); }, [reload, userId]);

  // Settings (e.g. a roommate's visibility) change elsewhere: refresh on any member change (RLS: my households only) and on foreground.
  useEffect(() => {
    const quiet = () => { refresh().catch(() => {}); };
    const channel = supabase.channel(`members:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'household_members' }, quiet)
      .subscribe();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') quiet(); });
    return () => {
      sub.remove();
      supabase.removeChannel(channel);
    };
  }, [refresh, userId]);

  const setCurrent = useCallback((id: string) => {
    setCurrentId(id);
    AsyncStorage.setItem(CURRENT_KEY, id).catch(() => {});
  }, []);

  const value = useMemo<Value>(() => {
    const current = households.find((x) => x.id === currentId) ?? households[0] ?? null;
    const inCurrent = memberships.filter((x) => x.household_id === current?.id);
    return {
      households,
      current,
      setCurrent,
      members: inCurrent.map((x) => ({ ...x, display_name: names[x.user_id] ?? 'Roommate' })),
      me: inCurrent.find((x) => x.user_id === userId) ?? null,
      myMemberships: memberships.filter((x) => x.user_id === userId),
      loading,
      error,
      reload,
      refresh,
    };
  }, [households, memberships, names, currentId, userId, loading, error, reload, setCurrent, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHouseholds(): Value {
  const v = useContext(Ctx);
  if (!v) throw new Error('useHouseholds must be used inside HouseholdsProvider');
  return v;
}
