import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Tables } from '@homebase/core/src/db.types';
import { friendlyError } from '../lib/errors';
import { subscribeLive } from '../lib/live';
import { supabase } from '../lib/supabase';

const CURRENT_KEY = 'homebase.currentHousehold';

export type Household = Tables<'households'>;
export type Membership = Tables<'household_members'>;
export type Member = Membership & { display_name: string };
/** A household I've asked to join: all a pending member may see. */
export type PendingHousehold = { id: string; name: string; owner_name: string };

interface Value {
  households: Household[];
  current: Household | null;
  setCurrent: (id: string) => void;
  /** Active members of the current household. */
  members: Member[];
  /** Pending join requests to the current household (the owner approves them). */
  requests: Member[];
  me: Membership | null;
  /** My membership in every household (for geofencing across households). */
  myMemberships: Membership[];
  /** Households waiting to approve me. */
  pending: PendingHousehold[];
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
  const [pending, setPending] = useState<PendingHousehold[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    // RLS limits these to households I'm active in, their members (incl. requests), and my own pending rows.
    const [h, m, p, w] = await Promise.all([
      supabase.from('households').select('*').order('created_at'),
      supabase.from('household_members').select('*'),
      supabase.from('profiles').select('id, display_name'),
      supabase.rpc('my_pending_households'),
    ]);
    const err = h.error ?? m.error ?? p.error ?? w.error;
    if (err) throw err;
    setPending(w.data ?? []);
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'household_members' }, quiet);
    return subscribeLive(channel, quiet);
  }, [refresh, userId]);

  const setCurrent = useCallback((id: string) => {
    setCurrentId(id);
    AsyncStorage.setItem(CURRENT_KEY, id).catch(() => {});
  }, []);

  const value = useMemo<Value>(() => {
    const current = households.find((x) => x.id === currentId) ?? households[0] ?? null;
    const inCurrent = memberships.filter((x) => x.household_id === current?.id)
      .map((x) => ({ ...x, display_name: names[x.user_id] ?? 'Roommate' }));
    return {
      households,
      current,
      setCurrent,
      members: inCurrent.filter((x) => x.status === 'active'),
      requests: inCurrent.filter((x) => x.status === 'pending'),
      me: inCurrent.find((x) => x.user_id === userId && x.status === 'active') ?? null,
      myMemberships: memberships.filter((x) => x.user_id === userId && x.status === 'active'),
      pending,
      loading,
      error,
      reload,
      refresh,
    };
  }, [households, memberships, names, pending, currentId, userId, loading, error, reload, setCurrent, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHouseholds(): Value {
  const v = useContext(Ctx);
  if (!v) throw new Error('useHouseholds must be used inside HouseholdsProvider');
  return v;
}
