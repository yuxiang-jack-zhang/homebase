import { friendlyError, geofenceError } from './errors';

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

test('maps every edge-function error code', () => {
  expect(friendlyError({ message: 'internal_error' })).toMatch(/server/i);
  expect(friendlyError({ message: 'invalid_request' })).toMatch(/valid/i);
  expect(friendlyError({ message: 'unauthorized' })).toMatch(/sign in/i);
  expect(friendlyError({ message: 'forbidden' })).toMatch(/access/i);
  expect(friendlyError({ message: 'method_not_allowed' })).toMatch(/update the app/i);
});

test('maps a request that never reached the server', () => {
  expect(friendlyError({ message: 'Failed to send a request to the Edge Function' })).toMatch(/couldn't reach the server/i);
});

test('geofenceError hides the raw Expo message', () => {
  const raw = new Error("Calling the 'startGeofencingAsync' function has failed\n→ Caused by: Geofencing is not available");
  expect(geofenceError(raw)).toBe("Location tracking isn't available on this device.");
  expect(geofenceError(new Error('internal_error'))).toMatch(/server/i);
  expect(geofenceError('boom')).toBe('boom');
});
