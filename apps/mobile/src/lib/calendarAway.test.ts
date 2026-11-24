import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Calendar from 'expo-calendar';
import { AWAY_CALENDARS_KEY, clearCalendarAway, loadAwayCalendars, saveAwayCalendars, syncCalendarAway, toPeriods } from './calendarAway';
import { supabase } from './supabase';

jest.mock('expo-calendar', () => ({
  EntityTypes: { EVENT: 'event' },
  getCalendarPermissions: jest.fn(),
  getCalendars: jest.fn(),
  listEvents: jest.fn(),
}));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('./supabase', () => ({ supabase: { rpc: jest.fn() } }));
const rpc = jest.mocked(supabase.rpc);

const NOW = new Date('2027-01-20T12:00:00.000Z');
const H = 3_600_000;
const t = (h: number) => new Date(NOW.getTime() + h * H).toISOString();
const timed = (from: number, to: number) => ({ startDate: t(from), endDate: t(to), allDay: false });

describe('toPeriods', () => {
  it('skips all-day events and keeps only start and end', () => {
    expect(toPeriods([{ ...timed(0, 24), allDay: true }, timed(2, 3)], NOW)).toEqual([{ start: t(2), end: t(3) }]);
  });

  it('drops a multi-day event already under way instead of clipping it to a short period (a trip says nothing)', () => {
    expect(toPeriods([timed(-48, 20), timed(30, 31)], NOW)).toEqual([{ start: t(30), end: t(31) }]);
  });

  it('skips events marked free and cancelled events', () => {
    expect(toPeriods([{ ...timed(1, 2), availability: 'free' }, { ...timed(3, 4), status: 'canceled' }, { ...timed(5, 6), availability: 'busy' }], NOW))
      .toEqual([{ start: t(5), end: t(6) }]);
  });

  it('clips to the next 14 days and drops what falls outside', () => {
    expect(toPeriods([timed(-2, 1), timed(-5, -4), timed(14 * 24 - 1, 14 * 24 + 5), timed(15 * 24, 15 * 24 + 1)], NOW))
      .toEqual([{ start: t(0), end: t(1) }, { start: t(14 * 24 - 1), end: t(14 * 24) }]);
  });

  it('merges overlapping and touching events, in time order, whatever the input order', () => {
    expect(toPeriods([timed(10, 12), timed(1, 3), timed(2, 4), timed(4, 5), timed(11, 11.5)], NOW))
      .toEqual([{ start: t(1), end: t(5) }, { start: t(10), end: t(12) }]);
  });

  it('drops periods under a minute or over 24 hours (the server rejects them)', () => {
    const tiny = { startDate: t(1), endDate: new Date(NOW.getTime() + H + 30_000).toISOString(), allDay: false };
    expect(toPeriods([tiny, timed(2, 2), timed(30, 30 + 25), timed(5, 29)], NOW)).toEqual([{ start: t(5), end: t(29) }]);
  });

  it('accepts Date objects and keeps the earliest 200', () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ startDate: new Date(NOW.getTime() + i * H), endDate: new Date(NOW.getTime() + i * H + H / 2), allDay: false }));
    const out = toPeriods(many, NOW);
    expect(out).toHaveLength(200);
    expect(out[0]).toEqual({ start: t(0), end: t(0.5) });
  });
});

describe('clearCalendarAway (sign-out)', () => {
  beforeEach(async () => { await AsyncStorage.clear(); rpc.mockReset().mockResolvedValue({ error: null } as never); });

  it("clears what was shared on the server and this device's choice", async () => {
    await saveAwayCalendars(['work']);
    await clearCalendarAway();
    expect(rpc).toHaveBeenCalledWith('sync_calendar_away', { p_periods: [] });
    expect(await loadAwayCalendars()).toBeNull();
  });

  it('still forgets the local choice when the server call fails', async () => {
    await saveAwayCalendars(['work']);
    rpc.mockResolvedValue({ error: { message: 'offline' } } as never);
    await clearCalendarAway();
    expect(await loadAwayCalendars()).toBeNull();
  });
});

describe('syncCalendarAway', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    rpc.mockReset().mockResolvedValue({ error: null } as never);
    jest.mocked(Calendar.getCalendarPermissions).mockResolvedValue({ granted: true } as never);
    jest.mocked(Calendar.getCalendars).mockResolvedValue([{ id: 'work' }, { id: 'home' }] as never);
    jest.mocked(Calendar.listEvents).mockReset().mockResolvedValue([
      // Relative to the real clock: sync reads from now.
      { startDate: new Date(Date.now() + H), endDate: new Date(Date.now() + 2 * H), allDay: false, title: 'Dentist', location: 'Main St', notes: 'secret' },
    ] as never);
  });

  it('does nothing until calendars are set up on this device', async () => {
    await syncCalendarAway();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends only the chosen calendars' start and end times", async () => {
    await AsyncStorage.setItem(AWAY_CALENDARS_KEY, JSON.stringify(['work', 'deleted']));
    await syncCalendarAway();
    expect(Calendar.listEvents).toHaveBeenCalledWith(['work'], expect.any(Date), expect.any(Date));
    const [[name, args]] = rpc.mock.calls;
    expect(name).toBe('sync_calendar_away');
    expect(JSON.stringify(args)).not.toMatch(/Dentist|Main St|secret/);
    const [p] = (args as { p_periods: { start: string; end: string }[] }).p_periods;
    expect(Object.keys(p)).toEqual(['start', 'end']);
  });

  it('clears what was shared when nothing is chosen, every chosen calendar is gone, or permission was revoked', async () => {
    for (const setup of [
      () => AsyncStorage.setItem(AWAY_CALENDARS_KEY, '[]'),
      // An empty id list would make EventKit search every calendar, so listEvents must not be called at all.
      () => AsyncStorage.setItem(AWAY_CALENDARS_KEY, '["deleted"]'),
      async () => {
        await AsyncStorage.setItem(AWAY_CALENDARS_KEY, '["work"]');
        jest.mocked(Calendar.getCalendarPermissions).mockResolvedValue({ granted: false } as never);
      },
    ]) {
      rpc.mockClear();
      await setup();
      await syncCalendarAway();
      expect(rpc).toHaveBeenCalledWith('sync_calendar_away', { p_periods: [] });
    }
    expect(Calendar.listEvents).not.toHaveBeenCalled();
  });

  it('throws the server error', async () => {
    await AsyncStorage.setItem(AWAY_CALENDARS_KEY, '["work"]');
    rpc.mockResolvedValue({ error: { message: 'invalid_periods' } } as never);
    await expect(syncCalendarAway()).rejects.toEqual({ message: 'invalid_periods' });
  });
});

