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
  too_many_targets: 'Ask at most 20 people at a time.',
  rate_limited: "You've asked a lot of questions recently. Try again in a little while.",
  busy: 'Homebase is busy right now. Try again later.',
  bad_response: 'Got an unexpected answer from the server. Try again.',
  invalid_location: "That location isn't valid. Try again.",
  invalid_request: "That request wasn't valid. Check it and try again.",
  unauthorized: 'Your session has expired. Sign in again.',
  forbidden: "You don't have access to that.",
  method_not_allowed: 'The app sent a request the server does not accept. Update the app.',
  internal_error: 'The server had a problem. Try again.',
  'Failed to send a request to the Edge Function': "Couldn't reach the server. Check your connection and try again.",
};

export function friendlyError(e: { message?: string } | null | undefined): string {
  const msg = e?.message;
  if (!msg) return 'Something went wrong. Try again.';
  if (/^http_\d+$/.test(msg)) return 'The server had a problem. Try again.';
  return MESSAGES[msg] ?? msg;
}

/** Expo wraps native failures as "Calling the 'startGeofencingAsync' function has failed → Caused by: …". */
export function geofenceError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/geofencing is not available|startGeofencingAsync/i.test(msg)) return "Location tracking isn't available on this device.";
  return friendlyError({ message: msg });
}
