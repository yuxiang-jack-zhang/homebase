import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type Anthropic from '@anthropic-ai/sdk';
import type { Persona, PersonaId } from './personas.ts';
import { chance, pick, uniform } from './random.ts';
import { dayOf, dow, localMs, minuteOf } from './world.ts';

export type IntentKind = 'now' | 'at_time' | 'until_when';
export interface SimQuestion {
  id: string; day: number; askMs: number; askerId: PersonaId; targetId: PersonaId;
  /** What the asker means; the answer key for parsing. `aboutMs` only for at_time. */
  intent: { kind: IntentKind; aboutMs: number | null };
  text: string; style: string; error?: string;
}

const MIN = 60_000;
const QUARTER = 15 * MIN;

/** perDay questions about each roommate on each of days [0, days), from a random housemate, in time order. */
export function scheduleQuestions(r: () => number, personas: Persona[], days: number, perDay: number): SimQuestion[] {
  const names = Object.fromEntries(personas.map((p) => [p.id, p.name]));
  const out: SimQuestion[] = [];
  for (let day = 0; day < days; day++) {
    for (const target of personas) {
      for (let i = 0; i < perDay; i++) {
        const askMs = localMs(day, Math.floor(uniform(r, 7 * 60, 23 * 60 + 30)));
        const asker = pick(r, personas.filter((p) => p.id !== target.id));
        const roll = r();
        const kind: IntentKind = roll < 0.4 ? 'now' : roll < 0.8 ? 'at_time' : 'until_when';
        let aboutMs: number | null = null;
        if (kind === 'at_time') {
          const off = chance(r, 0.1) ? -uniform(r, 60, 180) * MIN : uniform(r, 30, 720) * MIN;
          aboutMs = Math.round((askMs + off) / QUARTER) * QUARTER; // people ask "at 7:30", not "at 7:23"
        }
        const q: SimQuestion = { id: `d${day}-${target.id}-${i}`, day, askMs, askerId: asker.id, targetId: target.id, intent: { kind, aboutMs }, text: '', style: 'template' };
        out.push({ ...q, text: templateText(q, names) });
      }
    }
  }
  return out.sort((a, b) => a.askMs - b.askMs);
}

/** "7:30pm", "9am" for a simulated local instant. */
function clock12(ms: number): string {
  const m = minuteOf(ms);
  const h = Math.floor(m / 60), mm = m % 60;
  return `${h % 12 === 0 ? 12 : h % 12}${mm ? `:${String(mm).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
}

export function templateText(q: SimQuestion, names: Record<string, string>): string {
  const n = names[q.targetId];
  if (q.intent.kind === 'now') return `is ${n} home?`;
  if (q.intent.kind === 'until_when') return `when is ${n} back?`;
  const about = q.intent.aboutMs!;
  if (about < q.askMs) return `was ${n} home at ${clock12(about)}?`;
  return `will ${n} be home at ${clock12(about)}${dayOf(about) > dayOf(q.askMs) ? ' tomorrow' : ''}?`;
}

const STYLES = [
  'terse, all lowercase',
  'casual slang',
  'one small typo',
  'mentions a reason, like a delivery, a guest or a plan, that happens at that time',
  'uses a relative time ("in an hour", "tonight", "after lunch") instead of a clock time when that is natural',
  'polite and complete',
];

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const when = (ms: number, askMs: number) => {
  const d = dayOf(ms) - dayOf(askMs);
  return `${clock12(ms)}${d === 0 ? ' today' : d === 1 ? ' tomorrow' : d === -1 ? ' yesterday' : ''}`;
};

const SYSTEM = `You write one text message that a roommate sends in a group chat or DM asking about another roommate's whereabouts.
Write only the message itself, as a real person would type it on their phone: no quotes, no explanation.
The message must clearly ask exactly what you are told it asks, so a careful reader could tell the kind of question and, if a time is involved, which time.`;

function prompt(q: SimQuestion, names: Record<string, string>, style: string): string {
  const target = names[q.targetId];
  const ask = q.intent.kind === 'now' ? `whether ${target} is home right now`
    : q.intent.kind === 'until_when' ? `when ${target} will be back home`
    : q.intent.aboutMs! < q.askMs ? `whether ${target} was home at ${when(q.intent.aboutMs!, q.askMs)}`
    : `whether ${target} will be home at ${when(q.intent.aboutMs!, q.askMs)}`;
  return `You are ${names[q.askerId]}. It is ${DAYS[dow(q.day)]} ${clock12(q.askMs)}.
Ask ${ask}. You may address ${target} directly ("you") or ask about them by name.
Style: ${style}.`;
}

/**
 * Phrases each question with an LLM (B in the spec), caching by question id so every model under test sees the same text.
 * Failed or empty generations keep the template text, are marked with `error`, and are not cached.
 */
export async function generateTexts(
  qs: SimQuestion[],
  opts: { client: Anthropic; model: string; cachePath: string; names: Record<string, string>; concurrency?: number },
): Promise<SimQuestion[]> {
  const cache: Record<string, { text: string; style: string }> = existsSync(opts.cachePath) ? JSON.parse(readFileSync(opts.cachePath, 'utf8')) : {};
  const out = qs.map((q) => (cache[q.id] ? { ...q, ...cache[q.id] } : { ...q }));
  const todo = out.filter((q) => !cache[q.id]);
  const save = () => writeFileSync(opts.cachePath, JSON.stringify(cache, null, 2) + '\n');
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const q = todo[next++];
      const style = STYLES[hash(q.id) % STYLES.length];
      try {
        const res = await opts.client.messages.create({
          model: opts.model, max_tokens: 1024, system: SYSTEM, // the generator may think first; 200 left some replies empty
          messages: [{ role: 'user', content: prompt(q, opts.names, style) }],
        });
        const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim();
        if (!text) { q.error = 'empty'; continue; }
        if (text.split(/\s+/).length < 3) { q.error = 'too_short'; continue; } // e.g. just "hey Eli": not a question
        Object.assign(q, { text, style });
        cache[q.id] = { text, style };
      } catch (e) {
        q.error = (e as Error).message;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 8, todo.length) }, worker));
  if (todo.length) save();
  return out;
}

/** Stable small hash so a question's style doesn't depend on run order. */
function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}
