const MESSAGES: Record<string, string> = {
  invalid_invite_code: "That invite code doesn't match a household. Check it and try again.",
  already_member: "You're already in that household.",
  not_owner: 'Only the household owner can do that.',
  not_member: "You're not a member of that household.",
  invalid_name: 'Give the household a name (up to 60 characters).',
  invalid_location: "That location isn't valid. Try again.",
};

export function friendlyError(e: { message?: string } | null | undefined): string {
  const msg = e?.message;
  if (!msg) return 'Something went wrong. Try again.';
  return MESSAGES[msg] ?? msg;
}
