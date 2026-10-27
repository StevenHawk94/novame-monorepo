import * as Notifications from 'expo-notifications';
import { AppState,Platform } from 'react-native';
import Constants from 'expo-constants';

import { storage } from './storage';
import { apiClient } from './api';
import { supabase } from './supabase';

/**
 * Per-device reminder preference and durable registration reconciliation.
 * Version 3 cancels the old unconditional OS timer. The server now decides
 * at local 20:00 whether Adventure has started; no JS background wake is
 * required. Native alert permissions/channels remain unchanged.
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
const DAILY_SCHEDULE_VERSION = 3;
let remoteRegistration:Promise<boolean>|null=null;
let registrationRetry:ReturnType<typeof setTimeout>|null=null,retryAttempts=0;
function scheduleRegistrationRetry(){
  if(registrationRetry||AppState?.currentState!=='active'||!getNotificationSettings().remotePending)return;
  const delay=Math.min(5000*2**Math.min(retryAttempts++,6),300000);
  registrationRetry=setTimeout(()=>{registrationRetry=null;void syncRemoteNotificationRegistration({force:true});},delay);
}
AppState?.addEventListener('change',state=>{if(state!=='active'&&registrationRetry){clearTimeout(registrationRetry);registrationRetry=null;}});

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
  remotePending?:boolean;
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
      hour: 20,
      min: 0,
      identifier: parsed.identifier ?? null,
      scheduleVersion: typeof parsed.scheduleVersion === 'number' ? parsed.scheduleVersion : 0,
      remotePending:!!parsed.remotePending,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function setNotificationSettings(s: NotificationSettings): void {
  storage.set(STORAGE_KEY, JSON.stringify(s));
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
async function registerRemoteNotification(
  options?: { force?: boolean },
): Promise<boolean> {
  await migrateLegacyReminder();
  const preference=getNotificationSettings();
  if (!options?.force&&!preference.remotePending && Date.now() - lastRemoteRegistrationAt < 6 * 60 * 60_000) return true;
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
    const registration=await apiClient.post<{success?:boolean;notificationVersion?:number}>('/api/notifications/register', {
      userId,
      token: token.data,
      platform: Platform.OS,
      notificationVersion:2,
      adventureVersion:5,
      plushieTouchVersion:2,
      dailyReminderEnabled:preference.enabled,
    });
    if(registration.notificationVersion!==2)return false;
    const latest=getNotificationSettings();
    if(latest.enabled===preference.enabled)setNotificationSettings({...latest,remotePending:false});
    lastRemoteRegistrationAt = Date.now();
    return true;
  } catch (error) {
    console.warn('[notifications] remote registration failed:', error);
    return false;
  }
}

/** Serialize registration so a late opt-in cannot overwrite a newer opt-out. */
export function syncRemoteNotificationRegistration(options?:{force?:boolean}):Promise<boolean>{
  if(remoteRegistration)return remoteRegistration.then(()=>syncRemoteNotificationRegistration(options));
  const request=registerRemoteNotification(options).catch(()=>false);
  remoteRegistration=request;
  void request.then(ok=>{
    if(remoteRegistration===request)remoteRegistration=null;
    if(ok){retryAttempts=0;if(registrationRetry)clearTimeout(registrationRetry);registrationRetry=null;}
    else scheduleRegistrationRetry();
  });
  return request;
}

// ---- schedule / cancel ----

let legacyMigration:Promise<void>|null=null;
async function migrateLegacyReminder():Promise<void>{
  if(legacyMigration)return legacyMigration;
  const current=getNotificationSettings();
  if(current.scheduleVersion===DAILY_SCHEDULE_VERSION&&!current.identifier)return;
  const work=(async()=>{
    const scheduled=await Notifications.getAllScheduledNotificationsAsync();
    const ids=new Set(scheduled.filter(n=>n.identifier===current.identifier||n.content.body==='How was your day? your companion wants to hear about your life moments.').map(n=>n.identifier));
    if(current.identifier)ids.add(current.identifier);
    for(const id of ids)await Notifications.cancelScheduledNotificationAsync(id);
    const latest=getNotificationSettings();
    setNotificationSettings({...latest,hour:20,min:0,identifier:null,scheduleVersion:DAILY_SCHEDULE_VERSION,remotePending:true});
  })();legacyMigration=work;
  try{await work;}finally{if(legacyMigration===work)legacyMigration=null;}
}

/**
 * Compatibility signature for existing UI. Time is fixed at local 20:00;
 * only the opt-in is registered, never an unconditional local notification.
 */
export async function scheduleDailyReminder(
  hour: number,
  min: number,
): Promise<void> {
  if (await checkNotificationPermission() !== 'granted') {
    throw new Error('notification_permission_not_granted');
  }
  await migrateLegacyReminder();
  const current = getNotificationSettings();
  setNotificationSettings({...current,enabled:true,hour:20,min:0,identifier:null,remotePending:true,scheduleVersion:DAILY_SCHEDULE_VERSION});
  await syncRemoteNotificationRegistration({force:true});
}

/** Migrate legacy schedules and resume a pending server preference sync. */
export function reconcileDailyReminderSchedule(): Promise<boolean> {
  if (dailyScheduleReconcile) return dailyScheduleReconcile;
  dailyScheduleReconcile = (async () => {
    await migrateLegacyReminder();
    return syncRemoteNotificationRegistration();
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
  await migrateLegacyReminder();
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
    hour: 20,
    min: 0,
    identifier: null,
    scheduleVersion: DAILY_SCHEDULE_VERSION,
    remotePending:true,
  });
  await syncRemoteNotificationRegistration({force:true});
}
