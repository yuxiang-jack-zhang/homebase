import { useCallback, useEffect, useRef, useState } from 'react';
import { friendlyError } from '../lib/errors';
import { accuracyRows, type AccuracyRow } from '../lib/stats';
import { supabase } from '../lib/supabase';

/** Prediction accuracy for one household; a response for a household we've since left is dropped. */
export function useAccuracy(householdId: string | undefined) {
  const [data, setData] = useState<AccuracyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    if (!householdId) return setData(null);
    const { data: d, error: e } = await supabase.rpc('household_accuracy', { p_household_id: householdId });
    if (mine !== seq.current) return;
    if (e) return setError(friendlyError(e));
    setError(null);
    setData(d ?? []);
  }, [householdId]);

  useEffect(() => { setData(null); setError(null); void load(); }, [load]);
  return { ...(data ? accuracyRows(data) : { rows: [], overall: null }), loaded: data !== null, error, reload: load };
}
