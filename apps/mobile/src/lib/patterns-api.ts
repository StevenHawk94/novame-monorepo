import { apiClient } from './api';
import { supabase } from './supabase';

export type PatternRange = 7 | 30 | 90;
export type PatternState = 'unpaired' | 'unavailable' | 'no_moments' | 'building_baseline' | 'ready';

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
  summary: string;
  evidenceCount: number;
  dayCount: number;
  themes: PatternTheme[];
  related: RelatedPatternMoment[];
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
}

export async function fetchTheirPatterns(days: PatternRange): Promise<TheirPatterns | null> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user?.id;
  if (!userId) return null;
  try {
    return await apiClient.get<TheirPatterns>(
      `/api/friends/patterns?userId=${encodeURIComponent(userId)}&days=${days}`,
    );
  } catch {
    return null;
  }
}
