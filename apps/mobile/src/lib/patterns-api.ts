import { apiClient } from './api';
import { supabase } from './supabase';
import { patchAnalysisCache, readAnalysisCache } from './connection-analysis-cache';
import { ANALYSIS_WEEK_MS, shouldResumeAfterAbsence } from './analysis-refresh-policy';

export type PatternRange = 7;
export type PatternState = 'unpaired' | 'unavailable' | 'no_moments' | 'building_baseline' | 'ready_to_generate' | 'ready';

export interface PatternTheme {
  topic: string;
  count: number;
}

export interface RelatedPatternMoment {
  id: string;
  reflectId?: string | null;
  itemId?: string | null;
  date: string;
  excerpt: string;
}

export interface PatternDimension {
  key: 'mood' | 'energy' | 'stress' | 'openness' | 'connection' | 'enjoyment';
  label: string;
  trend: string;
  trendLabel: string;
  score: number | null;
  summary: string;
  evidenceCount: number;
  dayCount: number;
  themes: PatternTheme[];
  related: RelatedPatternMoment[];
}

export interface PatternScorePeriod {
  startDate: string;
  endDate: string;
  evidenceCount: number;
  scores: Record<PatternDimension['key'], number | null>;
}

export interface TheirPatterns {
  success: boolean;
  state: PatternState;
  days: PatternRange;
  recommendedDays?: PatternRange;
  partnerUserId?: string;
  partnerName?: string;
  summary?: string;
  dimensions: PatternDimension[];
  currentStart?: string;
  currentEnd?: string;
  history?: PatternScorePeriod[];
  currentScores?: PatternScorePeriod | null;
  newRecapAvailable?: boolean;
  availablePeriod?: { startDate: string; endDate: string; evidenceCount: number } | null;
}

export async function generateTheirPatternsRecap(
  period: { startDate: string; endDate: string },
): Promise<TheirPatterns | null> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user?.id;
  if (!userId) return null;
  const result = await apiClient.post<TheirPatterns>('/api/friends/patterns/generate', {
    userId, periodStart: period.startDate, periodEnd: period.endDate,
  });
  patchAnalysisCache({ patterns: result, patternsFetchedAt: Date.now() });
  return result;
}

export function getCachedTheirPatterns(): TheirPatterns | null {
  return (readAnalysisCache().patterns as TheirPatterns | undefined) ?? null;
}

/** Weekly refresh, plus one page-triggered catch-up after a 5-day absence. */
export function shouldRefreshTheirPatterns(): boolean {
  const cache = readAnalysisCache();
  if (!cache.patterns) return true;
  const fetchedAt = cache.patternsFetchedAt ?? 0;
  // This GET performs no AI work. Check cheaply every six hours so a newly
  // completed seven-day period can offer Generate Now without waiting another
  // whole week, while still painting the cached recap immediately.
  const shouldCheckAvailability = Date.now() - fetchedAt >= 6 * 60 * 60 * 1000;
  if (!shouldCheckAvailability) return false;
  const hasFullNewWeek = Date.now() - fetchedAt >= ANALYSIS_WEEK_MS;
  // The absence check documents the five-day resume path; both that path and
  // normal weekly cadence remain pull-based and can run only from this page.
  return shouldResumeAfterAbsence(5, fetchedAt) || hasFullNewWeek || shouldCheckAvailability;
}

export async function fetchTheirPatterns(days: PatternRange = 7): Promise<TheirPatterns | null> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user?.id;
  if (!userId) return null;
  try {
    const result = await apiClient.get<TheirPatterns>(
      `/api/friends/patterns?userId=${encodeURIComponent(userId)}&days=${days}`,
    );
    patchAnalysisCache({ patterns: result, patternsFetchedAt: Date.now() });
    return result;
  } catch {
    return getCachedTheirPatterns();
  }
}
