import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { secureStorage } from './secureStorage';

const mockKeychain = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'afterFirstUnlockThisDeviceOnly',
  getItemAsync: jest.fn(async (k: string) => mockKeychain.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    if (new TextEncoder().encode(v).length > 2048) throw new Error('value too large');
    mockKeychain.set(k, v);
  }),
  deleteItemAsync: jest.fn(async (k: string) => { mockKeychain.delete(k); }),
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const KEY = 'sb-abc-auth-token';
// A session-sized value with multi-byte characters, so chunks must stay under 2048 bytes, not characters.
const big = JSON.stringify({ access_token: 'x'.repeat(3000), user: { display_name: 'Zoë 🏠'.repeat(300) } });

beforeEach(async () => {
  mockKeychain.clear();
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

test('round-trips a value larger than one mockKeychain item', async () => {
  await secureStorage.setItem(KEY, big);
  expect(mockKeychain.size).toBeGreaterThan(2);
  expect(await secureStorage.getItem(KEY)).toBe(big);
});

test('a shorter value replaces a longer one and leaves no stale chunks', async () => {
  await secureStorage.setItem(KEY, big);
  await secureStorage.setItem(KEY, 'short');
  expect(await secureStorage.getItem(KEY)).toBe('short');
  expect([...mockKeychain.keys()].sort()).toEqual([KEY, `${KEY}.0`]);
});

test('removeItem deletes every chunk', async () => {
  await secureStorage.setItem(KEY, big);
  await secureStorage.removeItem(KEY);
  expect(mockKeychain.size).toBe(0);
  expect(await secureStorage.getItem(KEY)).toBeNull();
});

test('stays readable while the phone is locked after first unlock (the geofence task runs headless)', async () => {
  await secureStorage.setItem(KEY, 'v');
  for (const call of jest.mocked(SecureStore.setItemAsync).mock.calls) {
    expect(call[2]).toEqual({ keychainAccessible: 'afterFirstUnlockThisDeviceOnly' });
  }
});

test('moves a session saved in AsyncStorage by an older build into the mockKeychain, once', async () => {
  await AsyncStorage.setItem(KEY, big);
  expect(await secureStorage.getItem(KEY)).toBe(big);
  expect(await AsyncStorage.getItem(KEY)).toBeNull();
  expect(await secureStorage.getItem(KEY)).toBe(big);
  expect(await secureStorage.getItem('missing')).toBeNull();
});
