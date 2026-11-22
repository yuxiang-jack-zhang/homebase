import { accuracyRows } from './stats';

const r = (kind: string, correct: number, incorrect: number, unscored = 0) => ({ kind, correct, incorrect, unscored });

test('per-kind counts and accuracy, overall aggregates', () => {
  const { rows, overall } = accuracyRows([r('until_when', 1, 1, 2), r('at_time', 3, 1, 0)]);
  expect(rows.map((x) => x.kind)).toEqual(['at_time', 'until_when']); // stable order
  expect(rows[0]).toMatchObject({ label: 'At a time', correct: 3, incorrect: 1, unscored: 0, accuracy: '75%' });
  expect(rows[1].accuracy).toBe('50%');
  expect(overall).toMatchObject({ correct: 4, incorrect: 2, unscored: 2, accuracy: '67%' });
});

test('nothing scored shows a dash', () => {
  const { rows, overall } = accuracyRows([r('at_time', 0, 0, 5)]);
  expect(rows[0].accuracy).toBe('—');
  expect(overall).toMatchObject({ unscored: 5, accuracy: '—' });
});

test('rounds to a whole percent', () => {
  expect(accuracyRows([r('at_time', 1, 2)]).overall.accuracy).toBe('33%');
  expect(accuracyRows([r('at_time', 2, 1)]).overall.accuracy).toBe('67%');
});

test('shows unknown kinds and handles empty', () => {
  expect(accuracyRows([r('now', 1, 0)]).rows[0].label).toBe('now');
  expect(accuracyRows([]).rows).toEqual([]);
});
