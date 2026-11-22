import type Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { ModelClient, ModelUsage } from './model.ts';

// 4096, not 1024: Opus 5.5 always thinks and thinking counts toward max_tokens (D32).
const MAX_TOKENS = 4096;

interface Res { model: string; stop_reason: string | null; usage: { input_tokens: number; output_tokens: number } }

export function anthropicModel(client: Anthropic, model = 'claude-opus-5-5'): ModelClient {
  const base = (system: string, user: string) => ({
    model, max_tokens: MAX_TOKENS,
    betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const,
    // Static system prompt first with a cache marker; the volatile part is the user message.
    system: [{ type: 'text' as const, text: system, cache_control: { type: 'ephemeral' as const } }],
    messages: [{ role: 'user' as const, content: user }],
  });
  const usageOf = (r: Res | null, t0: number): ModelUsage => ({
    inputTokens: r?.usage.input_tokens ?? 0, outputTokens: r?.usage.output_tokens ?? 0,
    model: r?.model ?? model, latencyMs: Date.now() - t0,
  });
  // Refusal (whole fallback chain declined) or truncated output is unusable.
  const usable = (r: Res) => r.stop_reason !== 'refusal' && r.stop_reason !== 'max_tokens';
  // Status, error type and message only: the prompt and question text must never reach the logs.
  const logError = (call: string, e: unknown) => {
    const x = e as { status?: number; name?: string; message?: string; error?: { error?: { type?: string } } };
    console.error(`anthropic ${call} failed`, { status: x?.status, type: x?.error?.error?.type ?? x?.name, message: x?.message });
  };

  return {
    async parse({ system, user, schema }) {
      const t0 = Date.now();
      try {
        const r = await client.beta.messages.parse({
          ...base(system, user),
          output_config: { effort: 'low', format: betaZodOutputFormat(schema) },
        });
        return { value: usable(r) ? (r.parsed_output ?? null) : null, usage: usageOf(r, t0) };
      } catch (e) {
        logError('parse', e);
        return { value: null, usage: usageOf(null, t0) };
      }
    },
    async write({ system, user }) {
      const t0 = Date.now();
      try {
        const r = await client.beta.messages.create({ ...base(system, user), output_config: { effort: 'low' } });
        const text = r.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim();
        return { text: usable(r) && text ? text : null, usage: usageOf(r, t0) };
      } catch (e) {
        logError('write', e);
        return { text: null, usage: usageOf(null, t0) };
      }
    },
  };
}
