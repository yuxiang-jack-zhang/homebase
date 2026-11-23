import type { ModelClient, ModelUsage } from './model.ts';
import { ANSWER_SYSTEM, DRAFT_SYSTEM, PARSE_SYSTEM } from './prompts.ts';

export type TraceStep = 'parse' | 'answer' | 'draft' | 'other';
export interface TracedCall { step: TraceStep; ok: boolean; usage: ModelUsage }

const STEPS = new Map<string, TraceStep>([[PARSE_SYSTEM, 'parse'], [ANSWER_SYSTEM, 'answer'], [DRAFT_SYSTEM, 'draft']]);

/** Wraps a model so every call is reported to `onCall` with its pipeline step, whether it produced output, and its usage (D62). */
export function tracedModel(m: ModelClient, onCall: (c: TracedCall) => void): ModelClient {
  const step = (system: string) => STEPS.get(system) ?? 'other';
  return {
    async parse(req) {
      const r = await m.parse(req);
      onCall({ step: step(req.system), ok: r.value !== null, usage: r.usage });
      return r;
    },
    async write(req) {
      const r = await m.write(req);
      onCall({ step: step(req.system), ok: r.text !== null, usage: r.usage });
      return r;
    },
  };
}
