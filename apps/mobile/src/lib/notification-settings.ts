import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

import { storage } from './storage';
import { apiClient } from './api';
import { supabase } from './supabase';

/**
 * Notification settings -- Stage 3.10.2 C2.
 *
 * Local-only daily reminder. The user picks an hour:minute, we schedule
 * a single repeating daily notification via expo-notifications, and
 * persist {enabled, hour, min, identifier} to MMKV so we can cancel /
 * re-schedule on subsequent visits.
 *
 * Why MMKV and not the server:
 *   - Old web (visdom-capacitor) stored this in localStorage too --
 *     it is purely a per-device preference, not user data.
 *   - The notification body uses the user's character name (e.g.
 *     "How was your day? Nova wants to hear..."), but charName lives
 *     in character_data on the server -- we read it from the
 *     character-state cache (already warmed by Home tab).
 *
 * SDK 17 facts (verified from .d.ts):
 *   - scheduleNotificationAsync({content, trigger}) returns a string
 *     identifier we must store to cancel later.
 *   - DailyTriggerInput = {type:'daily', hour, minute} -- no repeats
 *     flag needed (daily implies it).
 *   - cancelScheduledNotificationAsync(identifier) is the only cancel
 *     path; cancelling a non-existent id is a no-op (safe).
 *   - SDK 17 removed setNotificationHandler from the public types,
 *     so we do not configure foreground display behavior here.
 *
 * MMKV key: novame_notification_settings
 */

const STORAGE_KEY = 'novame_notification_settings';
// Android channel importance cannot be raised after a channel has been
// created. A versioned id moves existing daily reminders off the earlier
// DEFAULT channel and onto the visible, heads-up HIGH channel below.
const ANDROID_CHANNEL_ID = 'daily-reminders-v2';
// Keep the remote-push id backward compatible with already released clients.
const ANDROID_PARTNER_CHANNEL_ID = 'partner-updates';
let lastRemoteRegistrationAt = 0;
let dailyScheduleReconcile: Promise<boolean> | null = null;
const DAILY_SCHEDULE_VERSION = 2;

export type NotificationSettings = {
  enabled: boolean;
  hour: number; // 0-23
  min: number; // 0-59 (we step by 15 in the UI)
  /**
   * The identifier returned by scheduleNotificationAsync. We store it
   * so we can cancel before re-scheduling on time change. Null when
   * disabled or never scheduled.
   */
  identifier: string | null;
  scheduleVersion?: number;
};

const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: false,
  hour: 20, // 8:00 PM default, matches old web
  min: 0,
  identifier: null,
  scheduleVersion: DAILY_SCHEDULE_VERSION,
};

// ---- mmkv read / write ----

export function getNotificationSettings(): NotificationSettings {
  const raw = storage.getString(STORAGE_KEY);
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as NotificationSettings;
    return {
      enabled: !!parsed.enabled,
      hour: typeof parsed.hour === 'number' ? parsed.hour : DEFAULT_SETTINGS.hour,
      min: typeof parsed.min === 'number' ? parsed.min : DEFAULT_SETTINGS.min,
      identifier: parsed.identifier ?? null,
      scheduleVersion: typeof parsed.scheduleVersion === 'number' ? parsed.scheduleVersion : 0,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function setNotificationSettings(s: NotificationSettings): void {
  storage.set(STORAGE_KEY, JSON.stringify(s));
}

// ---- post-purchase one-time opt-in prompt ----

const PROMPTED_AFTER_PURCHASE_KEY = 'novame_notif_prompted_after_purchase';

/** True once we've auto-shown the post-purchase notification opt-in. */
export function hasPromptedNotifAfterPurchase(): boolean {
  return storage.getString(PROMPTED_AFTER_PURCHASE_KEY) === '1';
}

/** Mark the one-time post-purchase notification opt-in as shown. */
export function markNotifPromptedAfterPurchase(): void {
  storage.set(PROMPTED_AFTER_PURCHASE_KEY, '1');
}

/**
 * Whether to auto-present the notification opt-in after a subscription
 * purchase: only once ever, and only if the user hasn't already enabled
 * the daily reminder.
 */
export function shouldPromptNotifAfterPurchase(): boolean {
  if (hasPromptedNotifAfterPurchase()) return false;
  if (getNotificationSettings().enabled) return false;
  return true;
}

// ---- permission ----

export type PermissionResult = 'granted' | 'denied' | 'undetermined';

async function ensureAndroidNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Daily reminders',
    importance: Notifications.AndroidImportance.HIGH,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    sound: 'default',
    enableVibrate: true,
    vibrationPattern: [0, 180],
  });
  await Notifications.setNotificationChannelAsync(ANDROID_PARTNER_CHANNEL_ID, {
    name: 'Partner updates',
    importance: Notifications.AndroidImportance.HIGH,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    sound: 'default',
    enableVibrate: true,
    vibrationPattern: [0, 180],
  });
}

export async function checkNotificationPermission(): Promise<PermissionResult> {
  const settings = await Notifications.getPermissionsAsync();
  if (settings.granted) return 'granted';
  if (
    settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  ) {
    return 'granted';
  }
  return settings.canAskAgain === false ? 'denied' : 'undetermined';
}

export async function requestNotificationPermission(): Promise<PermissionResult> {
  // Android 13 does not present its runtime permission dialog until at least
  // one notification channel exists.
  await ensureAndroidNotificationChannel();
  await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
    },
  });
  const result = await checkNotificationPermission();
  if (result === 'granted') void syncRemoteNotificationRegistration({ force: true });
  return result;
}

/** Register silently only after the OS permission exists. The daily local
 * reminder and partner-update remote push therefore share one explicit opt-in. */
export async function syncRemoteNotificationRegistration(
  options?: { force?: boolean },
): Promise<boolean> {
  if (!options?.force && Date.now() - lastRemoteRegistrationAt < 6 * 60 * 60_000) return true;
  if (await checkNotificationPermission() !== 'granted') return false;
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user?.id;
  if (!userId) return false;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId
    ?? Constants.easConfig?.projectId;
  if (!projectId) return false;
  try {
    await ensureAndroidNotificationChannel();
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    await apiClient.post('/api/notifications/register', {
      userId,
      token: token.data,
      platform: Platform.OS,
    });
    lastRemoteRegistrationAt = Date.now();
    return true;
  } catch (error) {
    console.warn('[notifications] remote registration failed:', error);
    return false;
  }
}

// ---- schedule / cancel ----

function buildBody(): string {
  const charName = 'your companion';
  return `How was your day? ${charName} wants to hear about your life moments.`;
}

/**
 * Schedules (or re-schedules) a daily reminder at the given local hour/min.
 * Cancels any previously scheduled identifier first to avoid duplicates.
 * Persists the new identifier + hour/min to MMKV with enabled=true.
 */
export async function scheduleDailyReminder(
  hour: number,
  min: number,
): Promise<void> {
  if (await checkNotificationPermission() !== 'granted') {
    throw new Error('notification_permission_not_granted');
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 23
    || !Number.isInteger(min) || min < 0 || min > 59) {
    throw new Error('invalid_notification_time');
  }
  await ensureAndroidNotificationChannel();
  const current = getNotificationSettings();
  const identifier = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Burrow',
      body: buildBody(),
      sound: 'default',
      ...(Platform.OS === 'android'
        ? { priority: Notifications.AndroidNotificationPriority.HIGH }
        : {}),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute: min,
      ...(Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL_ID } : {}),
    },
  });

  // Do not discard a known-good reminder until the replacement has been
  // accepted by the native scheduler. This also turns silent native failures
  // into a visible error instead of persisting a reminder that cannot fire.
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  if (!scheduled.some((notification) => notification.identifier === identifier)) {
    throw new Error('notification_schedule_not_registered');
  }
  if (current.identifier && current.identifier !== identifier) {
    try {
      await Notifications.cancelScheduledNotificationAsync(current.identifier);
    } catch {
      // Cancelling a missing identifier is a no-op; ignore.
    }
  }

  setNotificationSettings({
    enabled: true,
    hour,
    min,
    identifier,
    scheduleVersion: DAILY_SCHEDULE_VERSION,
  });
}

/** Repair legacy or OS-pruned reminders when the app returns to foreground.
 * This migrates existing users onto the current Android notification channel
 * without asking them to toggle their reminder off and on manually. */
export function reconcileDailyReminderSchedule(): Promise<boolean> {
  if (dailyScheduleReconcile) return dailyScheduleReconcile;
  dailyScheduleReconcile = (async () => {
    const current = getNotificationSettings();
    if (!current.enabled) return true;
    if (await checkNotificationPermission() !== 'granted') return false;
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const registered = Boolean(
      current.identifier
      && scheduled.some((notification) => notification.identifier === current.identifier),
    );
    if (registered && current.scheduleVersion === DAILY_SCHEDULE_VERSION) return true;
    await scheduleDailyReminder(current.hour, current.min);
    return true;
  })().catch((error) => {
    console.warn('[notifications] daily reminder reconciliation failed:', error);
    return false;
  }).finally(() => {
    dailyScheduleReconcile = null;
  });
  return dailyScheduleReconcile;
}

/**
 * Cancels the active reminder (if any) and persists enabled=false.
 * Hour/min are kept so the next time the user re-enables, the picker
 * starts at their last preferred time.
 */
export async function cancelDailyReminder(): Promise<void> {
  const current = getNotificationSettings();
  if (current.identifier) {
    try {
      await Notifications.cancelScheduledNotificationAsync(current.identifier);
    } catch {
      // ignore
    }
  }
  setNotificationSettings({
    enabled: false,
    hour: current.hour,
    min: current.min,
    identifier: null,
    scheduleVersion: DAILY_SCHEDULE_VERSION,
  });
}
