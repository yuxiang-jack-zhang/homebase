import { AppState } from 'react-native';
import { subscribeLive } from './live';
import { supabase } from './supabase';

jest.mock('./supabase', () => ({ supabase: { removeChannel: jest.fn() } }));

function fakeChannel() {
  let cb: (status: string) => void = () => {};
  const channel = { subscribe: jest.fn((f: typeof cb): unknown => { cb = f; return channel; }) };
  return { channel, status: (s: string) => cb(s) };
}

let appStateCb: (s: string) => void;
const remove = jest.fn();
beforeEach(() => {
  remove.mockReset();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_e, f) => {
    appStateCb = f as typeof appStateCb;
    return { remove };
  });
});

test('reloads on every re-join after the first, not on errors', () => {
  const { channel, status } = fakeChannel();
  const resync = jest.fn();
  subscribeLive(channel as never, resync);
  status('SUBSCRIBED');
  expect(resync).not.toHaveBeenCalled(); // first join: the caller already loaded
  status('CHANNEL_ERROR');
  status('TIMED_OUT');
  expect(resync).not.toHaveBeenCalled();
  status('SUBSCRIBED');
  status('SUBSCRIBED');
  expect(resync).toHaveBeenCalledTimes(2);
});

test('reloads when the app comes to the foreground', () => {
  const resync = jest.fn();
  subscribeLive(fakeChannel().channel as never, resync);
  appStateCb('background');
  expect(resync).not.toHaveBeenCalled();
  appStateCb('active');
  expect(resync).toHaveBeenCalledTimes(1);
});

test('cleanup removes the listener and the channel', () => {
  const { channel } = fakeChannel();
  subscribeLive(channel as never, jest.fn())();
  expect(remove).toHaveBeenCalled();
  expect(supabase.removeChannel).toHaveBeenCalledWith(channel);
});
