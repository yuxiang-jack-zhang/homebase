import { describe, expect, it } from 'vitest';
import type { Outcome } from '../grade.ts';
import type { LivesResult, NeedLog, QuestionLog } from './loop.ts';
import { summarizeLives } from './metrics.ts';

const q = (o: Partial<QuestionLog>): QuestionLog => ({
  day: 0, at: '10:00', asker: 'A', target: 'B', why: '', text: '', intent: { kind: 'now', aboutTime: null },
  parsed: { kind: 'now', aboutTime: null }, parseOk: true, claim: null, decision: 'answer', outcome: 'answered_correct' as Outcome,
  askerText: null, draft: null, replyText: null, targetChanged: false, askerChanged: false,
  agentCalls: [{ step: 'parse', ok: true, usage: { model: 'claude-haiku-5-5', inputTokens: 1_000_000, outputTokens: 0, latencyMs: 1000 } }], ...o,
});
const need = (met: boolean, byChange = false): NeedLog => ({ who: 'A', day: 0, at: '15:00', what: 'x', met, coveredBy: met ? ['B'] : [], byChange });

const result = {
  options: { days: 2, warmup: 0, seed: 1, size: 5, mode: 'ask_me', noise: true, simModel: 's', model: 'claude-haiku-5-5' },
  household: Array(5).fill(null), days: [], errors: ['e1'],
  questions: [
    q({}),
    q({ decision: 'escalate', outcome: 'escalated', targetChanged: true }),
    q({ decision: 'escalate', outcome: 'escalated', askerChanged: true, parseOk: false }),
    q({ outcome: 'answered_wrong_confident' }),
  ],
  needs: [need(true, true), need(false), need(true)],
} as unknown as LivesResult;

describe('summarizeLives', () => {
  const s = summarizeLives(result, [{ model: 'claude-sonnet-5-5', inputTokens: 1_000_000, outputTokens: 0, latencyMs: 0 }]);

  it('counts needs met, bother per roommate-day and commitments', () => {
    expect(s).toMatchObject({ needs: 3, needsMet: 2, metByChange: 1, escalations: 2, botherPerRoommateDay: 0.2, commitments: 1, askerChanges: 1, errors: 1 });
  });

  it('gives answer outcome shares, parse accuracy and cost split between agent and simulator', () => {
    expect(s.outcomes).toMatchObject({ answered_correct: 0.25, escalated: 0.5, answered_wrong_confident: 0.25 });
    expect(s.parseAccuracy).toBe(0.75);
    expect(s.agentUsd).toBeCloseTo(0.4); // 4 x 1M input tokens at $0.10
    expect(s.simUsd).toBeCloseTo(2);
    expect(s.p50AgentMs).toBe(1000);
  });
});
