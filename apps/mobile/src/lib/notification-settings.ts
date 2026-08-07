import * as Notifications from 'expo-notifications';

import { storage } from './storage';

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
};

const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: false,
  hour: 20, // 8:00 PM default, matches old web
  min: 0,
  identifier: null,
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
  const result = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
    },
  });
  if (result.granted) return 'granted';
  if (
    result.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  ) {
    return 'granted';
  }
  return 'denied';
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
  const current = getNotificationSettings();
  if (current.identifier) {
    try {
      await Notifications.cancelScheduledNotificationAsync(current.identifier);
    } catch {
      // Cancelling a missing identifier is a no-op; ignore.
    }
  }

  const identifier = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Burrow',
      body: buildBody(),
      sound: 'default',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute: min,
    },
  });

  setNotificationSettings({
    enabled: true,
    hour,
    min,
    identifier,
  });
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
  });
}
