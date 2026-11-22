import { friendlyError } from './errors';

test('maps known RPC codes', () => {
  expect(friendlyError({ message: 'invalid_invite_code' })).toMatch(/invite code/i);
  expect(friendlyError({ message: 'already_member' })).toMatch(/already/i);
  expect(friendlyError({ message: 'not_owner' })).toMatch(/owner/i);
  expect(friendlyError({ message: 'invalid_name' })).toMatch(/name/i);
  expect(friendlyError({ message: 'invalid_location' })).toMatch(/location/i);
});

test('falls back for unknown or missing errors', () => {
  expect(friendlyError({ message: 'boom' })).toBe('boom');
  expect(friendlyError(null)).toMatch(/something went wrong/i);
});

test('maps client transport codes', () => {
  expect(friendlyError({ message: 'bad_response' })).toMatch(/unexpected/i);
  expect(friendlyError({ message: 'http_502' })).toMatch(/server/i);
});
