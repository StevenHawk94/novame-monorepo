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
const DEV_PIPELINE_EVENT = 'burrow_meta_pipeline_check';

let initialized = false;
let analyticsEnabled = false;

function flushEvents(): void {
  // Funnel events are intentionally sparse. Flush immediately so a cold-start
  // event is not left waiting for the SDK's periodic/background flush, which
  // also makes Events Manager's Test Events useful during development.
  AppEventsLogger.flush();
}

function logEventAndFlush(
  eventName: string,
  parameters?: Record<string, string | number>,
): void {
  if (parameters) AppEventsLogger.logEvent(eventName, parameters);
  else AppEventsLogger.logEvent(eventName);
  flushEvents();
}

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
    AppEventsLogger.setFlushBehavior('auto');
    Settings.setAutoLogAppEventsEnabled(true);
    Settings.setAdvertiserIDCollectionEnabled(Platform.OS === 'android');
    if (Platform.OS === 'ios') {
      // Burrow does not request ATT or access IDFA. Make that state explicit
      // to Meta instead of relying on an SDK default.
      void Settings.setAdvertiserTrackingEnabled(false);
    }
    if (!wasInitialized) {
      initialized = true;
      Settings.initializeSDK();
    }

    if (!storage.getBoolean(kMetaFirstLaunchLogged.name)) {
      logEventAndFlush(FIRST_LAUNCH_EVENT);
      storage.set(kMetaFirstLaunchLogged.name, true);
    }
    if (__DEV__) {
      // Development builds need a non-deduplicated probe so reinstalling over
      // an existing dev client can still prove the native delivery pipeline.
      logEventAndFlush(DEV_PIPELINE_EVENT, { platform: Platform.OS });
      console.info('[meta] SDK initialized and pipeline check flushed');
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
    logEventAndFlush(AppEventsLogger.AppEvents.CompletedTutorial);
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
    logEventAndFlush(FIRST_REFLECT_EVENT);
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
    logEventAndFlush(AppEventsLogger.AppEvents.StartTrial, {
      [AppEventsLogger.AppEventParams.ContentID]: params.productId,
      [AppEventsLogger.AppEventParams.ContentType]: 'subscription',
      billing_cycle: params.cycle,
    });
  } catch (error) {
    console.warn('[meta] StartTrial event failed:', error);
  }
}
