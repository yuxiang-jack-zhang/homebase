import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { anthropicModel } from './anthropic.ts';

const schema = z.object({ kind: z.string() });
const resp = (o: Record<string, unknown>) => ({
  model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 }, content: [], ...o,
});
const stub = (r: unknown) => {
  const calls: Record<string, unknown>[] = [];
  const fn = async (params: Record<string, unknown>) => {
    calls.push(params);
    if (r instanceof Error) throw r;
    return r;
  };
  return { calls, client: { beta: { messages: { parse: fn, create: fn } } } as unknown as Anthropic };
};
const req = { system: 'SYS', user: 'USER', schema };

describe('anthropicModel', () => {
  it('parse success -> parsed value and mapped usage', async () => {
    const { client, calls } = stub(resp({ parsed_output: { kind: 'now' } }));
    const r = await anthropicModel(client).parse(req);
    expect(r.value).toEqual({ kind: 'now' });
    expect(r.usage).toMatchObject({ inputTokens: 10, outputTokens: 5, model: 'claude-opus-5-5' });
    expect(r.usage.latencyMs).toBeGreaterThanOrEqual(0);
    expect(calls[0]).toMatchObject({
      model: 'claude-opus-5-5', max_tokens: 4096, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      output_config: { effort: 'low' }, messages: [{ role: 'user', content: 'USER' }],
    });
    expect(JSON.stringify(calls[0].system)).toContain('SYS');
  });

  it('write success -> concatenated text blocks, ignoring others', async () => {
    const content = [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Sam is ' }, { type: 'text', text: 'home.' }];
    const r = await anthropicModel(stub(resp({ content })).client, 'claude-test').write(req);
    expect(r.text).toBe('Sam is home.');
    expect(r.usage).toMatchObject({ inputTokens: 10, outputTokens: 5, model: 'claude-opus-5-5' });
  });

  it.each([
    ['refusal', resp({ stop_reason: 'refusal', parsed_output: { kind: 'now' }, content: [{ type: 'text', text: 'x' }] })],
    ['max_tokens', resp({ stop_reason: 'max_tokens', parsed_output: { kind: 'now' }, content: [{ type: 'text', text: 'x' }] })],
    ['thrown error', new Error('boom')],
  ])('%s -> null, never throws', async (_, r) => {
    const m = anthropicModel(stub(r).client);
    const p = await m.parse(req);
    const w = await m.write(req);
    expect(p.value).toBeNull();
    expect(w.text).toBeNull();
    expect(p.usage.model).toBe('claude-opus-5-5');
  });
});
