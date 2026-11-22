import { useCallback, useRef, useState } from 'react';
import { friendlyError } from '../lib/errors';
import { accuracyRows, forHousehold, type AccuracyRow } from '../lib/stats';
import { supabase } from '../lib/supabase';

interface State { id: string; data?: AccuracyRow[]; error?: string }

/**
 * Prediction accuracy for one household. Results are keyed by household id, so a switch never shows
 * the previous household's numbers, and a late response for a household we've left is dropped.
 * The caller runs `reload` on focus (which also fires on mount and when the household changes).
 */
export function useAccuracy(householdId: string | undefined) {
  const [state, setState] = useState<State | null>(null);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    if (!householdId) return;
    const { data, error } = await supabase.rpc('household_accuracy', { p_household_id: householdId });
    if (mine !== seq.current) return;
    // A failed refresh keeps the last good numbers for this household.
    setState((s) => (error ? { id: householdId, data: s?.id === householdId ? s.data : undefined, error: friendlyError(error) } : { id: householdId, data: data ?? [] }));
  }, [householdId]);

  const cur = forHousehold(state, householdId);
  return { ...(cur?.data ? accuracyRows(cur.data) : { rows: [], overall: null }), loaded: !!cur?.data, error: cur?.error ?? null, reload };
}
