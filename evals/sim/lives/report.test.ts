import { describe, expect, it } from 'vitest';
import type { LivesResult, NeedLog, QuestionLog } from './loop.ts';
import { livesMarkdown, stories } from './report.ts';
import { parseLivesArgs } from './run.ts';
import { summarizeLives } from './metrics.ts';

const q = (o: Partial<QuestionLog>): QuestionLog => ({
  day: 0, at: '10:00', asker: 'Ana', target: 'Bo', why: 'w', text: 'u home?', intent: { kind: 'now', aboutTime: null },
  parsed: { kind: 'now', aboutTime: null }, parseOk: true, claim: null, decision: 'answer', outcome: 'answered_correct',
  askerText: 'Bo is home.', draft: null, replyText: null, targetChanged: false, askerChanged: false, agentCalls: [], ...o,
});
const need = (o: Partial<NeedLog>): NeedLog => ({ who: 'Ana', day: 0, at: '15:00', what: 'plumber', met: true, coveredBy: ['Bo'], byChange: false, ...o });
const result = {
  options: { days: 1, warmup: 7, seed: 1, size: 5, mode: 'ask_me', noise: true, simModel: 'claude-sonnet-5-5', model: 'claude-haiku-5-5' },
  household: Array(5).fill(null), days: [], errors: [],
  questions: [
    q({}),
    q({ at: '14:15', decision: 'escalate', outcome: 'escalated', askerText: null, draft: 'Bo will be away.', replyText: 'I can be back by 2:45', targetChanged: true }),
    q({ day: 0, at: '16:00', asker: 'Cy', target: 'Di', outcome: 'answered_wrong_confident', askerText: 'Di is home.' }),
  ],
  needs: [need({ byChange: true }), need({ who: 'Cy', at: '18:00', what: 'guest', met: false, coveredBy: [] })],
} as unknown as LivesResult;

describe('parseLivesArgs', () => {
  it('defaults and flags', () => {
    expect(parseLivesArgs([])).toEqual({ days: 14, warmup: 7, seed: 1, size: 5, mode: 'auto_when_confident', noise: true, simModel: 'claude-sonnet-5-5', model: 'claude-haiku-5-5' });
    expect(parseLivesArgs(['--size', '2']).size).toBe(2);
    expect(() => parseLivesArgs(['--size', '1'])).toThrow(/size/);
    expect(parseLivesArgs(['--days', '3', '--warmup', '0', '--mode', 'ask_me', '--sim-model', 's', '--model', 'm', '--no-noise', '--seed', '4']))
      .toEqual({ days: 3, warmup: 0, seed: 4, size: 5, mode: 'ask_me', noise: false, simModel: 's', model: 'm' });
    expect(() => parseLivesArgs(['--mode', 'x'])).toThrow(/mode/);
    expect(() => parseLivesArgs(['--bogus'])).toThrow(/unknown/);
  });
});

describe('stories', () => {
  it('picks a commitment, a missed need and a confident error, in that order, deterministically', () => {
    const s = stories(result);
    expect(s).toHaveLength(3);
    expect(s[0]).toContain('I can be back by 2:45');
    expect(s[0]).toContain('changed plans');
    expect(s[1]).toMatch(/missed.*guest/i);
    expect(s[2]).toContain('Di is home.');
    expect(stories(result)).toEqual(s);
  });
});

describe('livesMarkdown', () => {
  it('has the summary row and the stories', () => {
    const md = livesMarkdown('2026-11-23', summarizeLives(result), stories(result));
    expect(md).toContain('| ask_me | claude-haiku-5-5 | 3 | 1/2 (50%) | 1 | 0.20 | 1 |');
    expect(md).toContain('I can be back by 2:45');
  });
});
