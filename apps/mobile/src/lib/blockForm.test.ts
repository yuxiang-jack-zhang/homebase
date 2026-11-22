import { crossesMidnight, validateBlock } from './blockForm';

const ok = { days: [1, 3], start: '09:00', end: '17:30', label: ' Work ' };

test('accepts a valid block and trims the label', () => {
  expect(validateBlock(ok)).toEqual({
    ok: true,
    value: { days_of_week: [1, 3], start_local: '09:00', end_local: '17:30', label: 'Work' },
  });
});

test('rejects bad input', () => {
  expect(validateBlock({ ...ok, days: [] }).ok).toBe(false);
  expect(validateBlock({ ...ok, start: '9am' }).ok).toBe(false);
  expect(validateBlock({ ...ok, end: '24:00' }).ok).toBe(false);
  expect(validateBlock({ ...ok, end: '09:00' }).ok).toBe(false);
  expect(validateBlock({ ...ok, label: 'x'.repeat(41) }).ok).toBe(false);
});

test('empty label becomes null; midnight crossing detected', () => {
  const r = validateBlock({ ...ok, label: '  ' });
  expect(r.ok && r.value.label).toBeNull();
  expect(crossesMidnight('22:00', '06:00')).toBe(true);
  expect(crossesMidnight('09:00', '17:00')).toBe(false);
  expect(crossesMidnight('bad', '17:00')).toBe(false);
});
