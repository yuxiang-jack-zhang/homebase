import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { PERSONAS } from './personas.ts';
import { generateTexts, scheduleQuestions, templateText } from './questions.ts';
import { rng } from './random.ts';
import { localMs, minuteOf } from './world.ts';

const MIN = 60_000;
const names = Object.fromEntries(PERSONAS.map((p) => [p.id, p.name]));
const qs = scheduleQuestions(rng(1), PERSONAS, 14, 3);

describe('scheduleQuestions', () => {
  it('is deterministic and asks each roommate perDay questions a day', () => {
    expect(scheduleQuestions(rng(1), PERSONAS, 14, 3)).toEqual(qs);
    expect(qs).toHaveLength(6 * 14 * 3);
    expect(new Set(qs.map((q) => q.id)).size).toBe(qs.length);
    for (const p of PERSONAS) expect(qs.filter((q) => q.targetId === p.id)).toHaveLength(42);
  });

  it('asks between 07:00 and 23:30 local, never about yourself, in time order', () => {
    for (const q of qs) {
      expect(minuteOf(q.askMs)).toBeGreaterThanOrEqual(7 * 60);
      expect(minuteOf(q.askMs)).toBeLessThanOrEqual(23 * 60 + 30);
      expect(q.askerId).not.toBe(q.targetId);
    }
    expect(qs.map((q) => q.askMs)).toEqual([...qs.map((q) => q.askMs)].sort((a, b) => a - b));
  });

  it('mixes kinds about 40/40/20', () => {
    const share = (k: string) => qs.filter((q) => q.intent.kind === k).length / qs.length;
    expect(share('now')).toBeGreaterThan(0.35);
    expect(share('now')).toBeLessThan(0.45);
    expect(share('at_time')).toBeGreaterThan(0.35);
    expect(share('at_time')).toBeLessThan(0.45);
    expect(share('until_when')).toBeGreaterThan(0.15);
    expect(share('until_when')).toBeLessThan(0.25);
  });

  it('at_time targets are on the quarter hour, 30 min-12 h ahead, or 1-3 h back for about 10%', () => {
    const at = qs.filter((q) => q.intent.kind === 'at_time');
    const past = at.filter((q) => q.intent.aboutMs! < q.askMs);
    for (const q of at) {
      const off = q.intent.aboutMs! - q.askMs;
      expect(minuteOf(q.intent.aboutMs!) % 15).toBe(0);
      if (off > 0) { expect(off).toBeGreaterThanOrEqual(22.5 * MIN); expect(off).toBeLessThanOrEqual(12 * 60 * MIN + 7.5 * MIN); }
      else { expect(off).toBeGreaterThanOrEqual(-3 * 60 * MIN - 7.5 * MIN); expect(off).toBeLessThanOrEqual(-52.5 * MIN); }
    }
    expect(past.length / at.length).toBeGreaterThan(0.04);
    expect(past.length / at.length).toBeLessThan(0.16);
    for (const q of qs.filter((x) => x.intent.kind !== 'at_time')) expect(q.intent.aboutMs).toBeNull();
  });

  it('uses template text until phrased by the LLM', () => {
    expect(qs.every((q) => q.style === 'template' && q.text === templateText(q, names))).toBe(true);
  });
});

describe('templateText', () => {
  const base = { id: 'x', day: 0, askMs: localMs(0, 18 * 60), askerId: 'nine_to_five', targetId: 'stale_blocks', style: 'template', text: '' } as const;
  it('phrases each kind with a local 12-hour clock', () => {
    expect(templateText({ ...base, intent: { kind: 'now', aboutMs: null } }, names)).toBe('is Ben home?');
    expect(templateText({ ...base, intent: { kind: 'until_when', aboutMs: null } }, names)).toBe('when is Ben back?');
    expect(templateText({ ...base, intent: { kind: 'at_time', aboutMs: localMs(0, 19 * 60 + 30) } }, names)).toBe('will Ben be home at 7:30pm?');
    expect(templateText({ ...base, intent: { kind: 'at_time', aboutMs: localMs(1, 9 * 60) } }, names)).toBe('will Ben be home at 9am tomorrow?');
    expect(templateText({ ...base, intent: { kind: 'at_time', aboutMs: localMs(0, 14 * 60) } }, names)).toBe('was Ben home at 2pm?');
  });
});

describe('generateTexts', () => {
  const few = qs.slice(0, 3);
  const stub = (replies: (string | Error)[]) => {
    let i = 0;
    const calls: unknown[] = [];
    const client = { messages: { create: async (p: unknown) => {
      calls.push(p);
      const r = replies[i++ % replies.length];
      if (r instanceof Error) throw r;
      return { content: [{ type: 'text', text: r }] };
    } } } as unknown as Anthropic;
    return { client, calls };
  };
  const dir = () => mkdtempSync(join(tmpdir(), 'sim-q-'));

  it('phrases uncached questions, writes the cache, and reuses it without calling the model', async () => {
    const cachePath = join(dir(), 'cache.json');
    const a = stub(['  yo is ben home  ']);
    const out = await generateTexts(few, { client: a.client, model: 'm', cachePath, names });
    expect(a.calls).toHaveLength(3);
    expect(out.map((q) => q.text)).toEqual(['yo is ben home', 'yo is ben home', 'yo is ben home']);
    expect(out.every((q) => q.style !== 'template' && !q.error)).toBe(true);
    expect(Object.keys(JSON.parse(readFileSync(cachePath, 'utf8')))).toHaveLength(3);

    const b = stub(['other']);
    const again = await generateTexts(few, { client: b.client, model: 'm', cachePath, names });
    expect(b.calls).toHaveLength(0);
    expect(again).toEqual(out);
  });

  it('records an error and keeps the template text when the model returns nothing or fails, and does not cache it', async () => {
    const cachePath = join(dir(), 'cache.json');
    writeFileSync(cachePath, '{}');
    const out = await generateTexts(few.slice(0, 2), { client: stub(['   ', new Error('overloaded')]).client, model: 'm', cachePath, names });
    expect(out.map((q) => q.error)).toEqual(['empty', 'overloaded']);
    expect(out.map((q) => q.text)).toEqual(few.slice(0, 2).map((q) => templateText(q, names)));
    expect(JSON.parse(readFileSync(cachePath, 'utf8'))).toEqual({});
  });

  it('never tells the generator anything about the target beyond the question intent', async () => {
    const a = stub(['ok']);
    await generateTexts(few.slice(0, 1), { client: a.client, model: 'm', cachePath: join(dir(), 'c.json'), names });
    const sent = JSON.stringify(a.calls[0]);
    for (const leak of ['09:00', '17:00', 'stale', 'nine_to_five', 'block', 'schedule']) expect(sent).not.toContain(leak);
  });
});

