import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { keywordFakeModel } from './model.ts';

const NOW = '2027-01-05T12:00:00.000Z';
const schema = z.unknown();
const parse = async (text: string) =>
  (await keywordFakeModel().parse({ system: 'S', user: `Current local time: ${NOW}\n<question>\n${text}\n</question>`, schema })).value;

describe('keywordFakeModel', () => {
  it.each([
    ['will Sam be home at 7', 'at_time'],
    ['home tonight?', 'at_time'],
    ['back in an hour?', 'at_time'],
    ['when is Sam back', 'until_when'],
    ['is Sam home', 'now'],
    ['what is for dinner', 'unclear'],
  ])('%s -> %s', async (text, kind) => {
    expect(await parse(text)).toMatchObject({ kind });
  });

  it('at_time questions get a time two hours after the real clock', async () => {
    const before = Date.now();
    const v = (await parse('home at 7?')) as { aboutTime: string };
    const t = Date.parse(v.aboutTime);
    expect(t - before).toBeGreaterThanOrEqual(2 * 3_600_000);
    expect(t - Date.now()).toBeLessThanOrEqual(2 * 3_600_000);
  });

  it('past-tense questions (was/were) get a time two hours before the real clock', async () => {
    const before = Date.now();
    const v = (await parse('was Sam home at 3?')) as { kind: string; aboutTime: string };
    expect(v.kind).toBe('at_time');
    expect(before - Date.parse(v.aboutTime)).toBeGreaterThanOrEqual(2 * 3_600_000 - 1000);
    expect(Date.now() - Date.parse(v.aboutTime)).toBeLessThanOrEqual(2 * 3_600_000 + 1000);
  });

  it('only reads the question, not the rest of the prompt', async () => {
    const r = await keywordFakeModel().parse({ system: 'home when back at tonight', user: '<question>\nwhat is for dinner\n</question>', schema });
    expect(r.value).toEqual({ kind: 'unclear', aboutTime: null });
  });

  it('write states the facts it was given, so the writer check accepts it', async () => {
    const m = keywordFakeModel();
    const at = await m.write({ system: 'A', user: 'Roommate: Sam\nAbout time: 7:00 PM\nPredicted state: away\nPredicted time: n/a' });
    const now = await m.write({ system: 'B', user: 'Roommate: Sam\nAbout time: n/a\nPredicted state: home\nPredicted time: n/a' });
    expect(at.text).toBe('Fake model: away at 7:00 PM.');
    expect(now.text).toBe('Fake model: home.');
  });
});
