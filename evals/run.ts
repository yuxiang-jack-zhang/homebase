import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { anthropicModel, DEFAULT_MODEL } from '../packages/core/src/agent/anthropic.ts';
import { keywordFakeModel, type ModelClient, type ModelUsage } from '../packages/core/src/agent/model.ts';
import { answerForTarget, parseQuestion } from '../packages/core/src/agent/pipeline.ts';
import { tracedModel } from '../packages/core/src/agent/trace.ts';
import type { AwayBlock, MemberSettings, PresenceEvent, QuestionKind } from '../packages/core/src/types.ts';
import { markdown, summarize, type FixtureResult } from './report.ts';

export interface Fixture {
  name: string; now: string; timezone: string; question: string; householdWide: boolean;
  target: { name: string; settings: MemberSettings; presence: PresenceEvent[]; blocks: AwayBlock[] };
  expect: {
    kind: QuestionKind; aboutTimeWithinMin?: { iso: string; minutes: number };
    decision: 'answer' | 'escalate' | 'unknown'; predictedState?: 'home' | 'away';
    askerTextMustNotContain?: string[]; logPrediction?: boolean;
    /** Answers only: each must appear in the asker text (case-insensitive), e.g. the state word or local clock time; "a|b" accepts either wording. */
    askerTextMustContain?: string[];
  };
}

export async function runFixture(model: ModelClient, f: Fixture): Promise<FixtureResult> {
  const usage: ModelUsage[] = [];
  try {
    return await score(model, f, usage);
  } catch (e) { // one failed call must not abort a billed run; record it and move on
    return { name: f.name, parseOk: false, decisionOk: false, wrongConfident: false, leaked: false, decision: 'escalate', predictedState: null, logPrediction: false, usage, error: e instanceof Error ? e.message : String(e) };
  }
}

async function score(model: ModelClient, f: Fixture, usage: ModelUsage[]): Promise<FixtureResult> {
  const m = tracedModel(model, (c) => usage.push(c.usage)); // parseQuestion doesn't return usage
  const parsed = await parseQuestion(m, f.question, f.now, f.timezone);
  const evidence = { now: f.now, timezone: f.timezone, presence: f.target.presence, blocks: f.target.blocks };
  const r = await answerForTarget(m, { question: f.question, parsed, targetName: f.target.name, settings: f.target.settings, evidence, householdWide: f.householdWide });

  const w = f.expect.aboutTimeWithinMin;
  const parseOk = parsed.kind === f.expect.kind &&
    (!w || (parsed.aboutTime !== null && Math.abs(Date.parse(parsed.aboutTime) - Date.parse(w.iso)) <= w.minutes * 60_000));
  const answered = r.decision.action === 'answer';
  const predictedState = r.claim?.predictedState ?? null;
  const text = (r.askerText ?? '').toLowerCase();
  // each entry may list equivalent wordings separated by "|" ("away|isn't home"); one must appear
  const textMismatch = (f.expect.askerTextMustContain ?? []).some((s) => !s.toLowerCase().split('|').some((alt) => text.includes(alt)));
  const wrongConfident = answered && (f.expect.decision !== 'answer' || (!!f.expect.predictedState && predictedState !== f.expect.predictedState) || textMismatch);
  return {
    name: f.name, parseOk, decisionOk: r.decision.action === f.expect.decision, wrongConfident,
    leaked: (f.expect.askerTextMustNotContain ?? []).some((s) => text.includes(s.toLowerCase())),
    decision: r.decision.action, predictedState, logPrediction: r.logPrediction, usage, askerText: r.askerText,
  };
}

/** A fixture passes when parse and decision match and no answer contradicts the expectation. */
export const passed = (r: FixtureResult) => r.parseOk && r.decisionOk && !r.wrongConfident;

export function loadFixtures(only?: string): Fixture[] {
  const dir = new URL('./fixtures/', import.meta.url);
  return readdirSync(dir).filter((n) => n.endsWith('.json')).sort()
    .map((n) => JSON.parse(readFileSync(new URL(n, dir), 'utf8')) as Fixture)
    .filter((f) => !only || f.name === only);
}

export function parseArgs(args: string[]): { fake: boolean; model: string; only: string | undefined } {
  const out = { fake: false, model: DEFAULT_MODEL, only: undefined as string | undefined };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--fake') out.fake = true;
    else if (a === '--model' || a === '--only') {
      const v = args[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      if (a === '--model') out.model = v; else out.only = v;
    } else throw new Error(`unknown argument ${a}`);
  }
  return out;
}

async function main() {
  let opts: ReturnType<typeof parseArgs>;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error((e as Error).message); return process.exit(1); }
  const { fake, model: modelId, only } = opts;
  if (!fake && !process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set. Use --fake for a free plumbing check, or export a key to run billed evals.');
    process.exit(1);
  }
  // --fake writes no text so answers use the template line, which carries the state/time the text checks look for.
  const model = fake ? { ...keywordFakeModel(), write: async () => ({ text: null, usage: { inputTokens: 0, outputTokens: 0, model: 'keyword-fake', latencyMs: 0 } }) } : anthropicModel(new Anthropic(), modelId);
  const label = fake ? 'fake' : modelId;
  const fixtures = loadFixtures(only);
  if (!fixtures.length) { console.error('No fixtures matched.'); process.exit(1); }

  const results: FixtureResult[] = [];
  for (const f of fixtures) {
    const r = await runFixture(model, f);
    results.push(r);
    console.log(`${passed(r) ? 'ok  ' : 'FAIL'} ${f.name} -> ${r.decision}${r.wrongConfident ? ' (WRONG-CONFIDENT)' : ''}${r.leaked ? ' (LEAK)' : ''}${r.error ? ` (ERROR: ${r.error})` : ''}`);
  }
  const summary = summarize(results);
  const date = new Date().toISOString().slice(0, 10);
  const root = fileURLToPath(new URL('../', import.meta.url));
  mkdirSync(`${root}evals/results`, { recursive: true });
  const file = `${root}evals/results/${date}-${label}.json`;
  writeFileSync(file, JSON.stringify({ model: label, date, summary, results }, null, 2) + '\n');
  appendFileSync(`${root}docs/progress.md`, markdown(label, date, summary));
  console.log(JSON.stringify(summary, null, 2), `\nwrote ${file}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
