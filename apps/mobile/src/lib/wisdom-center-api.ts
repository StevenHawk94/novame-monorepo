import { apiClient } from './api';

/**
 * Wisdom Center API wrapper -- Stage 3.10.3 A.
 *
 * One GET endpoint feeds two distinct overlays:
 *   - Growth Center (Stage 3.10.3 A)        : portrait, aspire scores,
 *                                             better-self gauge, community
 *                                             resonance.
 *   - Weekly Evolution Report (Stage 3.10.3 B): latestReport (4 sections
 *                                             generated server-side via
 *                                             Gemini) + same metadata.
 *
 * Server: /api/wisdom-center returns the full payload regardless of
 * which overlay opened it; we just read the fields we need.
 *
 * No caching for now -- this is low-frequency (Growth Center is opened
 * from Me page Better Self Match Details, Weekly Report from Home tab
 * trophy/middle button, neither is on a hot path).
 */

export type DefaultAvatar = {
  url: string;
  name: string;
};

/** Server-side report_data shape for the weekly evolution report. */
export type WeeklyReportData = {
  section1_pulse?: {
    activeDays?: number;
    betterSelfStart?: number;
    betterSelfEnd?: number;
    traitChanges?: Array<{ trait: string; score?: number; change?: number }>;
  };
  section2_narrative?: {
    journey?: string;
    corelesson?: string;
  };
  section3_echo?: {
    totalResonance?: number;
    message?: string;
  };
  section4_path?: {
    focusTrait?: string;
    focusReason?: string;
    motto?: string;
  };
};

export type WisdomCenterData = {
  portrait: string;
  aspireWords: string[];
  aspireScores: Record<string, number>;
  betterSelfScore: number;
  communityResonance: number;
  reportAvailable: boolean;
  reportDate: string | null;
  latestReport: WeeklyReportData | null;
  shareCount: number;
  defaultAvatars: DefaultAvatar[];
};

export type WisdomCenterResult =
  | { kind: 'success'; data: WisdomCenterData }
  | { kind: 'error'; message: string };

export async function fetchWisdomCenter(
  userId: string,
): Promise<WisdomCenterResult> {
  type WireResponse = {
    success: boolean;
    error?: string;
  } & Partial<WisdomCenterData>;

  try {
    const data = await apiClient.get<WireResponse>(
      `/api/wisdom-center?userId=${encodeURIComponent(userId)}`,
    );
    if (!data.success) {
      return { kind: 'error', message: data.error || 'Failed to load' };
    }
    return {
      kind: 'success',
      data: {
        portrait: data.portrait ?? '',
        aspireWords: data.aspireWords ?? [],
        aspireScores: data.aspireScores ?? {},
        betterSelfScore: data.betterSelfScore ?? 70,
        communityResonance: data.communityResonance ?? 0,
        reportAvailable: data.reportAvailable ?? false,
        reportDate: data.reportDate ?? null,
        latestReport: data.latestReport ?? null,
        shareCount: data.shareCount ?? 0,
        defaultAvatars: data.defaultAvatars ?? [],
      },
    };
  } catch (e) {
    return {
      kind: 'error',
      message: e instanceof Error ? e.message : 'Network error',
    };
  }
}

/**
 * POST /api/wisdom-center -- generate a fresh weekly report. Used by
 * Stage 3.10.3 B (Weekly Report overlay). Server checks the user has
 * shared >=2 wisdoms this week before generating; if not, returns
 * { notEnough: true } and we surface a friendly message.
 */
export type GenerateReportResult =
  | { kind: 'success'; report: WeeklyReportData }
  | { kind: 'notEnough' }
  | { kind: 'error'; message: string };

export async function generateWeeklyReport(
  userId: string,
): Promise<GenerateReportResult> {
  type WireResponse = {
    success?: boolean;
    report?: WeeklyReportData;
    cached?: boolean;
    notEnough?: boolean;
    error?: string;
  };

  try {
    const data = await apiClient.post<WireResponse>('/api/wisdom-center', {
      userId,
    });
    if (data.notEnough) return { kind: 'notEnough' };
    if (data.success && data.report) {
      return { kind: 'success', report: data.report };
    }
    return { kind: 'error', message: data.error || 'Failed to generate report' };
  } catch (e) {
    return {
      kind: 'error',
      message: e instanceof Error ? e.message : 'Network error',
    };
  }
}
