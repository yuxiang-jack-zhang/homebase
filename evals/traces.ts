// Summarizes stored ask traces (D62): `npm run traces -- [--days 7]`. Read-only.
// Needs SUPABASE_URL and a service key (SUPABASE_SECRET_KEY, sb_secret_…, for hosted; the local service-role key works locally).
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import type { ModelUsage } from '../packages/core/src/agent/model.ts';
import { cost } from './report.ts';

export interface TraceCallRow { step: string; model: string; ok: boolean; stop_reason: string | null; error: string | null; input_tokens: number; output_tokens: number; latency_ms: number }
export interface TraceRunRow { ok: boolean; latency_ms: number; agent_calls: TraceCallRow[] }

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.max(0, Math.ceil(p * s.length) - 1)] : 0; // nearest rank, as in report.ts
};
const usageOf = (c: TraceCallRow): ModelUsage => ({ model: c.model, inputTokens: c.input_tokens, outputTokens: c.output_tokens, latencyMs: c.latency_ms });
/** Why a call produced no output: the error type, else a non-normal stop reason, else "empty". */
const failure = (c: TraceCallRow) => c.error ?? (c.stop_reason && c.stop_reason !== 'end_turn' ? c.stop_reason : 'empty');

export function summarizeTraces(runs: TraceRunRow[]) {
  const calls = runs.flatMap((r) => r.agent_calls);
  const group = (key: (c: TraceCallRow) => string) => {
    const m = new Map<string, TraceCallRow[]>();
    for (const c of calls) m.set(key(c), [...(m.get(key(c)) ?? []), c]);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  };
  const total = cost(calls.map(usageOf));
  return {
    runs: runs.length,
    failedRuns: runs.filter((r) => !r.ok).length,
    p50RunMs: pct(runs.map((r) => r.latency_ms), 0.5),
    p95RunMs: pct(runs.map((r) => r.latency_ms), 0.95),
    usd: total.usd,
    unpricedCalls: total.unpriced,
    steps: group((c) => c.step).map(([step, cs]) => ({
      step, calls: cs.length, failed: cs.filter((c) => !c.ok).length,
      p50Ms: pct(cs.map((c) => c.latency_ms), 0.5), p95Ms: pct(cs.map((c) => c.latency_ms), 0.95),
      inputTokens: cs.reduce((a, c) => a + c.input_tokens, 0), outputTokens: cs.reduce((a, c) => a + c.output_tokens, 0),
      usd: cost(cs.map(usageOf)).usd,
    })),
    models: group((c) => c.model).map(([model, cs]) => ({ model, calls: cs.length })),
    failures: group((c) => (c.ok ? '' : failure(c))).filter(([k]) => k).map(([reason, cs]) => ({ reason, calls: cs.length })),
  };
}

export function tracesMarkdown(days: number, s: ReturnType<typeof summarizeTraces>): string {
  const usd = (x: number) => `$${x.toFixed(4)}`;
  return [
    `### Ask traces, last ${days} day(s)\n`,
    `${s.runs} runs (${s.failedRuns} failed) · run latency p50 ${s.p50RunMs} ms, p95 ${s.p95RunMs} ms · cost ${usd(s.usd)}` +
      `${s.runs ? ` (${usd(s.usd / s.runs)}/run)` : ''}${s.unpricedCalls ? ` + ${s.unpricedCalls} unpriced calls` : ''}\n`,
    '| step | calls | no output | p50 ms | p95 ms | tokens in | tokens out | cost |',
    '|---|---|---|---|---|---|---|---|',
    ...s.steps.map((r) => `| ${r.step} | ${r.calls} | ${r.failed} | ${r.p50Ms} | ${r.p95Ms} | ${r.inputTokens} | ${r.outputTokens} | ${usd(r.usd)} |`),
    '',
    `Models: ${s.models.map((m) => `${m.model} (${m.calls})`).join(', ') || 'none'}`,
    `No-output reasons: ${s.failures.map((f) => `${f.reason} (${f.calls})`).join(', ') || 'none'}`,
    '',
  ].join('\n');
}

async function main() {
  const i = process.argv.indexOf('--days');
  const days = i > 0 ? Number(process.argv[i + 1]) : 7;
  if (!Number.isFinite(days) || days <= 0) throw new Error('--days must be a positive number');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY)');
  const db = createClient(url, key, { auth: { persistSession: false } });
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  // shortcut: one request, capped at 1000 runs; page through if traffic grows past that.
  const { data, error } = await db.from('agent_runs')
    .select('ok, latency_ms, agent_calls(step, model, ok, stop_reason, error, input_tokens, output_tokens, latency_ms)')
    .gte('created_at', since).order('created_at', { ascending: false }).limit(1000);
  if (error) throw new Error(error.message);
  console.log(tracesMarkdown(days, summarizeTraces(data as TraceRunRow[])));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error((e as Error).message); process.exit(1); });
}
