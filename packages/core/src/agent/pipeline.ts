import { z } from 'zod';
import { buildClaim } from '../confidence.ts';
import { decide, fallbackAllowed, shouldLogPrediction } from '../policy.ts';
import type { Claim, Decision, Evidence, MemberSettings, ParsedQuestion } from '../types.ts';
import type { ModelClient, ModelUsage } from './model.ts';
import { ANSWER_SYSTEM, DRAFT_SYSTEM, PARSE_SYSTEM, answerUser, draftUser, parseUser } from './prompts.ts';
import { templateAnswer } from './template.ts';

const parseSchema = z.object({ kind: z.enum(['now', 'at_time', 'until_when', 'unclear']), aboutTime: z.string().nullable() });
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const UNCLEAR: ParsedQuestion = { kind: 'unclear', aboutTime: null };

export async function parseQuestion(m: ModelClient, text: string, now: string, timezone: string): Promise<ParsedQuestion> {
  const { value } = await m.parse({ system: PARSE_SYSTEM, user: parseUser(text, now, timezone), schema: parseSchema });
  const r = parseSchema.safeParse(value); // the model output is untrusted, re-check even after structured output
  if (!r.success) return UNCLEAR;
  const { kind, aboutTime } = r.data;
  if (aboutTime !== null && !(ISO_WITH_OFFSET.test(aboutTime) && Number.isFinite(Date.parse(aboutTime)))) return UNCLEAR;
  if (kind !== 'at_time') return { kind, aboutTime: null };
  return aboutTime === null ? UNCLEAR : { kind, aboutTime: new Date(aboutTime).toISOString() };
}

export interface TargetInput { question: string; parsed: ParsedQuestion; targetName: string; settings: MemberSettings; evidence: Evidence; householdWide: boolean }
export interface TargetResult {
  decision: Decision; claim: Claim | null;
  askerText: string | null;      // non-null only when decision.action === 'answer'
  draftText: string | null;      // non-null only when decision.action === 'escalate' (goes to the target only)
  fallbackGuess: string | null;  // non-null only when fallbackAllowed()
  logPrediction: boolean; usage: ModelUsage[];
}

export async function answerForTarget(m: ModelClient, input: TargetInput): Promise<TargetResult> {
  const { question, parsed, targetName, settings, evidence, householdWide } = input;
  const tz = evidence.timezone;
  const claim = buildClaim(parsed, evidence);
  const decision = decide({ claim, settings, householdWide, now: evidence.now });
  const usage: ModelUsage[] = [];
  let askerText: string | null = null;
  let draftText: string | null = null;

  // Guardrail (D6): asker-facing text exists only for an `answer` decision; nothing the model writes elsewhere reaches the asker.
  if (decision.action === 'answer' && claim) {
    const r = await m.write({ system: ANSWER_SYSTEM, user: answerUser(question, targetName, claim, decision.caveat, tz) });
    usage.push(r.usage);
    askerText = r.text || templateAnswer(targetName, claim, decision.caveat, tz);
  } else if (decision.action === 'escalate' && claim && (claim.predictedState !== null || claim.predictedTime !== null)) {
    const r = await m.write({ system: DRAFT_SYSTEM, user: draftUser(question, targetName, claim, tz) });
    usage.push(r.usage);
    draftText = r.text || null;
  }

  return {
    decision, claim, askerText, draftText,
    fallbackGuess: fallbackAllowed(settings, claim) ? templateAnswer(targetName, claim, true, tz) : null,
    logPrediction: claim ? shouldLogPrediction(claim, evidence.now) : false,
    usage,
  };
}
