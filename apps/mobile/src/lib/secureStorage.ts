import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

// A keychain value over 2048 bytes may be rejected. 512 code points is at most 2048 UTF-8 bytes.
const CHUNK = 512;
// The geofence task reads the session headless, often while the phone is locked; the default
// (WHEN_UNLOCKED) would drop those events. THIS_DEVICE_ONLY keeps the token out of backups.
const OPTS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

const count = async (key: string) => Number(await SecureStore.getItemAsync(key, OPTS)) || 0;

async function read(key: string) {
  const n = await count(key);
  if (n === 0) return null;
  const parts = await Promise.all(Array.from({ length: n }, (_, i) => SecureStore.getItemAsync(`${key}.${i}`, OPTS)));
  return parts.includes(null) ? null : parts.join('');
}

async function deleteChunks(key: string, from: number, to: number) {
  for (let i = from; i < to; i++) await SecureStore.deleteItemAsync(`${key}.${i}`, OPTS);
}

/** supabase-js session storage in the iOS keychain: `key` holds the chunk count, `key.N` the chunks. */
export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const value = await read(key);
    if (value !== null) return value;
    // One-time move of a session an older build saved in AsyncStorage, so updating doesn't sign anyone out.
    const old = await AsyncStorage.getItem(key);
    if (old === null) return null;
    await secureStorage.setItem(key, old);
    await AsyncStorage.removeItem(key);
    return old;
  },

  async setItem(key: string, value: string) {
    const points = Array.from(value);
    const n = Math.ceil(points.length / CHUNK);
    const old = await count(key);
    for (let i = 0; i < n; i++) {
      await SecureStore.setItemAsync(`${key}.${i}`, points.slice(i * CHUNK, (i + 1) * CHUNK).join(''), OPTS);
    }
    await SecureStore.setItemAsync(key, String(n), OPTS);
    await deleteChunks(key, n, old);
  },

  async removeItem(key: string) {
    await deleteChunks(key, 0, await count(key));
    await SecureStore.deleteItemAsync(key, OPTS);
  },
};
