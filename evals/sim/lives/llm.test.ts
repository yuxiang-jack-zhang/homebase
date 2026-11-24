import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { fakeModel } from '../../../packages/core/src/agent/model.ts';
import { cachedModel, makeLlm, scriptedLlm } from './llm.ts';

const schema = z.object({ n: z.number() });
const tmp = () => join(mkdtempSync(join(tmpdir(), 'lives-llm-')), 'cache.jsonl');
const usage = { input_tokens: 10, output_tokens: 2 };

function stubClient(outputs: unknown[]) {
  const calls: Record<string, unknown>[] = [];
  let i = 0;
  const parse = async (p: Record<string, unknown>) => {
    calls.push(p);
    return { model: 'claude-sonnet-5-5', stop_reason: 'end_turn', usage, parsed_output: outputs[i++ % outputs.length] };
  };
  return { calls, client: { beta: { messages: { parse } } } as unknown as Anthropic };
}

describe('makeLlm', () => {
  it('calls the model once per distinct request and replays from the cache, also after reload', async () => {
    const cachePath = tmp();
    const s = stubClient([{ n: 1 }]);
    const llm = makeLlm({ client: s.client, model: 'claude-sonnet-5-5', cachePath });
    const req = { name: 'plan', system: 'S', user: 'U', schema };
    expect(await llm.call(req)).toEqual({ n: 1 });
    expect(await llm.call(req)).toEqual({ n: 1 });
    expect(s.calls).toHaveLength(1);
    expect(llm.calls).toBe(1);
    expect(llm.usage).toHaveLength(2); // replays report the original usage, so a replayed run's cost matches
    await llm.call({ ...req, user: 'U2' });
    await llm.call({ ...req, name: 'other' });
    expect(s.calls).toHaveLength(3);

    const again = stubClient([{ n: 9 }]);
    const reloaded = makeLlm({ client: again.client, model: 'claude-sonnet-5-5', cachePath });
    expect(await reloaded.call(req)).toEqual({ n: 1 });
    expect(again.calls).toHaveLength(0);
    expect(readFileSync(cachePath, 'utf8').trim().split('\n')).toHaveLength(3);
  });

  it('retries invalid output once, then gives null; both attempts are cached', async () => {
    const cachePath = tmp();
    const s = stubClient([{ n: 'no' }, null]);
    const llm = makeLlm({ client: s.client, model: 'm', cachePath });
    expect(await llm.call({ name: 'plan', system: 'S', user: 'U', schema })).toBeNull();
    expect(s.calls).toHaveLength(2);
    const replay = stubClient([{ n: 5 }]);
    expect(await makeLlm({ client: replay.client, model: 'm', cachePath }).call({ name: 'plan', system: 'S', user: 'U', schema })).toBeNull();
    expect(replay.calls).toHaveLength(0);
  });

  it('a thrown API error counts as invalid output (retried once, never cached)', async () => {
    let n = 0;
    const client = { beta: { messages: { parse: async () => { n++; throw new Error('overloaded'); } } } } as unknown as Anthropic;
    const cachePath = tmp();
    expect(await makeLlm({ client, model: 'm', cachePath }).call({ name: 'x', system: 'S', user: 'U', schema })).toBeNull();
    expect(n).toBe(2);
    expect(() => readFileSync(cachePath, 'utf8')).toThrow(); // nothing written
  });
});

describe('scriptedLlm', () => {
  it('answers from the handler and validates against the schema', async () => {
    const llm = scriptedLlm((name) => (name === 'ok' ? { n: 3 } : { n: 'bad' }));
    expect(await llm.call({ name: 'ok', system: '', user: '', schema })).toEqual({ n: 3 });
    expect(await llm.call({ name: 'bad', system: '', user: '', schema })).toBeNull();
  });
});

describe('cachedModel', () => {
  it('replays parse and write results with their usage', async () => {
    const cachePath = tmp();
    const inner = fakeModel({ parse: { kind: 'now', aboutTime: null }, write: 'Sam is home.' });
    const m = cachedModel(inner, 'claude-haiku-5-5', cachePath);
    const p1 = await m.parse({ system: 'S', user: 'U', schema: z.any() });
    const w1 = await m.write({ system: 'S', user: 'U' });
    const m2 = cachedModel(fakeModel({ parse: null, write: null }), 'claude-haiku-5-5', cachePath);
    expect(await m2.parse({ system: 'S', user: 'U', schema: z.any() })).toEqual(p1);
    expect(await m2.write({ system: 'S', user: 'U' })).toEqual(w1);
    expect(inner.calls).toHaveLength(2);
  });
});
