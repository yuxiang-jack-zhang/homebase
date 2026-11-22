import type { Claim, Feedback, ReplyAction } from './types.ts';

export function classifyFeedback(claim: Claim | null, action: ReplyAction): Feedback | null {
  if (action === 'approve') return 'approved';
  if (action === 'text') return 'edited';
  if (action === 'not_sure' || !claim || !claim.predictedState) return null;
  if (claim.kind !== 'now' && claim.kind !== 'at_time') return null;
  return (action === 'yes') === (claim.predictedState === 'home') ? 'approved' : 'rejected';
}
