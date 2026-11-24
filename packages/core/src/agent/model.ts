import type { z } from 'zod';

export interface ModelUsage {
  inputTokens: number; outputTokens: number; model: string; latencyMs: number;
  /** For tracing (D62): the API stop reason, and the error type when the call threw. */
  stopReason?: string | null; error?: string;
}
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

/**
 * Deterministic stand-in for served edge-function tests (ANTHROPIC_FAKE=1). Classifies the fenced question by
 * keyword; at_time questions are about two hours from the real clock (two hours ago for was/were). `write` restates the
 * state and times from the facts it is given, so acceptWriterText keeps it.
 */
export function keywordFakeModel(): ModelClient {
  const usage: ModelUsage = { inputTokens: 0, outputTokens: 0, model: 'keyword-fake', latencyMs: 0 };
  return {
    async parse<T>({ user }: { user: string }) {
      const q = (/<question>\n([\s\S]*)\n<\/question>/.exec(user)?.[1] ?? '').toLowerCase();
      const value =
        /\bwas\b|\bwere\b/.test(q) ? { kind: 'at_time', aboutTime: new Date(Date.now() - 2 * 3_600_000).toISOString() }
        : /\bat\b|tonight|in an hour/.test(q) ? { kind: 'at_time', aboutTime: new Date(Date.now() + 2 * 3_600_000).toISOString() }
        : /\bback\b|\bwhen\b/.test(q) ? { kind: 'until_when', aboutTime: null }
        : /\bhome\b/.test(q) ? { kind: 'now', aboutTime: null }
        : { kind: 'unclear', aboutTime: null };
      return { value: value as T, usage };
    },
    async write({ user }) {
      const fact = (k: string) => new RegExp(`^${k}: (.*)$`, 'm').exec(user)?.[1] ?? 'n/a';
      const [about, until] = [fact('About time'), fact('Predicted time')];
      return { text: `Fake model: ${fact('Predicted state')}${about === 'n/a' ? '' : ` at ${about}`}${until === 'n/a' ? '' : ` until ${until}`}.`, usage };
    },
  };
}
