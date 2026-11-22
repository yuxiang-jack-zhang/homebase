import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Alert } from 'react-native';
import { ensureNotificationPermission, initNotifications, notifyMember } from './notify';

jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn().mockResolvedValue('id'),
  setNotificationCategoryAsync: jest.fn().mockResolvedValue({}),
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn().mockResolvedValue(null),
  clearLastNotificationResponse: jest.fn(),
  getPresentedNotificationsAsync: jest.fn().mockResolvedValue([]),
  dismissNotificationAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
}));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('./api', () => ({ reply: jest.fn() }));

const q = { questionTargetId: 't1', askerName: 'Ann', question: 'home at 7?' };

test('notifyMember uses the draft category only when a draft exists', async () => {
  await notifyMember({ ...q, draft: 'Probably yes' });
  await notifyMember({ ...q, draft: null });
  const calls = jest.mocked(Notifications.scheduleNotificationAsync).mock.calls.map(([r]) => r.content);
  expect(calls[0]).toMatchObject({ categoryIdentifier: 'question', data: { questionTargetId: 't1' } });
  expect(calls[0].body).toContain('Probably yes');
  expect(calls[1]).toMatchObject({ categoryIdentifier: 'question_nodraft' });
});

test('initNotifications registers categories and the listener once', async () => {
  await initNotifications();
  await initNotifications();
  expect(Notifications.setNotificationCategoryAsync).toHaveBeenCalledTimes(2);
  expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalledTimes(1);
});

test('the permission explanation shows at most once', async () => {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ status: 'undetermined' } as never);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, b) => b?.[0].onPress?.());
  await AsyncStorage.clear();
  await ensureNotificationPermission();
  await ensureNotificationPermission();
  expect(alert).toHaveBeenCalledTimes(1);
});
