import { describe, expect, it } from 'vitest';
import { fakeModel } from '../../../packages/core/src/agent/model.ts';
import { iso, localMs } from '../world.ts';
import { scriptedLlm } from './llm.ts';
import { runLives, type LivesOptions } from './loop.ts';

const NAMES = ['Ana', 'Bo', 'Cy', 'Di', 'Ed'];
const WEEKDAY_WORK = [{ days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', label: 'work' }];
const meOf = (user: string) => /You are (\w+),/.exec(user)?.[1] ?? '';

/** Ana is out 12-19 and needs someone home for the plumber at 15:00; she asks about Bo at 14:15. Bo is at work 9-18. */
function world(reply: unknown) {
  const seen: string[] = [];
  const llm = scriptedLlm((name, user) => {
    seen.push(name);
    if (name === 'household') {
      return { roommates: NAMES.map((n) => ({ name: n, age: 30, job: 'job', routine: 'r', habits: 'h', social: 's', blocks: n === 'Bo' ? WEEKDAY_WORK : [] })) };
    }
    const me = meOf(user);
    if (name.startsWith('plan')) {
      if (me === 'Ana') return { outings: [{ leave: '12:00', back: '19:00', why: 'work' }], needs: [{ at: '15:00', what: 'plumber' }], questions: [{ at: '14:15', about: 'Bo', why: 'plumber at 3' }] };
      if (me === 'Bo') return { outings: [{ leave: '09:00', back: '18:00', why: 'work' }], needs: [], questions: [] };
      return { outings: [{ leave: '08:00', back: '20:00', why: 'work' }], needs: [], questions: [] };
    }
    if (name === 'phrase') return { text: 'bo will u be home at 3?', kind: 'at_time', aboutTime: '15:00' };
    if (name === 'reply') return reply;
    if (name === 'react') return { change: null };
    if (name === 'memory') return { memory: 'fine day' };
    return null;
  });
  return { llm, seen };
}
const agent = () => fakeModel({ parse: { kind: 'at_time', aboutTime: iso(localMs(0, 15 * 60)) }, write: 'Bo will be away.' });
const opts = (mode: LivesOptions['mode']): LivesOptions => ({ days: 1, warmup: 0, seed: 1, mode, noise: false, simModel: 'sim', model: 'agent' });
const COMEBACK = { reply: 'text', text: 'I can be back by 2:45', change: { backBy: '14:45', outings: [] } };

describe('runLives', () => {
  it('routes to Bo, who comes back early: the need is met and the answer is graded against the changed day', async () => {
    const { llm } = world(COMEBACK);
    const r = await runLives(opts('ask_me'), { sim: llm, agent: agent() });
    expect(r.questions).toHaveLength(1);
    const q = r.questions[0];
    expect(q).toMatchObject({ asker: 'Ana', target: 'Bo', decision: 'escalate', outcome: 'escalated', replyText: 'I can be back by 2:45', targetChanged: true, parseOk: true });
    expect(r.needs).toEqual([{ who: 'Ana', day: 0, at: '15:00', what: 'plumber', met: true, coveredBy: ['Bo'], byChange: true }]);
    expect(r.days[0].plans.Bo.final).toEqual([{ leave: '09:00', back: '14:45', why: 'work' }]);
  });

  it('when the agent answers instead, nobody is asked, Bo stays out and the need is missed', async () => {
    const { llm, seen } = world(COMEBACK);
    const r = await runLives(opts('always_auto'), { sim: llm, agent: agent() });
    expect(seen).not.toContain('reply');
    expect(r.questions[0]).toMatchObject({ decision: 'answer', outcome: 'answered_correct', askerText: 'Bo will be away.' });
    expect(r.needs[0]).toMatchObject({ met: false, coveredBy: [], byChange: false });
  });

  it('a refusal changes nothing', async () => {
    const r = await runLives(opts('ask_me'), { sim: world({ reply: 'no', text: null, change: null }).llm, agent: agent() });
    expect(r.questions[0]).toMatchObject({ replyText: 'No', targetChanged: false });
    expect(r.needs[0].met).toBe(false);
  });

  it('same inputs, same result; warm-up days ask nothing and plan no needs', async () => {
    const a = await runLives({ ...opts('ask_me'), warmup: 2 }, { sim: world(COMEBACK).llm, agent: agent() });
    const b = await runLives({ ...opts('ask_me'), warmup: 2 }, { sim: world(COMEBACK).llm, agent: agent() });
    expect(b).toEqual(a);
    expect(a.days.map((d) => d.day)).toEqual([-2, -1, 0]);
    expect(a.questions.every((q) => q.day === 0)).toBe(true);
    expect(a.needs.every((n) => n.day === 0)).toBe(true);
  });

  it('an invalid plan is retried once, then replaced by a stay-home day with the error recorded', async () => {
    const llm = scriptedLlm((name, user) => {
      if (name === 'household') return { roommates: NAMES.map((n) => ({ name: n, age: 30, job: 'j', routine: 'r', habits: 'h', social: 's', blocks: [] })) };
      if (name.startsWith('plan')) return meOf(user) === 'Cy'
        ? { outings: [{ leave: '12:00', back: '11:00', why: 'oops' }], needs: [], questions: [] }
        : { outings: [], needs: [], questions: [] };
      if (name === 'memory') return { memory: 'm' };
      return null;
    });
    const r = await runLives(opts('ask_me'), { sim: llm, agent: agent() });
    expect(r.days[0].plans.Cy.final).toEqual([]);
    expect(r.errors.some((e) => e.includes('Cy') && e.includes('plan'))).toBe(true);
  });
});
