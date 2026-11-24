// Day-by-day roommate simulation (spec: docs/superpowers/specs/2026-11-23-llm-roommates-design.md).
// Roommates (simulator LLM) plan their days, ask about each other, reply when the agent routes a question to them, and
// change plans in response. The agent under test runs through the real core pipeline. Answers are graded afterwards
// against what actually happened.
import { z } from 'zod';
import type { ModelClient } from '../../../packages/core/src/agent/model.ts';
import { answerForTarget, parseQuestion } from '../../../packages/core/src/agent/pipeline.ts';
import { tracedModel, type TracedCall } from '../../../packages/core/src/agent/trace.ts';
import type { AnswerMode, Claim, ParsedQuestion } from '../../../packages/core/src/types.ts';
import { claimCorrect, outcome, parseCorrect, type Outcome } from '../grade.ts';
import type { SimQuestion } from '../questions.ts';
import { rng } from '../random.ts';
import { dow, evidenceAt, geofenceEvents, isAway, iso, localMs, TIMEZONE, type Interval } from '../world.ts';
import { applyChange, clipAfter, fmt, hhmm, PlanChangeSchema, PlanSchema, toIntervals, validOutings, type Outing, type Plan } from './day.ts';
import { generateHousehold, normalizePlan, type Roommate } from './household.ts';
import type { Llm } from './llm.ts';
import { memoryPrompt, phrasePrompt, planPrompt, reactPrompt, replyPrompt } from './prompts.ts';

export interface LivesOptions { days: number; warmup: number; seed: number; mode: AnswerMode; noise: boolean; simModel: string; model: string }
export interface QuestionLog {
  day: number; at: string; asker: string; target: string; why: string; text: string;
  intent: { kind: 'now' | 'at_time' | 'until_when'; aboutTime: string | null };
  parsed: ParsedQuestion; parseOk: boolean; claim: Claim | null;
  decision: 'answer' | 'escalate' | 'unknown'; outcome: Outcome;
  askerText: string | null; draft: string | null; replyText: string | null;
  targetChanged: boolean; askerChanged: boolean; agentCalls: TracedCall[];
}
export interface NeedLog { who: string; day: number; at: string; what: string; met: boolean; coveredBy: string[]; byChange: boolean }
export interface DayLog { day: number; plans: Record<string, { morning: Outing[]; final: Outing[] }>; memories: Record<string, string> }
export interface LivesResult { options: LivesOptions; household: Roommate[]; days: DayLog[]; questions: QuestionLog[]; needs: NeedLog[]; errors: string[] }

const PhraseSchema = z.object({ text: z.string(), kind: z.enum(['now', 'at_time', 'until_when']), aboutTime: z.string().nullable() });
const ReplySchema = z.object({ reply: z.enum(['approve', 'yes', 'no', 'not_sure', 'text']), text: z.string().nullable(), change: PlanChangeSchema.nullable() });
const ReactSchema = z.object({ change: PlanChangeSchema.nullable() });
const MemorySchema = z.object({ memory: z.string() });
const REPLY_WORDS = { yes: 'Yes', no: 'No', not_sure: 'Not sure' } as const;
const MEMORY_DAYS = 3;
const EMPTY: Plan = { outings: [], needs: [], questions: [] };

interface Mate { r: Roommate; index: number; past: Interval[]; today: Outing[]; memory: string[]; events: string[]; carryMin: number | null }

const outAt = (outings: Outing[], min: number) => outings.some((x) => hhmm(x.leave) <= min && min < hhmm(x.back));

export async function runLives(opts: LivesOptions, deps: { sim: Llm; agent: ModelClient }): Promise<LivesResult> {
  const { sim } = deps;
  const household = await generateHousehold(sim, opts.seed);
  const names = household.map((r) => r.name);
  const mates: Mate[] = household.map((r, index) => ({ r, index, past: [], today: [], memory: [], events: [], carryMin: null }));
  const byName = new Map(mates.map((m) => [m.r.name, m]));
  const days: DayLog[] = [], questions: QuestionLog[] = [], errors: string[] = [];
  const pendingNeeds: { who: string; day: number; at: string; what: string; morning: Map<string, Interval[]> }[] = [];

  for (let day = 0 - opts.warmup; day < opts.days; day++) { // 0 - n, not -n: avoids -0
    const warmup = day < 0;
    // 1. Morning plans, in parallel (they don't see each other).
    const plans = await Promise.all(mates.map((m) => morningPlan(m, day, warmup)));
    const log: DayLog = { day, plans: {}, memories: {} };
    mates.forEach((m, i) => { m.today = plans[i].outings; m.events = []; });
    const morning = new Map(mates.map((m) => [m.r.name, [...m.past, ...toIntervals(day, m.today)]]));
    for (const m of mates) log.plans[m.r.name] = { morning: m.today, final: m.today };
    const asks = plans.flatMap((p, i) => p.questions.map((q) => ({ ...q, asker: mates[i] })))
      .sort((a, b) => hhmm(a.at) - hhmm(b.at) || a.asker.index - b.asker.index);
    plans.forEach((p, i) => p.needs.forEach((n) => pendingNeeds.push({ who: mates[i].r.name, day, at: n.at, what: n.what, morning })));

    // 2. The day's questions in time order; each can change someone's plans from that moment on.
    for (const a of asks) {
      const q = await ask(a.asker, byName.get(a.about)!, day, a.at, a.why, plans[a.asker.index]);
      if (q) questions.push(q);
    }

    // 3. End of day: what happened becomes history; each roommate writes a short memory.
    await Promise.all(mates.map(async (m) => {
      log.plans[m.r.name].final = m.today;
      m.past.push(...toIntervals(day, m.today));
      const last = m.today.at(-1);
      m.carryMin = last && hhmm(last.back) > 1440 ? hhmm(last.back) - 1440 : null;
      const mem = await sim.call({ name: 'memory', ...memoryPrompt({ me: m.r, outings: m.today, events: m.events }), schema: MemorySchema });
      if (mem) { m.memory = [...m.memory, mem.memory].slice(-MEMORY_DAYS); log.memories[m.r.name] = mem.memory; }
    }));
    days.push(log);
  }

  // Grade against the final timelines (after every plan change).
  for (const q of questions) {
    const t = byName.get(q.target)!;
    const sq = { askMs: localMs(q.day, hhmm(q.at)), intent: { kind: q.intent.kind, aboutMs: q.intent.aboutTime ? Date.parse(q.intent.aboutTime) : null } } as SimQuestion;
    q.outcome = outcome(q.decision === 'answer' ? { action: 'answer', caveat: /not sure/i.test(q.askerText ?? '') } : { action: q.decision }, claimCorrect(q.claim, sq, t.past));
  }
  const needs: NeedLog[] = pendingNeeds.map(({ morning, ...n }) => {
    const ms = localMs(n.day, hhmm(n.at));
    const coveredBy = mates.filter((m) => !isAway(m.past, ms)).map((m) => m.r.name);
    const coveredInMorningPlans = [...morning.values()].some((tl) => !isAway(tl, ms));
    return { ...n, met: coveredBy.length > 0, coveredBy, byChange: coveredBy.length > 0 && !coveredInMorningPlans };
  });
  return { options: opts, household, days, questions, needs, errors };

  async function morningPlan(m: Mate, day: number, warmup: boolean): Promise<Plan> {
    const earliest = m.carryMin === null ? '05:00' : fmt(Math.max(5 * 60, m.carryMin + 15));
    const base = planPrompt({ me: m.r, housemates: names.filter((n) => n !== m.r.name), dow: dow(day), memory: m.memory, promises: [], earliest, warmup });
    let plan = await sim.call({ name: 'plan', ...base, schema: PlanSchema });
    let why = plan ? validOutings(plan.outings) : 'no usable plan';
    if (why) {
      plan = await sim.call({ name: 'plan-retry', system: base.system, user: `${base.user}\nYour last plan was invalid (${why}). Fix it.`, schema: PlanSchema });
      why = plan ? validOutings(plan.outings) : 'no usable plan';
    }
    if (!plan || why) {
      errors.push(`day ${day} ${m.r.name}: plan invalid twice (${why}); staying home`);
      plan = EMPTY;
    }
    const outings = m.carryMin === null ? plan.outings : clipAfter(plan.outings, m.carryMin);
    if (warmup) return { ...EMPTY, outings };
    const n = normalizePlan({ ...plan, outings }, m.r.name, names);
    if (n.dropped) errors.push(`day ${day} ${m.r.name}: dropped ${n.dropped} question(s) about unknown people or themselves`);
    return n.plan;
  }

  async function ask(asker: Mate, target: Mate, day: number, at: string, why: string, askerPlan: Plan): Promise<QuestionLog | null> {
    const nowMin = hhmm(at), nowMs = localMs(day, nowMin), now = iso(nowMs);
    const phrased = await sim.call({ name: 'phrase', ...phrasePrompt({ me: asker.r, target: target.r.name, now: at, dow: dow(day), why }), schema: PhraseSchema });
    let aboutMs: number | null = null;
    try { if (phrased?.kind === 'at_time') aboutMs = localMs(day, hhmm(phrased.aboutTime ?? '')); } catch { /* handled below */ }
    if (!phrased || (phrased.kind === 'at_time' && aboutMs === null)) {
      errors.push(`day ${day} ${at} ${asker.r.name}->${target.r.name}: question phrasing unusable`);
      return null;
    }

    // What the app knows: the target's geofence events so far (noise per roommate, stable for the past) and declared blocks.
    const timeline = [...target.past, ...toIntervals(day, target.today)];
    const presence = evidenceAt(geofenceEvents(timeline, rng(opts.seed * 100 + target.index), opts.noise), nowMs);
    const agentCalls: TracedCall[] = [];
    const m = tracedModel(deps.agent, (c) => agentCalls.push(c));
    const parsed = await parseQuestion(m, phrased.text, now, TIMEZONE);
    const r = await answerForTarget(m, {
      question: phrased.text, parsed, targetName: target.r.name, settings: { visibility: true, answerMode: opts.mode },
      evidence: { now, timezone: TIMEZONE, presence, blocks: target.r.blocks }, householdWide: false,
    });

    let answer: string, replyText: string | null = null, targetChanged = false;
    if (r.decision.action === 'escalate') {
      const rep = await sim.call({
        name: 'reply',
        ...replyPrompt({ me: target.r, asker: asker.r.name, question: phrased.text, draft: r.draftText, now: at, myOutings: target.today, outNow: outAt(target.today, nowMin), memory: target.memory }),
        schema: ReplySchema,
      });
      if (rep) {
        replyText = rep.reply === 'approve' ? (r.draftText ?? 'ok') : rep.reply === 'text' ? (rep.text ?? '') : REPLY_WORDS[rep.reply];
        if (rep.change) targetChanged = change(target, rep.change, nowMin);
        target.events.push(`${asker.r.name} asked "${phrased.text}" at ${at}; you replied "${replyText}"${targetChanged ? ' and changed your plans' : ''}.`);
      }
      answer = replyText ?? r.fallbackGuess ?? `No reply from ${target.r.name} yet.`;
    } else {
      answer = r.decision.action === 'answer' ? r.askerText! : `${target.r.name}: unknown`;
    }

    // The asker reads the answer and may change their own plans (e.g. stay in for the plumber).
    const need = askerPlan.needs.find((n) => hhmm(n.at) >= nowMin && hhmm(n.at) - nowMin <= 90);
    const react = await sim.call({
      name: 'react',
      ...reactPrompt({ me: asker.r, target: target.r.name, question: phrased.text, answer, now: at, myOutings: asker.today, need: need ? `${need.what} at ${need.at}` : null, memory: asker.memory }),
      schema: ReactSchema,
    });
    const askerChanged = react?.change ? change(asker, react.change, nowMin) : false;
    if (askerChanged) asker.events.push(`After asking about ${target.r.name} at ${at}, you changed your plans.`);

    return {
      day, at, asker: asker.r.name, target: target.r.name, why, text: phrased.text,
      intent: { kind: phrased.kind, aboutTime: aboutMs === null ? null : iso(aboutMs) },
      parsed, parseOk: parseCorrect(parsed, { kind: phrased.kind, aboutMs }), claim: r.claim,
      decision: r.decision.action, outcome: 'unknown', // graded after the run, against what actually happened
      askerText: r.askerText, draft: r.draftText, replyText, targetChanged, askerChanged, agentCalls,
    };
  }

  function change(m: Mate, c: z.infer<typeof PlanChangeSchema>, nowMin: number): boolean {
    const before = JSON.stringify(m.today);
    m.today = applyChange(m.today, c, nowMin);
    return JSON.stringify(m.today) !== before;
  }
}
