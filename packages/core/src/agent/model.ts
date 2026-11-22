import type { z } from 'zod';

export interface ModelUsage { inputTokens: number; outputTokens: number; model: string; latencyMs: number }
export interface ModelClient {
  parse<T>(req: { system: string; user: string; schema: z.ZodType<T> }): Promise<{ value: T | null; usage: ModelUsage }>;
  write(req: { system: string; user: string }): Promise<{ text: string | null; usage: ModelUsage }>;
}

/** Test double: returns the scripted values unvalidated (so tests can feed off-schema output) and records every call. */
export function fakeModel(script: { parse?: unknown; write?: string | null }) {
  const calls: { method: 'parse' | 'write'; system: string; user: string }[] = [];
  const usage: ModelUsage = { inputTokens: 1, outputTokens: 1, model: 'fake', latencyMs: 0 };
  const client: ModelClient = {
    async parse<T>({ system, user }: { system: string; user: string }) {
      calls.push({ method: 'parse', system, user });
      return { value: (script.parse ?? null) as T | null, usage };
    },
    async write({ system, user }) {
      calls.push({ method: 'write', system, user });
      return { text: script.write ?? null, usage };
    },
  };
  return Object.assign(client, { calls });
}
