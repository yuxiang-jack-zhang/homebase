import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import type Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import type { ModelClient, ModelUsage } from '../../../packages/core/src/agent/model.ts';

export interface LlmRequest<T> { name: string; system: string; user: string; schema: z.ZodType<T> }
export interface Llm {
  call<T>(req: LlmRequest<T>): Promise<T | null>;
  /** Usage of every call made or replayed (replays report the original usage, so a replayed run costs the same on paper). */
  usage: ModelUsage[];
  /** Calls that actually reached a model. */
  calls: number;
}

type Entry = { key: string; value: unknown; usage: ModelUsage | null };

/** Append-only JSONL cache shared by the simulator and the agent (spec: every LLM call is cached by its exact input). */
function jsonlCache(path: string) {
  const map = new Map<string, Entry>();
  if (existsSync(path)) {
    for (const line of readFileSync(path, 'utf8').split('\n')) if (line.trim()) { const e = JSON.parse(line) as Entry; map.set(e.key, e); }
  }
  return {
    get: (key: string) => map.get(key),
    set: (e: Entry) => { map.set(e.key, e); appendFileSync(path, JSON.stringify(e) + '\n'); },
  };
}

const keyOf = (...parts: string[]) => createHash('sha256').update(parts.join('\u0000')).digest('hex');

/** Structured-output calls (Zod) to a simulator model, cached. Invalid output or an API error is retried once, then null. */
export function makeLlm(opts: { client: Anthropic; model: string; cachePath: string }): Llm {
  const cache = jsonlCache(opts.cachePath);
  const llm: Llm = {
    usage: [], calls: 0,
    async call<T>(req: LlmRequest<T>): Promise<T | null> {
      for (const attempt of [1, 2]) {
        const key = keyOf(opts.model, req.name, req.system, req.user, String(attempt));
        let hit = cache.get(key);
        if (!hit) {
          const t0 = Date.now();
          try {
            llm.calls++;
            const r = await opts.client.beta.messages.parse({
              model: opts.model, max_tokens: 8192, system: req.system,
              messages: [{ role: 'user', content: req.user }],
              output_config: { format: betaZodOutputFormat(req.schema) },
            });
            hit = {
              key, value: r.stop_reason === 'end_turn' ? (r.parsed_output ?? null) : null,
              usage: { model: r.model, inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens, latencyMs: Date.now() - t0, stopReason: r.stop_reason },
            };
            cache.set(hit);
          } catch (e) {
            console.warn(`sim llm ${req.name} failed: ${(e as Error).message}`); // transient: not cached
            continue;
          }
        }
        if (hit.usage) llm.usage.push(hit.usage);
        const ok = req.schema.safeParse(hit.value);
        if (ok.success) return ok.data;
      }
      return null;
    },
  };
  return llm;
}

/** Test double: answers from `handler(name, user)`, validated like the real one. */
export function scriptedLlm(handler: (name: string, user: string) => unknown): Llm {
  const llm: Llm = {
    usage: [], calls: 0,
    async call<T>(req: LlmRequest<T>) {
      llm.calls++;
      const ok = req.schema.safeParse(handler(req.name, req.user));
      return ok.success ? ok.data : null;
    },
  };
  return llm;
}

/** The agent under test, cached the same way so a replayed run makes no calls. */
export function cachedModel(model: ModelClient, modelId: string, cachePath: string): ModelClient {
  const cache = jsonlCache(cachePath);
  const once = async <R extends { usage: ModelUsage }>(kind: string, system: string, user: string, run: () => Promise<R>): Promise<R> => {
    const key = keyOf('agent', modelId, kind, system, user);
    const hit = cache.get(key);
    if (hit) return hit.value as R;
    const r = await run();
    cache.set({ key, value: r, usage: r.usage });
    return r;
  };
  return {
    parse: (req) => once('parse', req.system, req.user, () => model.parse(req)),
    write: (req) => once('write', req.system, req.user, () => model.write(req)),
  };
}
