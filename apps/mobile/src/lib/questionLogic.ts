import type { ReplyRequest } from '@homebase/core/src/contracts';

export const NO_REPLY_AFTER_MS = 10 * 60_000;

export interface TargetView {
  name: string;
  status: 'answered' | 'awaiting_reply' | 'unknown' | 'replied';
  text: string | null;
  fallback_guess: string | null;
  created_at: string;
}

/** Lines the asker sees for one target. Only `awaiting_reply` depends on `now`. */
export function targetLines(t: TargetView, now: number): string[] {
  switch (t.status) {
    case 'answered':
    case 'replied':
      return [t.text ?? ''];
    case 'unknown':
      return [`${t.name}: unknown`];
    case 'awaiting_reply':
      if (now - Date.parse(t.created_at) <= NO_REPLY_AFTER_MS) return [`Asked ${t.name} — waiting…`];
      return t.fallback_guess ? ['No reply yet', t.fallback_guess] : ['No reply yet'];
  }
}

/**
 * The server lets the asker read a fallback guess only once the wait is over (0009), so re-fetch then.
 * The slack covers a phone clock slightly ahead of the server's.
 */
export function guessRefetchIn(targets: Pick<TargetView, 'status' | 'fallback_guess' | 'created_at'>[], now: number): number | null {
  const due = targets
    .filter((t) => t.status === 'awaiting_reply' && !t.fallback_guess)
    .map((t) => Date.parse(t.created_at) + NO_REPLY_AFTER_MS - now)
    .filter((ms) => ms > 0);
  return due.length ? Math.min(...due) + 5_000 : null;
}

/** Approve needs a draft, so a draft-less question gets the category without it. */
export const categoryFor = (draft: string | null) => (draft ? 'question' : 'question_nodraft');

/** Notification action id (+ typed text) -> reply request; null for a plain tap or an empty text reply. */
export function responseToReply(questionTargetId: string, actionId: string, userText?: string): ReplyRequest | null {
  if (actionId === 'approve' || actionId === 'yes' || actionId === 'no') return { questionTargetId, action: actionId };
  if (actionId === 'text') {
    const text = userText?.trim();
    return text ? { questionTargetId, action: 'text', text: text.slice(0, 280) } : null;
  }
  return null;
}

export const newTargets = <T extends { id: string }>(items: T[], seen: Set<string>) => items.filter((i) => !seen.has(i.id));

export const DRAFT_GRACE_MS = 5_000;
const STALE_FIRST_RUN_MS = 10 * 60_000;

/** The draft row lands just after its target; a draft-less question this young may still get one, so wait. */
export const notifyDecision = (i: { draft: string | null; created_at: string }, now: number): 'notify' | 'wait' =>
  i.draft !== null || now - Date.parse(i.created_at) > DRAFT_GRACE_MS ? 'notify' : 'wait';

/** First run has no seen-set: silently mark old questions seen so installing doesn't flood; fresher ones still notify. */
export const seedOnFirstRun = (items: { id: string; created_at: string }[], first: boolean, now: number) =>
  first ? items.filter((i) => now - Date.parse(i.created_at) > STALE_FIRST_RUN_MS).map((i) => i.id) : [];
