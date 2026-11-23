// Simulated-roommate eval (spec: docs/superpowers/specs/2026-11-23-sim-evals-design.md).
// `npm run sim` runs code mode for free; `npm run sim -- --llm --model <id>` phrases questions with an LLM and runs the real model.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { anthropicModel, DEFAULT_MODEL } from '../../packages/core/src/agent/anthropic.ts';
import type { ModelClient } from '../../packages/core/src/agent/model.ts';
import { answerForTarget, parseQuestion } from '../../packages/core/src/agent/pipeline.ts';
import { tracedModel, type TracedCall } from '../../packages/core/src/agent/trace.ts';
import { buildClaim } from '../../packages/core/src/confidence.ts';
import type { AnswerMode, Claim, ParsedQuestion } from '../../packages/core/src/types.ts';
import { gradeAllModes, MODES, parseCorrect, type ModeGrade } from './grade.ts';
import { PERSONAS, type PersonaId } from './personas.ts';
import { generateTexts, scheduleQuestions, type IntentKind, type SimQuestion } from './questions.ts';
import { rng } from './random.ts';
import { simMarkdown, summarizeSim } from './report.ts';
import { evidenceAt, geofenceEvents, iso, TIMEZONE } from './world.ts';

export interface SimOptions { days: number; seed: number; perDay: number; mode: AnswerMode; noise: boolean; llm: boolean; model: string; generator: string }
export interface SimRow {
  id: string; persona: PersonaId; kind: IntentKind; text: string; style: string; error?: string;
  intent: { kind: IntentKind; aboutTime: string | null };
  parsed: ParsedQuestion; parseOk: boolean; claim: Claim | null; askerText: string | null;
  grades: Record<AnswerMode, ModeGrade>;
  calls: TracedCall[]; latencyMs: number;
}
export interface SimResult { options: SimOptions; rows: SimRow[] }

const WARMUP_DAYS = 14;

/** Builds the world from the seed, answers every question, grades it. `model: null` = code mode (oracle parse, template text). */
export async function simulate(opts: SimOptions, deps: { model: ModelClient | null; questions?: SimQuestion[]; concurrency?: number }): Promise<SimResult> {
  // Separate streams so, e.g., noise settings don't reshuffle the timelines or the questions.
  const rTimeline = rng(opts.seed), rEvents = rng(opts.seed + 1_000), rQuestions = rng(opts.seed + 2_000);
  const world = new Map(PERSONAS.map((p) => {
    const timeline = p.timeline(rTimeline, -WARMUP_DAYS, opts.days);
    return [p.id, { persona: p, timeline, events: geofenceEvents(timeline, rEvents, opts.noise) }];
  }));
  const questions = deps.questions ?? scheduleQuestions(rQuestions, PERSONAS, opts.days, opts.perDay);

  const answer = async (q: SimQuestion): Promise<SimRow> => {
    const { persona, timeline, events } = world.get(q.targetId)!;
    const now = iso(q.askMs);
    const evidence = { now, timezone: TIMEZONE, presence: evidenceAt(events, q.askMs), blocks: persona.blocks };
    const intent = { kind: q.intent.kind, aboutTime: q.intent.aboutMs === null ? null : iso(q.intent.aboutMs) };
    const calls: TracedCall[] = [];
    let parsed: ParsedQuestion, claim: Claim | null, askerText: string | null = null;
    if (deps.model) {
      const m = tracedModel(deps.model, (c) => calls.push(c));
      parsed = await parseQuestion(m, q.text, now, TIMEZONE);
      const r = await answerForTarget(m, {
        question: q.text, parsed, targetName: persona.name, settings: { visibility: true, answerMode: opts.mode }, evidence, householdWide: false,
      });
      claim = r.claim;
      askerText = r.askerText;
    } else {
      parsed = intent;
      claim = buildClaim(parsed, evidence);
    }
    return {
      id: q.id, persona: q.targetId, kind: q.intent.kind, text: q.text, style: q.style, ...(q.error ? { error: q.error } : {}),
      intent, parsed, parseOk: parseCorrect(parsed, q.intent), claim, askerText,
      grades: gradeAllModes(claim, q, timeline, now),
      calls, latencyMs: calls.reduce((s, c) => s + c.usage.latencyMs, 0),
    };
  };

  const rows: SimRow[] = new Array(questions.length);
  let next = 0;
  const worker = async () => { while (next < questions.length) { const i = next++; rows[i] = await answer(questions[i]); } };
  await Promise.all(Array.from({ length: deps.model ? (deps.concurrency ?? 6) : 1 }, worker));
  return { options: opts, rows };
}

const positiveInt = (flag: string, v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${flag} must be a positive integer`);
  return n;
};

export function parseSimArgs(args: string[]): SimOptions {
  const o: SimOptions = { days: 14, seed: 1, perDay: 3, mode: 'auto_when_confident', noise: true, llm: false, model: DEFAULT_MODEL, generator: 'claude-sonnet-5-5' };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--no-noise') { o.noise = false; continue; }
    if (a === '--llm') { o.llm = true; continue; }
    if (!['--days', '--seed', '--per-day', '--mode', '--model', '--generator'].includes(a)) throw new Error(`unknown argument ${a}`);
    const v = args[++i];
    if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
    if (a === '--days') o.days = positiveInt(a, v);
    else if (a === '--seed') o.seed = positiveInt(a, v);
    else if (a === '--per-day') o.perDay = positiveInt(a, v);
    else if (a === '--mode') {
      if (!MODES.includes(v as AnswerMode)) throw new Error(`--mode must be one of ${MODES.join(', ')}`);
      o.mode = v as AnswerMode;
    } else if (a === '--model') o.model = v;
    else o.generator = v;
  }
  return o;
}

async function main() {
  let opts: SimOptions;
  try { opts = parseSimArgs(process.argv.slice(2)); } catch (e) { console.error((e as Error).message); return process.exit(1); }
  const root = fileURLToPath(new URL('../../', import.meta.url));
  let model: ModelClient | null = null;
  let questions: SimQuestion[] | undefined;
  if (opts.llm) {
    if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY is not set (needed for --llm).'); return process.exit(1); }
    const client = new Anthropic();
    mkdirSync(`${root}evals/sim/cache`, { recursive: true });
    const cachePath = `${root}evals/sim/cache/seed${opts.seed}-days${opts.days}-perday${opts.perDay}.json`;
    const names = Object.fromEntries(PERSONAS.map((p) => [p.id, p.name]));
    questions = await generateTexts(scheduleQuestions(rng(opts.seed + 2_000), PERSONAS, opts.days, opts.perDay), { client, model: opts.generator, cachePath, names });
    const failed = questions.filter((q) => q.error).length;
    if (failed) console.warn(`${failed} question(s) kept template text after generation failed`);
    model = anthropicModel(new Anthropic({ timeout: 20_000, maxRetries: 2 }), opts.model);
  }
  const result = await simulate(opts, { model, questions });
  const label = opts.llm ? opts.model : 'code';
  const date = new Date().toISOString().slice(0, 10);
  const summary = summarizeSim(result);
  mkdirSync(`${root}evals/results`, { recursive: true });
  const file = `${root}evals/results/sim-${date}-${label}-seed${opts.seed}.json`;
  writeFileSync(file, JSON.stringify({ label, date, summary, ...result }, null, 2) + '\n');
  const md = simMarkdown(label, date, summary);
  appendFileSync(`${root}docs/progress.md`, md);
  console.log(md, `\nwrote ${file}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
