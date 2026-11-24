import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Calendar from 'expo-calendar';
import { Alert, type AlertButton } from 'react-native';
import { AWAY_CALENDARS_KEY, syncCalendarAway } from '../lib/calendarAway';
import { AwayCalendars } from './AwayCalendars';

jest.mock('expo-calendar', () => ({
  EntityTypes: { EVENT: 'event' },
  getCalendarPermissions: jest.fn(),
  requestCalendarPermissions: jest.fn(),
  getCalendars: jest.fn(),
}));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../lib/calendarAway', () => ({
  ...jest.requireActual('../lib/calendarAway'),
  syncCalendarAway: jest.fn(),
}));
jest.mock('../lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));

const undetermined = { granted: false, canAskAgain: true, status: 'undetermined' };
const granted = { granted: true, canAskAgain: true, status: 'granted' };
const alert = jest.spyOn(Alert, 'alert');
/** Presses a button of the last dialog. */
const press = async (text: string) => {
  const buttons = alert.mock.calls.at(-1)![2] as AlertButton[];
  await act(async () => buttons.find((b) => b.text === text)!.onPress!());
};

beforeEach(async () => {
  await AsyncStorage.clear();
  alert.mockReset().mockImplementation(() => {});
  jest.mocked(syncCalendarAway).mockReset().mockResolvedValue();
  jest.mocked(Calendar.getCalendarPermissions).mockResolvedValue(undetermined as never);
  jest.mocked(Calendar.requestCalendarPermissions).mockReset().mockResolvedValue(granted as never);
  jest.mocked(Calendar.getCalendars).mockResolvedValue([{ id: 'work', title: 'Work' }, { id: 'family', title: 'Family' }] as never);
});

test('says that only start and end times are shared', async () => {
  await render(<AwayCalendars />);
  expect(await screen.findByText(/Only start and end times are shared; titles stay on your phone\./)).toBeTruthy();
});

test('explains once before the permission prompt, then lists calendars', async () => {
  await render(<AwayCalendars />);
  // The press waits on the dialog, so it settles only after a dialog button is pressed.
  const pressing = fireEvent.press(await screen.findByRole('button', { name: 'Choose calendars' }));
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
  expect(alert.mock.calls[0][1]).toMatch(/start and end times/);
  await press('Not now');
  await pressing;
  expect(Calendar.requestCalendarPermissions).not.toHaveBeenCalled();

  // Second time (even after "Not now"): straight to the iOS prompt.
  await fireEvent.press(screen.getByRole('button', { name: 'Choose calendars' }));
  expect(await screen.findByLabelText('Work')).toBeTruthy();
  expect(alert).toHaveBeenCalledTimes(1);
  expect(Calendar.requestCalendarPermissions).toHaveBeenCalledTimes(1);
});

test('toggles persist on the phone and sync', async () => {
  jest.mocked(Calendar.getCalendarPermissions).mockResolvedValue(granted as never);
  await render(<AwayCalendars />);
  await fireEvent(await screen.findByLabelText('Work'), 'valueChange', true);
  await waitFor(() => expect(syncCalendarAway).toHaveBeenCalledTimes(1));
  expect(JSON.parse((await AsyncStorage.getItem(AWAY_CALENDARS_KEY))!)).toEqual(['work']);

  // A fresh screen shows the saved choice; turning it off saves and syncs the empty list.
  await screen.unmount();
  await render(<AwayCalendars />);
  const work = await screen.findByLabelText('Work');
  await waitFor(() => expect(work.props.value).toBe(true));
  expect(screen.getByLabelText('Family').props.value).toBe(false);
  await fireEvent(work, 'valueChange', false);
  await waitFor(() => expect(syncCalendarAway).toHaveBeenCalledTimes(2));
  expect(JSON.parse((await AsyncStorage.getItem(AWAY_CALENDARS_KEY))!)).toEqual([]);
});

test('shows a sync error', async () => {
  jest.mocked(Calendar.getCalendarPermissions).mockResolvedValue(granted as never);
  jest.mocked(syncCalendarAway).mockRejectedValue({ message: 'invalid_periods' });
  await render(<AwayCalendars />);
  await fireEvent(await screen.findByLabelText('Family'), 'valueChange', true);
  expect(await screen.findByText("Couldn't share your calendar times. Try again.")).toBeTruthy();
});

test('points to Settings when access was denied', async () => {
  jest.mocked(Calendar.getCalendarPermissions).mockResolvedValue({ granted: false, canAskAgain: false, status: 'denied' } as never);
  await render(<AwayCalendars />);
  expect(await screen.findByRole('button', { name: 'Allow calendar access in Settings' })).toBeTruthy();
});
