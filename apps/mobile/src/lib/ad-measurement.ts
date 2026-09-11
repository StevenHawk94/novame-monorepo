import {
  disableMetaAnalytics,
  initializeMetaAnalytics,
  logFirstReflectCompleted,
  logOnboardingCompleted as logMetaOnboardingCompleted,
  logStartTrial as logMetaStartTrial,
} from './meta-analytics';
import {
  disableTikTokAnalytics,
  initializeTikTokAnalytics,
  logTikTokJournalCompleted,
  logTikTokOnboardingCompleted,
  logTikTokRegistration,
  logTikTokStartTrial,
  logTikTokSubscribe,
} from './tiktok-analytics';
import type { JournalKind } from './reflect-api';

export function initializeAdMeasurement(): void {
  initializeMetaAnalytics();
  initializeTikTokAnalytics();
}

export function disableAdMeasurement(): void {
  disableMetaAnalytics();
  disableTikTokAnalytics();
}

export function logOnboardingCompleted(): void {
  logMetaOnboardingCompleted();
  logTikTokOnboardingCompleted();
}

export function logJournalCompleted(params: {
  userId: string | undefined;
  journalKind: JournalKind;
  shared: boolean;
}): void {
  // Meta retains its sparse first-private-journal signal. TikTok receives one
  // categorical event per completion and never receives the journal content.
  if (!params.shared) logFirstReflectCompleted(params.userId);
  logTikTokJournalCompleted(params.journalKind);
}

export function logRegistration(userId: string | undefined): void {
  logTikTokRegistration(userId);
}

export function logStartTrial(params: {
  productId: string;
  cycle: 'monthly' | 'yearly';
}): void {
  logMetaStartTrial(params);
  logTikTokStartTrial(params);
}

export function logSubscribe(params: {
  productId: string;
  cycle: 'monthly' | 'yearly';
}): void {
  logTikTokSubscribe(params);
}
