import { apiClient } from './api';
import { withDeadline } from './async-lifecycle';
import { sessionEpoch, subscribeSessionIdentity } from './session-lifecycle';

export type CoupleJournalAnswer = {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};
export type CoupleJournalPage = {
  id: string;
  date: string;
  private: boolean;
  pageNumber: number;
  questionId: string;
  question: string;
  answers: CoupleJournalAnswer[];
};
export type CoupleJournalSnapshot = {
  today: CoupleJournalPage;
  history: CoupleJournalPage[];
  hasMore: boolean;
  nextBefore: string | null;
  todayDate: string;
  timezone: string;
  pairVersion: string;
};

let cached: { scope: string; data: CoupleJournalSnapshot } | null = null;
subscribeSessionIdentity(() => { cached = null; });
export function cachedCoupleJournal(scope: string) {
  if (cached?.scope !== scope) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit', timeZone: cached.data.timezone,
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}` === cached.data.todayDate ? cached.data : null;
  } catch { return null; }
}
export function cacheCoupleJournal(scope: string, data: CoupleJournalSnapshot) {
  cached = { scope, data };
}

export async function fetchCoupleJournal(before?: string) {
  const epoch = sessionEpoch();
  const path = `/api/vnext/couple-journal${before ? `?before=${encodeURIComponent(before)}` : ''}`;
  const result = await withDeadline(
    apiClient.get<CoupleJournalSnapshot & { success: boolean }>(path), 20_000,
  );
  if (epoch !== sessionEpoch()) throw new Error('session_changed');
  if (!result.success) throw new Error('journal_unavailable');
  return result;
}

export async function saveCoupleJournalAnswer(
  pageId: string, body: string, expectedUpdatedAt: string | null, idempotencyKey: string,
) {
  const epoch = sessionEpoch();
  const result = await withDeadline(
    apiClient.post<{ success: boolean; page: CoupleJournalPage }>('/api/vnext/couple-journal', {
      pageId, body, expectedUpdatedAt, idempotencyKey,
    }), 20_000,
  );
  if (epoch !== sessionEpoch()) throw new Error('session_changed');
  if (!result.success) throw new Error('journal_unavailable');
  return result.page;
}
