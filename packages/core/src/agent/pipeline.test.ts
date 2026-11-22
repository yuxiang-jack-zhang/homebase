import { describe, expect, it } from 'vitest';
import { buildClaim } from '../confidence.ts';
import { shouldLogPrediction } from '../policy.ts';
import type { AnswerMode, AwayBlock, Evidence, ParsedQuestion } from '../types.ts';
import { fakeModel } from './model.ts';
import { answerForTarget, parseQuestion, type TargetInput } from './pipeline.ts';

const NOW = '2027-01-05T12:00:00Z'; // Tuesday
const AT7 = '2027-01-05T19:00:00Z';
const TZ = 'UTC';
const evening: AwayBlock = { daysOfWeek: [2], startLocal: '18:00', endLocal: '21:00', label: 'climbing' };
const allDay: AwayBlock = { daysOfWeek: [2], startLocal: '11:00', endLocal: '21:00' };
const ev = (blocks: AwayBlock[], home = true): Evidence => ({
  now: NOW, timezone: TZ, blocks,
  presence: [{ kind: home ? 'enter' : 'exit', at: '2027-01-05T08:00:00Z' }],
});
const at7: ParsedQuestion = { kind: 'at_time', aboutTime: AT7 };
const input = (answerMode: AnswerMode, evidence: Evidence, o: Partial<TargetInput> = {}): TargetInput => ({
  question: 'will Sam be home at 7?', parsed: at7, targetName: 'Sam',
  settings: { visibility: true, answerMode }, evidence, householdWide: false, ...o,
});

describe('parseQuestion', () => {
  const pq = (value: unknown) => parseQuestion(fakeModel({ parse: value }), 'home at 7?', NOW, TZ);

  it('maps an invalid aboutTime to unclear', async () => {
    expect(await pq({ kind: 'at_time', aboutTime: 'tonight-ish' })).toEqual({ kind: 'unclear', aboutTime: null });
  });
  it('maps at_time with null time to unclear', async () => {
    expect(await pq({ kind: 'at_time', aboutTime: null })).toEqual({ kind: 'unclear', aboutTime: null });
  });
  it('rejects a time without an offset or Z', async () => {
    expect(await pq({ kind: 'at_time', aboutTime: '2027-01-05T19:00:00' })).toEqual({ kind: 'unclear', aboutTime: null });
  });
  it('rejects a kind outside the enum', async () => {
    expect(await pq({ kind: 'tomorrow', aboutTime: null })).toEqual({ kind: 'unclear', aboutTime: null });
  });
  it('null parse (refusal/API error) -> unclear', async () => {
    expect(await pq(null)).toEqual({ kind: 'unclear', aboutTime: null });
  });
  it('normalizes a valid offset time to UTC', async () => {
    expect(await pq({ kind: 'at_time', aboutTime: '2027-01-05T11:00:00-08:00' })).toEqual({ kind: 'at_time', aboutTime: '2027-01-05T19:00:00.000Z' });
  });
  it('drops aboutTime for kinds that do not use it', async () => {
    expect(await pq({ kind: 'now', aboutTime: AT7 })).toEqual({ kind: 'now', aboutTime: null });
  });
  it('sends now, timezone and the delimited question in the user message only', async () => {
    const m = fakeModel({ parse: { kind: 'now', aboutTime: null } });
    await parseQuestion(m, 'home at 7?', NOW, 'America/Los_Angeles');
    const [call] = m.calls;
    expect(call.user).toContain(NOW);
    expect(call.user).toContain('America/Los_Angeles');
    expect(call.user).toContain('<question>\nhome at 7?\n</question>');
    expect(call.system).not.toContain('home at 7?');
  });
});

describe('answerForTarget', () => {
  it('ask_me target, future question -> escalate, askerText null, draftText set, fallbackGuess null', async () => {
    const r = await answerForTarget(fakeModel({ write: 'Probably not, climbing till 9.' }), input('ask_me', ev([evening])));
    expect(r.decision).toEqual({ action: 'escalate' });
    expect(r.askerText).toBeNull();
    expect(r.draftText).toBe('Probably not, climbing till 9.');
    expect(r.fallbackGuess).toBeNull();
  });

  it('injection: write() leaks schedule for an ask_me target -> askerText null', async () => {
    const r = await answerForTarget(fakeModel({ write: 'Sam is at climbing until 9 (Tue/Thu)' }), input('ask_me', ev([evening])));
    expect(r.decision.action).toBe('escalate');
    expect(r.askerText).toBeNull();
  });

  it('unknown decisions get no asker text, no draft and no model call', async () => {
    const m = fakeModel({ write: 'Sam is at climbing until 9 (Tue/Thu)' });
    const alwaysAutoNothing = await answerForTarget(m, input('always_auto', ev([], false)));
    const householdWide = await answerForTarget(m, input('ask_me', ev([evening]), { householdWide: true }));
    for (const r of [alwaysAutoNothing, householdWide]) {
      expect(r.decision).toEqual({ action: 'unknown' });
      expect(r.askerText).toBeNull();
      expect(r.draftText).toBeNull();
      expect(r.usage).toEqual([]);
    }
    expect(m.calls).toEqual([]);
  });

  it('auto_when_confident + medium block claim -> answer with model text', async () => {
    const r = await answerForTarget(fakeModel({ write: 'Sam will probably be out until 9.' }), input('auto_when_confident', ev([evening])));
    expect(r.claim).toMatchObject({ confidence: 'medium', basis: 'block' });
    expect(r.decision).toEqual({ action: 'answer', caveat: false });
    expect(r.askerText).toBe('Sam will probably be out until 9.');
    expect(r.draftText).toBeNull();
  });

  it('write() returns null -> askerText falls back to templateAnswer', async () => {
    const r = await answerForTarget(fakeModel({ write: null }), input('auto_when_confident', ev([evening])));
    expect(r.askerText).toBe('Sam: probably away at 7:00 PM');
  });

  it('parse returns null (refusal/API error) -> claim null -> escalate', async () => {
    const m = fakeModel({ parse: null, write: 'invented draft' });
    const parsed = await parseQuestion(m, 'home at 7?', NOW, TZ);
    const r = await answerForTarget(m, input('always_auto', ev([evening]), { parsed }));
    expect(r.claim).toBeNull();
    expect(r.decision).toEqual({ action: 'escalate' });
    expect(r.askerText).toBeNull();
    expect(r.draftText).toBeNull(); // nothing to draft from
    expect(r.fallbackGuess).toBeNull();
  });

  it('always_auto + low -> answer with caveat; template contains "not sure"', async () => {
    const r = await answerForTarget(fakeModel({ write: null }), input('always_auto', ev([allDay])));
    expect(r.claim).toMatchObject({ confidence: 'low', basis: 'block_contradicted' });
    expect(r.decision).toEqual({ action: 'answer', caveat: true });
    expect(r.askerText).toContain('not sure');
    expect(r.fallbackGuess).toContain('not sure');
  });

  it('logPrediction mirrors shouldLogPrediction', async () => {
    const cases: TargetInput[] = [
      input('auto_when_confident', ev([evening])),
      input('ask_me', ev([evening])),
      input('always_auto', ev([], false)),
      input('auto_when_confident', ev([]), { parsed: { kind: 'now', aboutTime: null } }),
      input('auto_when_confident', ev([allDay], false), { parsed: { kind: 'until_when', aboutTime: null } }),
      input('auto_when_confident', ev([]), { parsed: { kind: 'unclear', aboutTime: null } }),
    ];
    for (const c of cases) {
      const r = await answerForTarget(fakeModel({ write: 'x' }), c);
      const claim = buildClaim(c.parsed, c.evidence);
      expect(r.logPrediction).toBe(claim ? shouldLogPrediction(claim, NOW) : false);
    }
  });

  it('usage array has one entry per model call', async () => {
    for (const [mode, evidence, calls] of [
      ['auto_when_confident', ev([evening]), 1], // answer: one write
      ['ask_me', ev([evening]), 1],              // escalate: one draft write
      ['always_auto', ev([], false), 0],         // unknown: no call
    ] as const) {
      const m = fakeModel({ write: 'x' });
      const r = await answerForTarget(m, input(mode, evidence));
      expect(r.usage).toHaveLength(calls);
      expect(m.calls).toHaveLength(calls);
    }
  });

  it('the writer sees only the target name, claim and question', async () => {
    const m = fakeModel({ write: 'x' });
    await answerForTarget(m, input('auto_when_confident', ev([evening])));
    const [call] = m.calls;
    expect(call.user).toContain('Sam');
    expect(call.user).toContain('<question>\nwill Sam be home at 7?\n</question>');
    expect(call.user).not.toContain('climbing'); // block labels never reach the model
  });
});
