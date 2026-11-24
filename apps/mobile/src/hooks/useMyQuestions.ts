import { useCallback, useEffect, useRef, useState } from 'react';
import type { QuestionItem } from '../components/AnswerList';
import { subscribeLive } from '../lib/live';
import { guessRefetchIn } from '../lib/questionLogic';
import { supabase } from '../lib/supabase';

type Row = Omit<QuestionItem, 'targets'> & { targets: (Omit<QuestionItem['targets'][number], 'name'> & { user_id: string })[] };

/** My last 10 questions in a household with per-target status, live. RLS gives the asker only `sent` responses; filtered again here. */
export function useMyQuestions(householdId: string | undefined, userId: string, names: Record<string, string>) {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!householdId || !userId) return;
    const mine = ++seq.current; // drop out-of-order or post-switch responses
    const { data, error: e } = await supabase
      .from('questions')
      .select('id, text, created_at, question_targets(id, user_id, status, created_at, target_guesses(guess), responses(visibility, text, created_at))')
      .eq('household_id', householdId).eq('asker_id', userId)
      .order('created_at', { ascending: false }).limit(10);
    if (mine !== seq.current) return;
    if (e) return setError(e.message);
    setError(null);
    setRows((data ?? []).map((q) => ({
      id: q.id, text: q.text, created_at: q.created_at,
      targets: q.question_targets.map((t) => ({
        id: t.id, user_id: t.user_id, status: t.status, fallback_guess: t.target_guesses?.guess ?? null, created_at: t.created_at,
        text: [...t.responses].filter((r) => r.visibility === 'sent').sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.text ?? null,
      })),
    })));
  }, [householdId, userId]);

  useEffect(() => {
    seq.current++;
    setRows([]);
    if (!householdId || !userId) return;
    load();
    // No server-side filter possible on these joins; RLS limits events to rows I may read, and a reload is cheap.
    const channel = supabase.channel(`my-questions:${householdId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'question_targets' }, () => load())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'responses' }, () => load());
    return subscribeLive(channel, load);
  }, [householdId, userId, load]);

  // No realtime event fires when a guess becomes readable, so fetch again when the wait ends.
  useEffect(() => {
    const ms = guessRefetchIn(rows.flatMap((q) => q.targets), Date.now());
    if (ms === null) return;
    const timer = setTimeout(load, ms);
    return () => clearTimeout(timer);
  }, [rows, load]);

  const questions: QuestionItem[] = rows.map((q) => ({
    ...q, targets: q.targets.map((t) => ({ ...t, name: names[t.user_id] ?? 'Roommate' })),
  }));
  return { questions, error, reload: load };
}
