import { describe, expect, it } from 'vitest';
import { errorSummary } from './http.ts';

describe('errorSummary', () => {
  it('keeps code and message of a Postgres error, drops the failing row in details and hint', () => {
    const pg = {
      code: '23514', message: 'new row for relation "responses" violates check constraint "responses_text_check"',
      details: 'Failing row contains (…, my secret reply text, …).', hint: 'Sam is at therapy',
    };
    const s = errorSummary(pg);
    expect(s).toEqual({ name: undefined, code: '23514', message: pg.message });
    expect(JSON.stringify(s)).not.toMatch(/secret|therapy/);
  });

  it('keeps name and message of an Error, not its other fields', () => {
    const e = Object.assign(new TypeError('boom'), { row: 'question text' });
    expect(errorSummary(e)).toEqual({ name: 'TypeError', code: undefined, message: 'boom' });
  });

  it('handles strings, null and non-string fields', () => {
    expect(errorSummary('plain')).toEqual({ name: undefined, code: undefined, message: 'plain' });
    expect(errorSummary(null)).toEqual({ name: undefined, code: undefined, message: undefined });
    expect(errorSummary({ code: 42, message: { text: 'x' } })).toEqual({ name: undefined, code: undefined, message: undefined });
  });
});
