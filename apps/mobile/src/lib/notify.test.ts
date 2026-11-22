import * as Notifications from 'expo-notifications';
import { initNotifications, notifyMember } from './notify';

jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn().mockResolvedValue('id'),
  setNotificationCategoryAsync: jest.fn().mockResolvedValue({}),
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn().mockResolvedValue(null),
  clearLastNotificationResponse: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
}));
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
