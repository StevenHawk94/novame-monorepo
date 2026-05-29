import { apiClient } from './api';

export type Announcement = {
  id: string;
  title: string;
  content: string;
  type: string;
  target_users?: string;
  priority?: number;
  start_at?: string | null;
  end_at?: string | null;
  created_at?: string;
};

type GetResponse = {
  success?: boolean;
  announcement?: Announcement | null;
};

/**
 * Fetch the single highest-priority unread, in-window, tier-targeted
 * announcement for this user. The backend (/api/announcements GET) does ALL
 * filtering (is_active / start_at / end_at / target_users / already-read) and
 * returns at most one row, or null.
 *
 * Fail-silent: any network / auth / parse error returns null so a flaky
 * announcement check never disrupts Home. apiClient attaches the user's
 * Supabase Bearer token automatically; the route requires it.
 */
export async function fetchUnreadAnnouncement(
  userId: string,
): Promise<Announcement | null> {
  try {
    const qs = new URLSearchParams({ userId });
    const data = await apiClient.get<GetResponse>(
      `/api/announcements?${qs.toString()}`,
    );
    return data?.announcement ?? null;
  } catch {
    return null;
  }
}

/**
 * Mark an announcement read for this user. Server upserts (idempotent).
 * Fire-and-forget: errors are swallowed; worst case the same announcement
 * reappears on a later check.
 */
export async function markAnnouncementRead(
  userId: string,
  announcementId: string,
): Promise<void> {
  try {
    await apiClient.post('/api/announcements', { userId, announcementId });
  } catch {
    // best-effort
  }
}
