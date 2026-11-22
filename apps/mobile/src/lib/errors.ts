const MESSAGES: Record<string, string> = {
  invalid_invite_code: "That invite code doesn't match a household. Check it and try again.",
  already_member: "You're already in that household.",
  not_owner: 'Only the household owner can do that.',
  not_member: "You're not a member of that household.",
  invalid_name: 'Give the household a name (up to 60 characters).',
  not_awaiting_reply: 'Already answered.',
  no_draft: 'There is no suggested answer to approve.',
  not_target: "That question isn't yours to answer.",
  cannot_target_self: "You can't ask yourself.",
  target_not_member: 'One of those people is not in this household.',
  no_targets: 'There is nobody to ask.',
  bad_response: 'Got an unexpected answer from the server. Try again.',
  invalid_location: "That location isn't valid. Try again.",
};

export function friendlyError(e: { message?: string } | null | undefined): string {
  const msg = e?.message;
  if (!msg) return 'Something went wrong. Try again.';
  if (/^http_\d+$/.test(msg)) return 'The server had a problem. Try again.';
  return MESSAGES[msg] ?? msg;
}
