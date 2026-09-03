import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import { fetchFriendFeedPage } from './friends-api';

export const PARTNER_WIDGET_REFRESH_TASK = 'burrow-partner-widget-refresh-v1';
export const PARTNER_WIDGET_REFRESH_TYPE = 'partner_reflect_widget_refresh';

// expo-notifications 0.32 consumes these native UIBackgroundFetchResult
// bridge values but does not export its enum from the package entry point.
const BACKGROUND_RESULT = {
  noData: 1,
  newData: 2,
  failed: 3,
} as const;

type NotificationData = Record<string, unknown>;

function customDataFromPayload(
  payload: Notifications.NotificationTaskPayload,
): NotificationData | null {
  // Notification action responses also reach this task on Android. They are
  // handled by the existing root-layout response listener, not here.
  if ('actionIdentifier' in payload) return null;

  const data = payload.data;
  if (typeof data.dataString === 'string') {
    try {
      const parsed = JSON.parse(data.dataString) as unknown;
      if (parsed && typeof parsed === 'object') return parsed as NotificationData;
    } catch {
      return null;
    }
  }
  return data;
}

if (!TaskManager.isTaskDefined(PARTNER_WIDGET_REFRESH_TASK)) {
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(
    PARTNER_WIDGET_REFRESH_TASK,
    async ({ data: payload, error }) => {
      if (error) return BACKGROUND_RESULT.failed;
      const data = customDataFromPayload(payload);
      if (data?.type !== PARTNER_WIDGET_REFRESH_TYPE) {
        return BACKGROUND_RESULT.noData;
      }

      try {
        // The normal feed path already owns cache persistence, icon resolution,
        // avatar copying and the native Android/iOS Widget reload. Force only
        // this read so the visible-notification and foreground flows stay intact.
        await fetchFriendFeedPage(undefined, {
          force: true,
          awaitWidgetSync: true,
        });
        return BACKGROUND_RESULT.newData;
      } catch {
        return BACKGROUND_RESULT.failed;
      }
    },
  );
}

// Registration is persistent and idempotent. It is intentionally kicked off
// at module scope so the definition exists during headless launches.
void (async () => {
  try {
    if (!await TaskManager.isAvailableAsync()) return;
    if (!await TaskManager.isTaskRegisteredAsync(PARTNER_WIDGET_REFRESH_TASK)) {
      await Notifications.registerTaskAsync(PARTNER_WIDGET_REFRESH_TASK);
    }
  } catch (error) {
    console.warn('[notifications] background widget refresh registration failed:', error);
  }
})();
