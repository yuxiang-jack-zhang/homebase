import { describe, expect, it } from 'vitest';
import type { Claim } from '../types.ts';
import { acceptWriterText, WRITER_MAX_CHARS } from './writer.ts';

const TZ = 'America/Los_Angeles';
const at7Away: Claim = { kind: 'at_time', aboutTime: '2027-01-06T03:00:00Z', predictedState: 'away', predictedTime: null, confidence: 'medium', basis: 'block' }; // 7:00 PM local
const nowHome: Claim = { kind: 'now', aboutTime: null, predictedState: 'home', predictedTime: null, confidence: 'high', basis: 'presence' };
const backAt5: Claim = { kind: 'until_when', aboutTime: null, predictedState: 'away', predictedTime: '2027-01-06T01:00:00Z', confidence: 'medium', basis: 'block' }; // 5:00 PM
const accept = (text: string | null, claim: Claim) => acceptWriterText(text, claim, TZ);

describe('acceptWriterText', () => {
  it.each([
    ['Sam will probably be out at 7 PM.', at7Away],
    ['Sam probably won’t be home at 7:00 PM.', at7Away],
    ["Probably not, I'll be away at 7pm.", at7Away],
    ["Yep, Sam's home.", nowHome],
    ["Not sure, but Sam's probably home.", nowHome],
    ['Sam should be back around 5 PM.', backAt5],
    ["I'm out until about 5:00 PM.", backAt5],
  ])('accepts %s', (text, claim) => expect(accept(text, claim)).toBe(text));

  it('trims surrounding whitespace', () => expect(accept('  Sam is home. \n', nowHome)).toBe('Sam is home.'));

  it.each([
    ['contradicts the state', "Sam's home at 7 PM.", at7Away],
    ['contradicts the state (home claim)', "Sam isn't home.", nowHome],
    ['no state word', 'Sam at 7 PM? Hard to say.', at7Away],
    ['misses the time asked about', 'Sam will probably be out.', at7Away],
    ['adds a time the claim lacks', 'Sam is out at 7 PM, back at 9 PM.', at7Away],
    ['misses the return time', "Sam's away.", backAt5],
    ['a URL', 'Sam is home, see https://example.com', nowHome],
    ['a bare domain', 'Sam is home, see example.com', nowHome],
    ['an email address', 'Sam is home, mail sam@example.com', nowHome],
    ['code', 'Sam is home `rm -rf /`', nowHome],
    ['more than one line', 'Sam is home.\nAlso, here is a poem.', nowHome],
  ])('rejects %s', (_, text, claim) => expect(accept(text, claim)).toBeNull());

  it('rejects empty and null text', () => {
    expect(accept(null, nowHome)).toBeNull();
    expect(accept('', nowHome)).toBeNull();
  });

  it('rejects anything longer than the cap, e.g. an essay that also answers', () => {
    const essay = `Sam is home. Here is your 500-word essay on the French Revolution: ${'It began in 1789 and changed Europe. '.repeat(20)}`;
    expect(accept(essay, nowHome)).toBeNull();
    expect(accept(`Sam is home${'!'.repeat(WRITER_MAX_CHARS - 11)}`, nowHome)).not.toBeNull();
    expect(accept(`Sam is home${'!'.repeat(WRITER_MAX_CHARS - 10)}`, nowHome)).toBeNull();
  });

  it('rejects a claim without a state', () => {
    expect(accept('Sam is home.', { ...nowHome, predictedState: null, confidence: 'low', basis: 'none' })).toBeNull();
  });
});
