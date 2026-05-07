/**
 * Daily / monthly limit API wrapper -- Stage 5.IAP.4.
 *
 * Pre-flight quota check used by the record modal on phase entry. If
 * the server says the user is at or over their monthly insight quota,
 * we route them to the paywall before they spend time recording or
 * typing.
 *
 * The publish-wisdom server endpoint is the authoritative gate (also
 * Stage 5.IAP.4); this client check is purely UX -- skipping it would
 * still result in a 402 from publish-wisdom on the actual publish.
 */
import { apiClient } from './api';
import { getCachedSubscriptionTier } from './subscription';

export type DailyLimitResponse = {
  success: boolean;
  allowed: boolean;
  usedThisMonth: number;
  remaining: number;
  monthlyLimit: number;
  tier?: string;
  error?: string;
};

/**
 * GET /api/daily-limit?userId=...&clientTier=...
 *
 * The clientTier query is sent so the server can resolve a fresh-
 * purchase race (Apple StoreKit dialog returns before our /api/apple-
 * iap upload + DB write settles). Server takes max(dbTier, clientTier).
 */
export async function fetchDailyLimit(
  userId: string,
): Promise<DailyLimitResponse> {
  const clientTier = getCachedSubscriptionTier();
  const qs = new URLSearchParams({ userId });
  if (clientTier && clientTier !== 'free') {
    qs.set('clientTier', clientTier);
  }
  return apiClient.get<DailyLimitResponse>(
    `/api/daily-limit?${qs.toString()}`,
  );
}
