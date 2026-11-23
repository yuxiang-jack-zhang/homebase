import { decide, fallbackAllowed } from '../../packages/core/src/policy.ts';
import type { AnswerMode, Claim, Decision, ParsedQuestion } from '../../packages/core/src/types.ts';
import type { SimQuestion } from './questions.ts';
import { isAway, nextReturn, type Interval } from './world.ts';

export type Outcome = 'answered_correct' | 'answered_wrong_confident' | 'answered_wrong_caveated' | 'escalated' | 'unknown';
export const MODES: AnswerMode[] = ['ask_me', 'auto_when_confident', 'always_auto'];
export interface ModeGrade { outcome: Outcome; draftCorrect: boolean | null; fallbackCorrect: boolean | null }

const MIN = 60_000;
const UNTIL_TOLERANCE = 30 * MIN;
const PARSE_TOLERANCE = 15 * MIN;
const state = (tl: Interval[], ms: number) => (isAway(tl, ms) ? 'away' : 'home');

/**
 * Is the claim right about what the asker meant (the intent, not the parse)? Graded against the hidden timeline,
 * never against presence. null when the claim predicts nothing.
 */
export function claimCorrect(claim: Claim | null, q: SimQuestion, timeline: Interval[]): boolean | null {
  if (!claim || (claim.predictedState === null && claim.predictedTime === null)) return null;
  const { kind, aboutMs } = q.intent;
  if (kind === 'now') return claim.predictedState === state(timeline, q.askMs);
  if (kind === 'at_time') return claim.predictedState === state(timeline, aboutMs!);
  const back = nextReturn(timeline, q.askMs);
  if (back === null) return claim.predictedState === 'home';
  return claim.predictedState === 'away' && claim.predictedTime !== null && Math.abs(Date.parse(claim.predictedTime) - back) <= UNTIL_TOLERANCE;
}

export function outcome(decision: Decision, correct: boolean | null): Outcome {
  if (decision.action === 'escalate') return 'escalated';
  if (decision.action === 'unknown') return 'unknown';
  if (correct) return 'answered_correct';
  return decision.caveat ? 'answered_wrong_caveated' : 'answered_wrong_confident';
}

/** The same claim decided under every answer mode (decide is pure, so this costs no model calls). */
export function gradeAllModes(claim: Claim | null, q: SimQuestion, timeline: Interval[], nowIso: string): Record<AnswerMode, ModeGrade> {
  const correct = claimCorrect(claim, q, timeline);
  const out = {} as Record<AnswerMode, ModeGrade>;
  for (const mode of MODES) {
    const settings = { visibility: true, answerMode: mode };
    const d = decide({ claim, settings, householdWide: false, now: nowIso });
    const escalated = d.action === 'escalate';
    out[mode] = {
      outcome: outcome(d, correct),
      // A draft exists only when escalating with a prediction (pipeline.ts); the fallback guess only when policy allows it.
      draftCorrect: escalated && correct !== null ? correct : null,
      fallbackCorrect: escalated && fallbackAllowed(settings, claim) ? correct : null,
    };
  }
  return out;
}

export function parseCorrect(parsed: ParsedQuestion, intent: SimQuestion['intent']): boolean {
  if (parsed.kind !== intent.kind) return false;
  if (intent.kind !== 'at_time') return true;
  return parsed.aboutTime !== null && Math.abs(Date.parse(parsed.aboutTime) - intent.aboutMs!) <= PARSE_TOLERANCE;
}
