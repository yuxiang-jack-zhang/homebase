// `npm run lives -- [--mode ask_me|auto_when_confident|always_auto] [--days 14] [--warmup 7] [--seed 1] [--size 5] [--model <agent>] [--sim-model <id>] [--no-noise]`
// Needs ANTHROPIC_API_KEY. Every LLM call is cached in evals/sim/lives/cache.jsonl, so a rerun with nothing changed is free.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { anthropicModel, DEFAULT_MODEL } from '../../../packages/core/src/agent/anthropic.ts';
import type { AnswerMode } from '../../../packages/core/src/types.ts';
import { MODES } from '../grade.ts';
import { cachedModel, makeLlm } from './llm.ts';
import { runLives, type LivesOptions } from './loop.ts';
import { summarizeLives } from './metrics.ts';
import { livesMarkdown, stories } from './report.ts';

const intFlag = (flag: string, v: string, min: number) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw new Error(`${flag} must be an integer >= ${min}`);
  return n;
};

export function parseLivesArgs(args: string[]): LivesOptions {
  const o: LivesOptions = { days: 14, warmup: 7, seed: 1, size: 5, mode: 'auto_when_confident', noise: true, simModel: 'claude-sonnet-5-5', model: DEFAULT_MODEL };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--no-noise') { o.noise = false; continue; }
    if (!['--days', '--warmup', '--seed', '--size', '--mode', '--model', '--sim-model'].includes(a)) throw new Error(`unknown argument ${a}`);
    const v = args[++i];
    if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
    if (a === '--days') o.days = intFlag(a, v, 1);
    else if (a === '--warmup') o.warmup = intFlag(a, v, 0);
    else if (a === '--seed') o.seed = intFlag(a, v, 1);
    else if (a === '--size') { o.size = intFlag(a, v, 2); if (o.size > 6) throw new Error('--size must be 2-6'); }
    else if (a === '--mode') {
      if (!MODES.includes(v as AnswerMode)) throw new Error(`--mode must be one of ${MODES.join(', ')}`);
      o.mode = v as AnswerMode;
    } else if (a === '--model') o.model = v;
    else o.simModel = v;
  }
  return o;
}

async function main() {
  let opts: LivesOptions;
  try { opts = parseLivesArgs(process.argv.slice(2)); } catch (e) { console.error((e as Error).message); return process.exit(1); }
  if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY is not set.'); return process.exit(1); }
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const cachePath = `${root}evals/sim/lives/cache.jsonl`;
  const client = new Anthropic({ timeout: 120_000, maxRetries: 2 });
  const sim = makeLlm({ client, model: opts.simModel, cachePath });
  const agent = cachedModel(anthropicModel(new Anthropic({ timeout: 20_000, maxRetries: 2 }), opts.model), opts.model, cachePath);

  const result = await runLives(opts, { sim, agent });
  const summary = summarizeLives(result, sim.usage);
  const story = stories(result);
  const date = new Date().toISOString().slice(0, 10);
  mkdirSync(`${root}evals/results`, { recursive: true });
  const file = `${root}evals/results/lives-${date}-${opts.mode}-${opts.model}-seed${opts.seed}${opts.size === 5 ? '' : `-size${opts.size}`}.json`;
  writeFileSync(file, JSON.stringify({ date, summary, stories: story, simCallsMade: sim.calls, ...result }, null, 2) + '\n');
  const md = livesMarkdown(date, summary, story);
  appendFileSync(`${root}docs/progress.md`, md);
  console.log(md, `\nsimulator calls made: ${sim.calls} (the rest replayed from cache)\nwrote ${file}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
