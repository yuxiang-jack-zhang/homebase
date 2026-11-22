import { categoryFor, newTargets, notifyDecision, responseToReply, seedOnFirstRun, targetLines } from './questionLogic';

const NOW = Date.parse('2026-11-22T12:00:00Z');
const T = '44444444-4444-4444-8444-444444444444';

test('targetLines is time-dependent only for awaiting_reply', () => {
  const base = { name: 'Bea', text: null, fallback_guess: 'maybe' };
  const at = (min: number) => new Date(NOW - min * 60_000).toISOString();
  expect(targetLines({ ...base, status: 'awaiting_reply', created_at: at(10) }, NOW)).toEqual(['Asked Bea — waiting…']);
  expect(targetLines({ ...base, status: 'awaiting_reply', created_at: at(10.1) }, NOW)).toEqual(['No reply yet', 'maybe']);
  expect(targetLines({ ...base, status: 'unknown', created_at: at(99) }, NOW)).toEqual(['Bea: unknown']);
});

test('categoryFor picks the category by draft presence', () => {
  expect(categoryFor('draft')).toBe('question');
  expect(categoryFor(null)).toBe('question_nodraft');
});

test('responseToReply maps notification actions', () => {
  expect(responseToReply(T, 'approve')).toEqual({ questionTargetId: T, action: 'approve' });
  expect(responseToReply(T, 'yes')).toEqual({ questionTargetId: T, action: 'yes' });
  expect(responseToReply(T, 'no')).toEqual({ questionTargetId: T, action: 'no' });
  expect(responseToReply(T, 'text', ' back at 8 ')).toEqual({ questionTargetId: T, action: 'text', text: 'back at 8' });
  expect(responseToReply(T, 'text', '  ')).toBeNull();
  expect(responseToReply(T, 'expo.modules.notifications.actions.DEFAULT')).toBeNull();
});

test('newTargets skips already-notified ids', () => {
  expect(newTargets([{ id: 'a' }, { id: 'b' }], new Set(['a']))).toEqual([{ id: 'b' }]);
});

describe('notifyDecision', () => {
  const at = (s: number) => new Date(NOW - s * 1000).toISOString();
  test('draft present notifies at once', () => expect(notifyDecision({ draft: 'x', created_at: at(0) }, NOW)).toBe('notify'));
  test('no draft and young waits', () => expect(notifyDecision({ draft: null, created_at: at(3) }, NOW)).toBe('wait'));
  test('no draft and old notifies', () => expect(notifyDecision({ draft: null, created_at: at(6) }, NOW)).toBe('notify'));
});

describe('seedOnFirstRun', () => {
  const at = (min: number) => new Date(NOW - min * 60_000).toISOString();
  const items = [{ id: 'old', created_at: at(30) }, { id: 'fresh', created_at: at(2) }];
  test('first run silently seeds only old items', () => expect(seedOnFirstRun(items, true, NOW)).toEqual(['old']));
  test('later runs seed nothing', () => expect(seedOnFirstRun(items, false, NOW)).toEqual([]));
});
