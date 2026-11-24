import { describe, expect, it } from 'vitest';
import type { Plan } from './day.ts';
import { generateHousehold, normalizePlan, type Roommate } from './household.ts';
import { scriptedLlm } from './llm.ts';
import { planPrompt, reactPrompt, replyPrompt } from './prompts.ts';

const mate = (name: string): Roommate => ({ name, age: 27, job: 'nurse', routine: 'nights', habits: 'gym', social: 'quiet', blocks: [] });
const raw = (names: string[]) => ({
  roommates: names.map((name) => ({ ...mate(name), blocks: [{ days: [1, 2, 3], start: '09:00', end: '17:00', label: 'work' }] })),
});

describe('generateHousehold', () => {
  it('returns five roommates with blocks in the app format, and puts the seed in the prompt', async () => {
    let user = '';
    const llm = scriptedLlm((name, u) => { user = u; return raw(['Ana', 'Bo', 'Cy', 'Di', 'Ed']); });
    const h = await generateHousehold(llm, 7);
    expect(h.map((r) => r.name)).toEqual(['Ana', 'Bo', 'Cy', 'Di', 'Ed']);
    expect(h[0].blocks).toEqual([{ daysOfWeek: [1, 2, 3], startLocal: '09:00', endLocal: '17:00', label: 'work' }]);
    expect(user).toContain('7');
  });

  it('can make a smaller household; the prompt names the size in words', async () => {
    let user = '';
    const h = await generateHousehold(scriptedLlm((n, u) => { user = u; return raw(['Ana', 'Bo']); }), 3, 2);
    expect(h.map((r) => r.name)).toEqual(['Ana', 'Bo']);
    expect(user).toContain('two adults');
    await expect(generateHousehold(scriptedLlm(() => raw(['Ana', 'Bo', 'Cy'])), 3, 2)).rejects.toThrow(/2 roommates/);
  });

  it('rejects the wrong size, duplicate names or bad block times', async () => {
    await expect(generateHousehold(scriptedLlm(() => raw(['A', 'B', 'C', 'D'])), 1)).rejects.toThrow(/5 roommates/);
    await expect(generateHousehold(scriptedLlm(() => raw(['A', 'A', 'C', 'D', 'E'])), 1)).rejects.toThrow(/unique/);
    const bad = raw(['A', 'B', 'C', 'D', 'E']);
    bad.roommates[0].blocks[0].start = '9am';
    await expect(generateHousehold(scriptedLlm(() => bad), 1)).rejects.toThrow(/block/);
  });
});

describe('normalizePlan', () => {
  const names = ['Ana', 'Bo', 'Cy'];
  const plan = (o: Partial<Plan>): Plan => ({ outings: [], needs: [], questions: [], ...o });

  it('drops questions about unknown people or yourself, matching names case-insensitively', () => {
    const r = normalizePlan(plan({ questions: [
      { at: '10:00', about: 'bo', why: 'a' }, { at: '11:00', about: 'Zed', why: 'b' }, { at: '12:00', about: 'Ana', why: 'c' }, { at: '9am', about: 'Cy', why: 'd' },
    ] }), 'Ana', names);
    expect(r.plan.questions).toEqual([{ at: '10:00', about: 'Bo', why: 'a' }]);
    expect(r.dropped).toBe(3);
  });

  it('adds a question 30 min before a need that has none in the hour before it', () => {
    const r = normalizePlan(plan({ needs: [{ at: '15:00', what: 'plumber' }, { at: '19:00', what: 'guest' }], questions: [{ at: '18:20', about: 'Cy', why: 'guest' }] }), 'Ana', names);
    expect(r.plan.questions).toEqual([{ at: '14:30', about: 'Bo', why: 'plumber' }, { at: '18:20', about: 'Cy', why: 'guest' }]);
  });
});

describe('prompts', () => {
  it('asks for needs only at times you will be out yourself, and keeps the warm-up prompt free of needs', () => {
    const base = { me: mate('Bo'), housemates: ['Ana'], dow: 1, memory: [], promises: [], earliest: '05:00' };
    expect(planPrompt({ ...base, warmup: false }).user).toMatch(/while you are out/);
    expect(planPrompt({ ...base, warmup: true }).user).toContain('Leave "needs" and "questions" empty today.');
  });

  it('a reply or reaction prompt shows only your own plan, never the agent internals', () => {
    const me = mate('Bo');
    const p1 = replyPrompt({ me, asker: 'Ana', question: 'u home at 3?', draft: 'Yes, back by 3.', now: '13:00', myOutings: [{ leave: '12:00', back: '18:00', why: 'work' }], outNow: true, memory: ['busy week'] });
    const p2 = reactPrompt({ me, target: 'Bo', question: 'u home at 3?', answer: 'Bo is probably away at 3:00 PM.', now: '13:00', myOutings: [], need: 'plumber at 15:00', memory: [] });
    for (const p of [p1, p2]) {
      const all = p.system + p.user;
      expect(all).not.toMatch(/confidence|claim|evidence/i);
    }
    expect(p1.user).toContain('12:00');
    expect(p1.user).toContain('Yes, back by 3.');
    expect(p2.user).toContain('plumber');
  });
});
