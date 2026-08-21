import { apiClient } from './api';
import { Image as ExpoImage } from 'expo-image';
import { enqueueR2Image } from './download-queue';

export type Announcement = {
  id: string;
  title: string;
  content: string;
  image_url?: string | null;
  type: string;
  target_users?: string;
  priority?: number;
  start_at?: string | null;
  end_at?: string | null;
  created_at?: string;
};

const IMAGE_PRELOAD_TIMEOUT_MS = 5000;
const preparedByUser = new Map<string, Announcement>();
const prepareInFlight = new Map<string, Promise<Announcement | null>>();

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

async function prefetchImageBeforeDeadline(uri: string): Promise<boolean> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      ExpoImage.prefetch(uri, 'disk').then(Boolean).catch(() => false),
      new Promise<boolean>((resolve) => {
        timeoutId = setTimeout(() => resolve(false), IMAGE_PRELOAD_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Prepare the next announcement without ever rendering an empty image frame.
 * The image prefetch is capped at five seconds for this launch. The underlying
 * Expo image request is allowed to finish in the disk cache after the timeout,
 * so a later foreground check can show it immediately.
 */
export function prepareUnreadAnnouncement(
  userId: string,
): Promise<Announcement | null> {
  const prepared = preparedByUser.get(userId);
  if (prepared) return Promise.resolve(prepared);

  const active = prepareInFlight.get(userId);
  if (active) return active;

  const request = (async () => {
    const announcement = await fetchUnreadAnnouncement(userId);
    const imageUrl = announcement?.image_url?.trim();
    if (!announcement || !imageUrl) return null;
    // Keep retrying an R2 announcement image in the foreground even if the
    // five-second display deadline below is missed this time.
    enqueueR2Image(imageUrl, 0);
    if (!await prefetchImageBeforeDeadline(imageUrl)) return null;
    preparedByUser.set(userId, announcement);
    return announcement;
  })().finally(() => {
    prepareInFlight.delete(userId);
  });

  prepareInFlight.set(userId, request);
  return request;
}

export function clearPreparedAnnouncement(
  userId: string,
  announcementId?: string,
): void {
  const prepared = preparedByUser.get(userId);
  if (!prepared || (announcementId && prepared.id !== announcementId)) return;
  preparedByUser.delete(userId);
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
