import { Platform } from 'react-native';

import {
  nativeDisableTikTokEvents,
  nativeFlushTikTokEvents,
  nativeInitializeTikTokEvents,
  nativeTikTokTestEventCode,
  nativeTrackTikTokEvent,
  type TikTokEventProperties,
} from '../../modules/tiktok-events';
import {
  kTikTokOnboardingCompletedLogged,
  kTikTokRegistrationLogged,
} from '@/shared/storage/keys';
import { storage } from './storage';

let enabled = false;
let lifecycle = 0;
let initialization: Promise<boolean> | null = null;
const pendingDedupeKeys = new Set<string>();

function ensureInitialized(): Promise<boolean> {
  if (Platform.OS !== 'ios' || !enabled) return Promise.resolve(false);
  if (initialization) return initialization;

  const generation = lifecycle;
  initialization = nativeInitializeTikTokEvents(__DEV__).then((ready) => {
    if (generation !== lifecycle || !enabled) {
      nativeDisableTikTokEvents();
      return false;
    }
    if (__DEV__ && ready) {
      console.info('[tiktok] SDK initialized', {
        testEventCode: nativeTikTokTestEventCode(),
      });
    }
    return ready;
  }).catch((error) => {
    console.warn('[tiktok] SDK initialization failed:', error);
    initialization = null;
    return false;
  });
  return initialization;
}

async function track(
  eventName: string,
  properties: TikTokEventProperties = {},
): Promise<boolean> {
  if (Platform.OS !== 'ios' || !enabled) return false;
  try {
    const ready = await ensureInitialized();
    if (!ready || !enabled) return false;
    nativeTrackTikTokEvent(eventName, properties);
    nativeFlushTikTokEvents();
    return true;
  } catch (error) {
    console.warn(`[tiktok] ${eventName} event failed:`, error);
    return false;
  }
}

/** Enable TikTok iOS only after the same ads privacy gate as Meta. */
export function initializeTikTokAnalytics(): void {
  if (Platform.OS !== 'ios') return;
  if (enabled) {
    void ensureInitialized();
    return;
  }
  enabled = true;
  lifecycle += 1;
  initialization = null;
  void ensureInitialized();
}

/** Stop optional TikTok collection after consent is withdrawn. */
export function disableTikTokAnalytics(): void {
  enabled = false;
  lifecycle += 1;
  initialization = null;
  if (Platform.OS === 'ios') nativeDisableTikTokEvents();
}

export function logTikTokOnboardingCompleted(): void {
  const key = kTikTokOnboardingCompletedLogged.name;
  if (!enabled || storage.getBoolean(key) || pendingDedupeKeys.has(key)) return;
  pendingDedupeKeys.add(key);
  void track('CompleteTutorial').then((accepted) => {
    if (accepted) storage.set(key, true);
  }).finally(() => pendingDedupeKeys.delete(key));
}

export function logTikTokJournalCompleted(
  journalKind: 'write_freely' | 'tap_your_day' | 'remember_together',
): void {
  void track('JournalCompleted', { journal_type: journalKind });
}

export function logTikTokRegistration(userId: string | undefined): void {
  if (!enabled || !userId) return;
  const key = kTikTokRegistrationLogged.keyFor(userId);
  if (storage.getBoolean(key) || pendingDedupeKeys.has(key)) return;
  pendingDedupeKeys.add(key);
  void track('Registration').then((accepted) => {
    if (accepted) storage.set(key, true);
  }).finally(() => pendingDedupeKeys.delete(key));
}

export function logTikTokStartTrial(params: {
  productId: string;
  cycle: 'monthly' | 'yearly';
}): void {
  void track('StartTrial', {
    content_id: params.productId,
    content_type: 'subscription',
    billing_cycle: params.cycle,
  });
}

export function logTikTokSubscribe(params: {
  productId: string;
  cycle: 'monthly' | 'yearly';
}): void {
  void track('Subscribe', {
    content_id: params.productId,
    content_type: 'subscription',
    billing_cycle: params.cycle,
  });
}
