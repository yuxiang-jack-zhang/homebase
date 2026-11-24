import { describe, expect, it } from 'vitest';
import { fakeModel } from './model.ts';
import { answerForTarget, parseQuestion } from './pipeline.ts';
import { tracedModel, type TracedCall } from './trace.ts';
import type { Evidence, MemberSettings } from '../types.ts';

const NOW = '2026-11-23T18:00:00.000Z';
const settings: MemberSettings = { visibility: true, answerMode: 'always_auto' };
const evidence: Evidence = { now: NOW, timezone: 'UTC', presence: [{ kind: 'enter', at: '2026-11-23T17:00:00.000Z' }], blocks: [] };

describe('tracedModel', () => {
  it('records parse and answer calls with their step, outcome and usage, and passes results through', async () => {
    const calls: TracedCall[] = [];
    const m = tracedModel(fakeModel({ parse: { kind: 'now', aboutTime: null }, write: 'Sam is home.' }), (c) => calls.push(c));
    const parsed = await parseQuestion(m, 'is Sam home', NOW, 'UTC');
    const r = await answerForTarget(m, { parsed, targetName: 'Sam', settings, evidence, householdWide: false });
    expect(r.askerText).toBe('Sam is home.');
    expect(calls.map((c) => [c.step, c.ok, c.usage.model])).toEqual([['parse', true, 'fake'], ['answer', true, 'fake']]);
  });

  it('marks a call with no output as not ok, and an unknown prompt as other', async () => {
    const calls: TracedCall[] = [];
    const m = tracedModel(fakeModel({ parse: null, write: null }), (c) => calls.push(c));
    await m.parse({ system: 'x', user: 'y', schema: undefined as never });
    await m.write({ system: 'x', user: 'y' });
    expect(calls.map((c) => [c.step, c.ok])).toEqual([['other', false], ['other', false]]);
  });
});
