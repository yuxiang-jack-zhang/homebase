import { z } from 'zod';
import type { AwayBlock } from '../../../packages/core/src/types.ts';
import { fmt, hhmm, type Plan } from './day.ts';
import type { Llm } from './llm.ts';
import { householdPrompt } from './prompts.ts';

export interface Roommate { name: string; age: number; job: string; routine: string; habits: string; social: string; blocks: AwayBlock[] }

export const HouseholdSchema = z.object({
  roommates: z.array(z.object({
    name: z.string(), age: z.number(), job: z.string(), routine: z.string(), habits: z.string(), social: z.string(),
    // What they'd type into the app: often partial or out of date.
    blocks: z.array(z.object({ days: z.array(z.number()), start: z.string(), end: z.string(), label: z.string().optional() })),
  })),
});

const blockTime = (s: string) => { const m = hhmm(s); if (m >= 24 * 60) throw new Error(s); return m; };

/** `size` LLM-invented roommates (the seed is in the prompt, so seed 2 is a different household). Throws if unusable. */
export async function generateHousehold(llm: Llm, seed: number, size = 5): Promise<Roommate[]> {
  const r = await llm.call({ name: 'household', ...householdPrompt(seed, size), schema: HouseholdSchema });
  if (!r) throw new Error('household generation failed');
  if (r.roommates.length !== size) throw new Error(`expected ${size} roommates, got ${r.roommates.length}`);
  if (new Set(r.roommates.map((m) => m.name.toLowerCase())).size !== size) throw new Error('roommate names must be unique');
  return r.roommates.map((m) => ({
    ...m,
    blocks: m.blocks.map((b) => {
      try {
        if (blockTime(b.start) === blockTime(b.end) || !b.days.length || b.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw new Error();
      } catch { throw new Error(`bad block for ${m.name}: ${JSON.stringify(b)}`); }
      return { daysOfWeek: b.days, startLocal: b.start, endLocal: b.end, ...(b.label ? { label: b.label } : {}) };
    }),
  }));
}

/**
 * Cleans a morning plan's questions: canonical names, none about unknown people or yourself, valid times; every need
 * gets a question in the hour before it (30 min before, to the first other roommate alphabetically, if the plan had none).
 */
export function normalizePlan(plan: Plan, me: string, names: string[]): { plan: Plan; dropped: number } {
  const canon = new Map(names.map((n) => [n.toLowerCase(), n]));
  const valid = (t: string) => { try { hhmm(t); return true; } catch { return false; } };
  const questions = plan.questions
    .map((q) => ({ ...q, about: canon.get(q.about.trim().toLowerCase()) ?? '' }))
    .filter((q) => q.about && q.about !== me && valid(q.at));
  const dropped = plan.questions.length - questions.length;
  const needs = plan.needs.filter((n) => valid(n.at));
  const firstOther = [...names].sort().find((n) => n !== me)!;
  for (const n of needs) {
    const at = hhmm(n.at);
    if (!questions.some((q) => hhmm(q.at) >= at - 60 && hhmm(q.at) <= at)) questions.push({ at: fmt(Math.max(0, at - 30)), about: firstOther, why: n.what });
  }
  questions.sort((a, b) => hhmm(a.at) - hhmm(b.at));
  return { plan: { ...plan, needs, questions }, dropped };
}
