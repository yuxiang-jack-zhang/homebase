import type { Claim } from '../types.ts';
import { clock } from './template.ts';

/** The claim's predicted time worth saying. For "when are they back?" while they're home it is just "now", which reads as a departure time. */
export const statedPredictedTime = (claim: Claim) =>
  claim.kind === 'until_when' && claim.predictedState === 'home' ? null : claim.predictedTime;

/** Longest writer line accepted. The template line is ~40 chars; this leaves room for a friendly sentence, not an essay. */
export const WRITER_MAX_CHARS = 160;

const FORBIDDEN = /https?:|www\.|@|\.(com|net|org|io|ai|dev|app|co)\b|[`{}<>[\]\\|*#_~$]|=>/i;
const HOME = /\bhome\b/i;
const NOT_HOME = /(\bnot|n['’]t)(\s+\w+){0,2}\s+home\b/i; // "not home", "won't be home", "isn't at home"
const AWAY = /\b(away|out|gone)\b/i;
// A number with minutes or am/pm; a bare "7" is not counted as a time.
const TIME = /\b(\d{1,2})(?::(\d{2}))?\s?(?:([ap])\.?m\b\.?)?/gi;

interface Clock { h: string; m: string; ap: string | undefined }
const timesIn = (text: string): Clock[] =>
  [...text.matchAll(TIME)].filter((x) => x[2] !== undefined || x[3] !== undefined)
    .map((x) => ({ h: x[1].replace(/^0/, ''), m: x[2] ?? '00', ap: x[3]?.toLowerCase() }));
const sameTime = (a: Clock, b: Clock) => a.h === b.h && a.m === b.m && (!a.ap || !b.ap || a.ap === b.ap);

function stateOk(text: string, state: Claim['predictedState']): boolean {
  if (state === 'home') return HOME.test(text) && !NOT_HOME.test(text) && !AWAY.test(text);
  if (state === 'away') {
    const affirmsHome = HOME.test(text.replace(new RegExp(NOT_HOME, 'gi'), '').replace(/\bback home\b/gi, ''));
    return (AWAY.test(text) || NOT_HOME.test(text) || /\bback\b/i.test(text)) && !affirmsHome;
  }
  return false;
}

/**
 * The writer's line, or null if it says more or other than the claim: too long, several lines, links/emails/code,
 * the wrong or no state, a time the claim doesn't have, or missing the time the template line would show.
 * Callers fall back to the template line (answers) or no draft.
 */
export function acceptWriterText(text: string | null, claim: Claim, timezone: string): string | null {
  const t = text?.trim();
  if (!t || t.length > WRITER_MAX_CHARS || /[\r\n]/.test(t) || FORBIDDEN.test(t)) return null;
  if (!stateOk(t, claim.predictedState)) return null;
  const toClock = (iso: string) => timesIn(clock(iso, timezone))[0];
  const allowed = [claim.aboutTime, statedPredictedTime(claim)].flatMap((iso) => (iso ? [toClock(iso)] : []));
  const times = timesIn(t);
  if (!times.every((x) => allowed.some((a) => sameTime(x, a)))) return null;
  const required = claim.kind === 'at_time' ? claim.aboutTime
    : claim.kind === 'until_when' && claim.predictedState === 'away' ? claim.predictedTime : null;
  if (required && !times.some((x) => sameTime(x, toClock(required)))) return null;
  return t;
}
