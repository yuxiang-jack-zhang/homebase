import type { ModelUsage } from '../../../packages/core/src/agent/model.ts';
import { cost } from '../../report.ts';
import type { Outcome } from '../grade.ts';
import type { LivesResult } from './loop.ts';

const OUTCOMES: Outcome[] = ['answered_correct', 'answered_wrong_confident', 'answered_wrong_caveated', 'escalated', 'unknown'];
const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] : 0); // nearest rank

/** Needs met vs bother (the trade-off the spec asks for), commitments, answer outcomes and cost. */
export function summarizeLives(r: LivesResult, simUsage: ModelUsage[] = []) {
  const qs = r.questions, n = qs.length;
  const escalated = qs.filter((q) => q.decision === 'escalate');
  const agentUsage = qs.flatMap((q) => q.agentCalls.map((c) => c.usage));
  const perQuestionMs = qs.map((q) => q.agentCalls.reduce((s, c) => s + c.usage.latencyMs, 0)).sort((a, b) => a - b);
  return {
    mode: r.options.mode, model: r.options.model, days: r.options.days,
    questions: n,
    needs: r.needs.length,
    needsMet: r.needs.filter((x) => x.met).length,
    metByChange: r.needs.filter((x) => x.byChange).length,
    escalations: escalated.length,
    botherPerRoommateDay: escalated.length / (r.household.length * r.options.days),
    commitments: escalated.filter((q) => q.targetChanged).length,
    askerChanges: qs.filter((q) => q.askerChanged).length,
    outcomes: Object.fromEntries(OUTCOMES.map((o) => [o, n ? qs.filter((q) => q.outcome === o).length / n : 0])) as Record<Outcome, number>,
    parseAccuracy: n ? qs.filter((q) => q.parseOk).length / n : null,
    agentUsd: cost(agentUsage).usd,
    simUsd: cost(simUsage).usd,
    p50AgentMs: pct(perQuestionMs, 0.5),
    p95AgentMs: pct(perQuestionMs, 0.95),
    errors: r.errors.length,
  };
}
export type LivesSummary = ReturnType<typeof summarizeLives>;
