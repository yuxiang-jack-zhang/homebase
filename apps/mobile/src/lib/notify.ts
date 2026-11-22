import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Alert } from 'react-native';
import { reply } from './api';
import { categoryFor, responseToReply } from './questionLogic';

// All notification code lives here. Local notifications only: no remote push (no paid Apple account).

export async function notifyMember(q: { questionTargetId: string; askerName: string; question: string; draft: string | null }) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${q.askerName} asks`,
      body: q.draft ? `${q.question}\nSuggested: ${q.draft}` : q.question,
      categoryIdentifier: categoryFor(q.draft),
      data: { questionTargetId: q.questionTargetId },
    },
    trigger: null,
  });
}

const EXPLAINED_KEY = 'homebase.notifPermissionExplained';

/** Explain, then ask iOS for permission. The explanation shows at most once, even if dismissed with "Not now". */
export async function ensureNotificationPermission() {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'undetermined') return;
  if (await AsyncStorage.getItem(EXPLAINED_KEY).catch(() => null)) return;
  await AsyncStorage.setItem(EXPLAINED_KEY, '1').catch(() => {});
  await new Promise<void>((resolve) =>
    Alert.alert(
      'Get asked here',
      'Homebase sends a notification when a roommate asks you something, so you can answer with one tap.',
      [
        { text: 'Not now', style: 'cancel', onPress: () => resolve() },
        { text: 'Allow', onPress: () => Notifications.requestPermissionsAsync().then(() => resolve(), () => resolve()) },
      ],
    ));
}

/** Remove a question's delivered notification(s) once it is answered. */
export async function dismissForQuestion(questionTargetId: string) {
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(shown
      .filter((n) => (n.request.content.data as { questionTargetId?: string } | undefined)?.questionTargetId === questionTargetId)
      .map((n) => Notifications.dismissNotificationAsync(n.request.identifier)));
  } catch (e) {
    console.warn('[notify] dismiss failed:', e);
  }
}

const quick = (identifier: string, buttonTitle: string) => ({ identifier, buttonTitle, options: { opensAppToForeground: true } });
const replyAction = {
  identifier: 'text', buttonTitle: 'Reply', options: { opensAppToForeground: true },
  textInput: { submitButtonTitle: 'Send', placeholder: 'Your reply' },
};

const handled = new Set<string>();
async function handle(r: Notifications.NotificationResponse) {
  const key = `${r.notification.request.identifier}:${r.actionIdentifier}`;
  if (handled.has(key)) return;
  handled.add(key);
  const id = (r.notification.request.content.data as { questionTargetId?: string } | undefined)?.questionTargetId;
  const req = id ? responseToReply(id, r.actionIdentifier, r.userText) : null;
  if (!req) return;
  try {
    await reply(req);
    await dismissForQuestion(req.questionTargetId);
  } catch (e) {
    console.warn('[notify] reply failed:', (e as Error).message); // 409 = answered elsewhere; the inbox shows the rest
  }
}

let started: Promise<void> | undefined;
/** Call from the app root; runs once (categories, foreground banner, response listener, cold-start response). */
export function initNotifications() {
  started ??= (async () => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
    });
    await Promise.all([
      Notifications.setNotificationCategoryAsync('question', [
        quick('approve', 'Approve'), quick('yes', 'Yes'), quick('no', 'No'), replyAction,
      ]),
      Notifications.setNotificationCategoryAsync('question_nodraft', [quick('yes', 'Yes'), quick('no', 'No'), replyAction]),
    ]);
    Notifications.addNotificationResponseReceivedListener((r) => void handle(r));
    const last = await Notifications.getLastNotificationResponseAsync();
    if (last) {
      await handle(last);
      Notifications.clearLastNotificationResponse();
    }
  })();
  return started;
}
