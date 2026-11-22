import type { Claim } from '../types.ts';

export const clock = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

/** Deterministic asker line, used when the writer returns nothing and for the fallback guess. */
export function templateAnswer(name: string, claim: Claim | null, caveat: boolean, timezone = 'UTC'): string {
  const state = claim?.predictedState;
  if (!claim || !state) return `${name}: unknown`;
  const hedge = claim.confidence === 'high' ? '' : 'probably ';
  let body: string = state;
  if (claim.kind === 'at_time' && claim.aboutTime) body = `${hedge}${state} at ${clock(claim.aboutTime, timezone)}`;
  else if (claim.kind === 'until_when') {
    body = state === 'home' ? 'home now'
      : claim.predictedTime ? `${hedge}away until about ${clock(claim.predictedTime, timezone)}` : 'away';
  }
  return `${name}: ${body}${caveat ? ' (not sure)' : ''}`;
}
