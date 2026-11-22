import type { Claim, Decision, MemberSettings } from './types.ts';

const ts = Date.parse;

export function decide(i: { claim: Claim | null; settings: MemberSettings; householdWide: boolean; now: string }): Decision {
  const { claim, settings, householdWide, now } = i;
  const escalate: Decision = householdWide ? { action: 'unknown' } : { action: 'escalate' };
  if (!claim || !settings.visibility) return escalate; // off: every question about the member escalates (D29)

  const past = claim.kind === 'now' || (claim.kind === 'at_time' && claim.aboutTime !== null && ts(claim.aboutTime) <= ts(now));
  if (past) return claim.predictedState ? { action: 'answer', caveat: false } : escalate;
  if (claim.kind === 'until_when' && claim.predictedState === 'home') return { action: 'answer', caveat: false };

  // Nothing to answer with: always_auto never pings the member, so the asker sees "unknown".
  const noPrediction = (claim.predictedState === null && claim.predictedTime === null) || (claim.kind === 'at_time' && claim.aboutTime === null);
  if (noPrediction) return settings.answerMode === 'always_auto' ? { action: 'unknown' } : escalate;

  switch (settings.answerMode) {
    case 'ask_me': return escalate;
    case 'auto_when_confident': return claim.confidence === 'low' ? escalate : { action: 'answer', caveat: false };
    case 'always_auto': return { action: 'answer', caveat: claim.confidence === 'low' };
  }
}

export function fallbackAllowed(settings: MemberSettings, claim: Claim | null): boolean {
  return settings.visibility && settings.answerMode !== 'ask_me' && !!claim && (claim.predictedState !== null || claim.predictedTime !== null);
}

export function shouldLogPrediction(claim: Claim, now: string): boolean {
  if (claim.kind === 'at_time') return claim.aboutTime !== null && ts(claim.aboutTime) > ts(now) && claim.predictedState !== null;
  return claim.kind === 'until_when' && claim.predictedState === 'away' && claim.predictedTime !== null;
}
