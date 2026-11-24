import type { LivesResult, QuestionLog } from './loop.ts';
import type { LivesSummary } from './metrics.ts';

const p = (x: number | null) => (x === null ? 'n/a' : `${Math.round(x * 100)}%`);
const DECIDED = { answer: 'agent answered', escalate: 'agent asked', unknown: 'agent said unknown' } as const;

function tell(q: QuestionLog): string {
  const agent = q.decision === 'escalate'
    ? `agent asked ${q.target}${q.draft ? ` (suggested: "${q.draft}")` : ''} → ${q.target}: "${q.replyText ?? 'no reply'}"${q.targetChanged ? ` and changed plans` : ''}`
    : `${DECIDED[q.decision]}: "${q.askerText ?? `${q.target}: unknown`}"`;
  return `Day ${q.day} ${q.at}: ${q.asker} asks about ${q.target}: "${q.text}" → ${agent}${q.askerChanged ? `; ${q.asker} changed plans` : ''}. Graded: ${q.outcome.replace(/_/g, ' ')}.`;
}

/** Up to five real chains from the run, chosen deterministically: a commitment, a missed need, a confident error, an asker who changed plans, an approved draft. */
export function stories(r: LivesResult): string[] {
  const out: string[] = [];
  const commitment = r.questions.find((q) => q.targetChanged);
  if (commitment) out.push(tell(commitment));
  const missed = r.needs.find((n) => !n.met);
  if (missed) {
    const before = r.questions.filter((q) => q.day === missed.day && q.asker === missed.who && q.at <= missed.at).at(-1);
    out.push(`Missed need: ${missed.who} needed someone home at ${missed.at} on day ${missed.day} (${missed.what}).${before ? ` Before that: ${tell(before)}` : ''}`);
  }
  const wrong = r.questions.find((q) => q.outcome === 'answered_wrong_confident');
  if (wrong) out.push(tell(wrong));
  const asker = r.questions.find((q) => q.askerChanged && q !== commitment);
  if (asker) out.push(tell(asker));
  const approved = r.questions.find((q) => q.draft && q.replyText === q.draft && q !== commitment);
  if (approved) out.push(tell(approved));
  return out.slice(0, 5);
}

export function livesMarkdown(date: string, s: LivesSummary, story: string[]): string {
  return [
    `\n### LLM-driven roommates ${date}: ${s.mode}, agent ${s.model} (${s.days} days)\n`,
    '| mode | agent | questions | needs met | met by a plan change | asked per roommate-day | commitments | correct | wrong, confident | asked roommate | parse | agent $ | simulator $ | p50 agent |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    `| ${s.mode} | ${s.model} | ${s.questions} | ${s.needsMet}/${s.needs} (${p(s.needs ? s.needsMet / s.needs : null)}) | ${s.metByChange} | ${s.botherPerRoommateDay.toFixed(2)} | ${s.commitments} | ${p(s.outcomes.answered_correct)} | ${p(s.outcomes.answered_wrong_confident)} | ${p(s.outcomes.escalated)} | ${p(s.parseAccuracy)} | ${s.agentUsd.toFixed(4)} | ${s.simUsd.toFixed(2)} | ${s.p50AgentMs} ms |`,
    '',
    ...(story.length ? ['Stories:', ...story.map((x) => `- ${x}`), ''] : []),
    s.errors ? `${s.errors} simulation error(s) recorded in the results file.\n` : '',
  ].join('\n');
}
