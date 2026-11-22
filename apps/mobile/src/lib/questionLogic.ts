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
