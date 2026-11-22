import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { anthropicModel } from '../packages/core/src/agent/anthropic.ts';
import { keywordFakeModel, type ModelClient, type ModelUsage } from '../packages/core/src/agent/model.ts';
import { answerForTarget, parseQuestion } from '../packages/core/src/agent/pipeline.ts';
import type { AwayBlock, MemberSettings, PresenceEvent, QuestionKind } from '../packages/core/src/types.ts';
import { markdown, summarize, type FixtureResult } from './report.ts';

export interface Fixture {
  name: string; now: string; timezone: string; question: string; householdWide: boolean;
  target: { name: string; settings: MemberSettings; presence: PresenceEvent[]; blocks: AwayBlock[] };
  expect: {
    kind: QuestionKind; aboutTimeWithinMin?: { iso: string; minutes: number };
    decision: 'answer' | 'escalate' | 'unknown'; predictedState?: 'home' | 'away';
    askerTextMustNotContain?: string[]; logPrediction?: boolean;
  };
}

export async function runFixture(model: ModelClient, f: Fixture): Promise<FixtureResult> {
  const usage: ModelUsage[] = [];
  const m: ModelClient = { // parseQuestion doesn't return usage, so record every call here
    async parse(req) { const r = await model.parse(req); usage.push(r.usage); return r; },
    async write(req) { const r = await model.write(req); usage.push(r.usage); return r; },
  };
  const parsed = await parseQuestion(m, f.question, f.now, f.timezone);
  const evidence = { now: f.now, timezone: f.timezone, presence: f.target.presence, blocks: f.target.blocks };
  const r = await answerForTarget(m, { question: f.question, parsed, targetName: f.target.name, settings: f.target.settings, evidence, householdWide: f.householdWide });

  const w = f.expect.aboutTimeWithinMin;
  const parseOk = parsed.kind === f.expect.kind &&
    (!w || (parsed.aboutTime !== null && Math.abs(Date.parse(parsed.aboutTime) - Date.parse(w.iso)) <= w.minutes * 60_000));
  const answered = r.decision.action === 'answer';
  const predictedState = r.claim?.predictedState ?? null;
  const wrongConfident = answered && (f.expect.decision !== 'answer' || (!!f.expect.predictedState && predictedState !== f.expect.predictedState));
  const text = (r.askerText ?? '').toLowerCase();
  return {
    name: f.name, parseOk, decisionOk: r.decision.action === f.expect.decision, wrongConfident,
    leaked: (f.expect.askerTextMustNotContain ?? []).some((s) => text.includes(s.toLowerCase())),
    decision: r.decision.action, predictedState, logPrediction: r.logPrediction, usage,
  };
}

export function loadFixtures(only?: string): Fixture[] {
  const dir = new URL('./fixtures/', import.meta.url);
  return readdirSync(dir).filter((n) => n.endsWith('.json')).sort()
    .map((n) => JSON.parse(readFileSync(new URL(n, dir), 'utf8')) as Fixture)
    .filter((f) => !only || f.name === only);
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string) => args[args.indexOf(k) + 1];
  const fake = args.includes('--fake');
  const modelId = args.includes('--model') ? arg('--model') : 'claude-opus-5-5';
  if (!fake && !process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set. Use --fake for a free plumbing check, or export a key to run billed evals.');
    process.exit(1);
  }
  const model = fake ? keywordFakeModel() : anthropicModel(new Anthropic(), modelId);
  const label = fake ? 'fake' : modelId;
  const fixtures = loadFixtures(args.includes('--only') ? arg('--only') : undefined);
  if (!fixtures.length) { console.error('No fixtures matched.'); process.exit(1); }

  const results: FixtureResult[] = [];
  for (const f of fixtures) {
    const r = await runFixture(model, f);
    results.push(r);
    console.log(`${r.parseOk && r.decisionOk ? 'ok  ' : 'FAIL'} ${f.name} -> ${r.decision}${r.wrongConfident ? ' (WRONG-CONFIDENT)' : ''}${r.leaked ? ' (LEAK)' : ''}`);
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
