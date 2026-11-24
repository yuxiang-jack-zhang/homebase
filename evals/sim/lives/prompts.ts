// Prompts for the roommates Sonnet plays. They see only what a person would (spec anti-goal): their own life and plans,
// the question, the suggested reply (when it is their question), and the answer text (when they asked). Never the
// agent's internals or anyone else's plans.
import type { Outing } from './day.ts';
import type { Roommate } from './household.ts';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TIMES = 'Times are 24-hour "HH:MM" from midnight of today; use 24:00-29:00 for after midnight (e.g. 25:30 = 1:30am tonight).';
const who = (me: Roommate) => `You are ${me.name}, ${me.age}, ${me.job}. Routine: ${me.routine}. Habits: ${me.habits}. Social life: ${me.social}.`;
const plan = (xs: Outing[]) => (xs.length ? xs.map((x) => `${x.leave}-${x.back} ${x.why}`).join('; ') : 'staying home all day');
const mem = (m: string[]) => (m.length ? `Recent days: ${m.join(' ')}` : '');

const WORDS: Record<number, string> = { 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six' };

export function householdPrompt(seed: number, size = 5) {
  return {
    system: 'You invent realistic people for a simulation of a shared house. Make them different from each other and believable, with ordinary lives.',
    user: `Household #${seed}: ${WORDS[size]} adults sharing a house in Los Angeles. For each: name (first name, all different), age, job and hours, routine, habits, social life,
and the away blocks they would put in a roommate app ("days": 0=Sunday..6=Saturday, "start"/"end" as HH:MM in 00:00-23:59, optional label).
People are lazy about the app: some add accurate blocks, some add stale or partial ones, some add none. Include at least one irregular schedule.`,
  };
}

export function planPrompt(p: { me: Roommate; housemates: string[]; dow: number; memory: string[]; promises: string[]; earliest: string; warmup: boolean }) {
  return {
    system: `${who(p.me)}
You live with ${p.housemates.join(', ')}. You plan your own day realistically, including spontaneous or lazy days. ${TIMES}`,
    user: `It is ${DAYS[p.dow]} morning. ${mem(p.memory)}${p.promises.length ? `\nYou promised: ${p.promises.join('; ')}.` : ''}
Plan today: "outings" when you will be away from home (sorted, not overlapping, first leave no earlier than ${p.earliest}, last back by 29:00), each with why.
${p.warmup ? 'Leave "needs" and "questions" empty today.' : `"needs": 0-2 times today when you need someone at home (a delivery, a repair, a guest, letting someone in), only if it fits your life.
"questions": 0-3 moments you would ask the house app about a housemate's whereabouts (about = their name), including one shortly before each need. Most days have none or one.`}`,
  };
}

export function phrasePrompt(p: { me: Roommate; target: string; now: string; dow: number; why: string }) {
  return {
    system: `${who(p.me)} You text a roommate app that knows whether housemates are home. ${TIMES}`,
    user: `It is ${DAYS[p.dow]} ${p.now}. You want to ask about ${p.target} because: ${p.why}.
Write the message exactly as you'd type it on your phone ("text"), then say what it asks:
"kind": "now" (are they home right now), "at_time" (will/were they home at a specific time), or "until_when" (when they'll be back);
"aboutTime": for at_time only, the time you mean as HH:MM (else null).`,
  };
}

export function replyPrompt(p: { me: Roommate; asker: string; question: string; draft: string | null; now: string; myOutings: Outing[]; outNow: boolean; memory: string[] }) {
  return {
    system: `${who(p.me)} The house app forwarded you a housemate's question because it wasn't sure what to tell them. ${TIMES}`,
    user: `It is ${p.now}. ${mem(p.memory)}
Your plan today: ${plan(p.myOutings)}. You are ${p.outNow ? 'out' : 'at home'} right now.
${p.asker} asked: "${p.question}"
${p.draft ? `The app suggests replying: "${p.draft}" (it may be wrong).` : 'The app has no suggested reply.'}
Reply as you really would: "reply" is approve (send the suggestion), yes, no, not_sure, or text (then write "text").
If their question makes you change your plans, give "change" with "outings" for the rest of today (after ${p.now})${p.outNow ? ' and "backBy", when you will now get home' : ''}.
You don't have to change anything; only do it if it's reasonable for you. Otherwise "change" is null.`,
  };
}

export function reactPrompt(p: { me: Roommate; target: string; question: string; answer: string; now: string; myOutings: Outing[]; need: string | null; memory: string[] }) {
  return {
    system: `${who(p.me)} ${TIMES}`,
    user: `It is ${p.now}. ${mem(p.memory)}
Your plan today: ${plan(p.myOutings)}.${p.need ? ` You need someone home for: ${p.need}.` : ''}
You asked the house app "${p.question}" and got: "${p.answer}"
Does this change your plans for the rest of today? If yes, give "change" with "outings" after ${p.now} (and "backBy" if you're out now). If not, "change" is null.`,
  };
}

export function memoryPrompt(p: { me: Roommate; outings: Outing[]; events: string[] }) {
  return {
    system: who(p.me),
    user: `Today you were out: ${plan(p.outings)}.${p.events.length ? ` Also: ${p.events.join(' ')}` : ''}
In "memory", note in one or two short sentences what you'd remember tomorrow (plans, promises, mood).`,
  };
}
