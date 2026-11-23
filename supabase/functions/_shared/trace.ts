import type { SupabaseClient } from '@supabase/supabase-js';
import { CORE_VERSION, type TracedCall } from '../../../packages/core/src/index.ts';
import type { Database } from '../../../packages/core/src/db.types.ts';

export type TraceCall = TracedCall & { targetUserId: string | null };

/** Writes one ask run and its model calls (D62). Never throws: a lost trace must not fail the request. */
export async function saveTrace(
  admin: SupabaseClient<Database>,
  run: { questionId: string | null; ok: boolean; latencyMs: number; calls: TraceCall[] },
) {
  try {
    const { data, error } = await admin.from('agent_runs')
      .insert({ question_id: run.questionId, ok: run.ok, latency_ms: run.latencyMs, core_version: CORE_VERSION })
      .select('id').single();
    if (error) throw error;
    if (run.calls.length === 0) return;
    const { error: e2 } = await admin.from('agent_calls').insert(run.calls.map((c) => ({
      run_id: data.id, target_user_id: c.targetUserId, step: c.step, model: c.usage.model, ok: c.ok,
      stop_reason: c.usage.stopReason ?? null, error: c.usage.error ?? null,
      input_tokens: c.usage.inputTokens, output_tokens: c.usage.outputTokens, latency_ms: Math.round(c.usage.latencyMs),
    })));
    if (e2) throw e2;
  } catch (e) {
    console.error('trace write failed', { message: (e as Error)?.message });
  }
}
