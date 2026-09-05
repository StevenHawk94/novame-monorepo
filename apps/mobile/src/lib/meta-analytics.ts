import { Platform } from 'react-native';
import { AppEventsLogger, Settings } from 'react-native-fbsdk-next';

import {
  kMetaFirstLaunchLogged,
  kMetaFirstReflectLogged,
  kMetaOnboardingCompletedLogged,
} from '@/shared/storage/keys';
import { storage } from './storage';

const FIRST_LAUNCH_EVENT = 'burrow_first_launch';
const FIRST_REFLECT_EVENT = 'burrow_first_reflect_completed';

let initialized = false;
let analyticsEnabled = false;

/**
 * Initialize only Meta App Events. Burrow does not use Meta Login, advanced
 * matching, or setUserData/setUserID, so names, emails, reflection text, and
 * friend data never enter this integration.
 *
 * Android advertising-id collection is enabled for install attribution.
 * iOS keeps it disabled: this integration does not request ATT or access IDFA.
 */
export function initializeMetaAnalytics(): void {
  if (Platform.OS === 'web') return;
  analyticsEnabled = true;
  const wasInitialized = initialized;
  try {
    Settings.setAutoLogAppEventsEnabled(true);
    Settings.setAdvertiserIDCollectionEnabled(Platform.OS === 'android');
    if (!wasInitialized) {
      initialized = true;
      Settings.initializeSDK();
    }

    if (!storage.getBoolean(kMetaFirstLaunchLogged.name)) {
      AppEventsLogger.logEvent(FIRST_LAUNCH_EVENT);
      storage.set(kMetaFirstLaunchLogged.name, true);
    }
  } catch (error) {
    analyticsEnabled = false;
    if (!wasInitialized) initialized = false;
    console.warn('[meta] SDK initialization failed:', error);
  }
}

/** Stop all optional Meta measurement after a user withdraws consent. */
export function disableMetaAnalytics(): void {
  analyticsEnabled = false;
  if (Platform.OS === 'web' || !initialized) return;
  try {
    Settings.setAutoLogAppEventsEnabled(false);
    Settings.setAdvertiserIDCollectionEnabled(false);
  } catch (error) {
    console.warn('[meta] SDK disable failed:', error);
  }
}

export function logOnboardingCompleted(): void {
  if (Platform.OS === 'web' || !analyticsEnabled) return;
  if (storage.getBoolean(kMetaOnboardingCompletedLogged.name)) return;
  try {
    AppEventsLogger.logEvent(AppEventsLogger.AppEvents.CompletedTutorial);
    storage.set(kMetaOnboardingCompletedLogged.name, true);
  } catch (error) {
    console.warn('[meta] onboarding event failed:', error);
  }
}

export function logFirstReflectCompleted(userId: string | undefined): void {
  if (Platform.OS === 'web' || !analyticsEnabled || !userId) return;
  const dedupeKey = kMetaFirstReflectLogged.keyFor(userId);
  if (storage.getBoolean(dedupeKey)) return;
  try {
    AppEventsLogger.logEvent(FIRST_REFLECT_EVENT);
    storage.set(dedupeKey, true);
  } catch (error) {
    console.warn('[meta] first-reflect event failed:', error);
  }
}

export function logStartTrial(params: {
  productId: string;
  cycle: 'monthly' | 'yearly';
}): void {
  if (Platform.OS === 'web' || !analyticsEnabled) return;
  try {
    AppEventsLogger.logEvent(AppEventsLogger.AppEvents.StartTrial, {
      [AppEventsLogger.AppEventParams.ContentID]: params.productId,
      [AppEventsLogger.AppEventParams.ContentType]: 'subscription',
      billing_cycle: params.cycle,
    });
  } catch (error) {
    console.warn('[meta] StartTrial event failed:', error);
  }
}
