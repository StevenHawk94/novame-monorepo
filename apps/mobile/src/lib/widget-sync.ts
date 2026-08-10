import { Platform } from 'react-native';
import { Asset } from 'expo-asset';

import { nativeSyncLatestFriendReflect } from '../../modules/widget-sync';
import { ITEM_IMAGES } from './item-images.g';
import { getDefaultAvatar } from './avatar';
import type { FeedEntry } from './friends-api';

/**
 * Pushes the newest friend-feed entry to the iOS home-screen widget:
 * name, timestamp, the friend's avatar (their uploaded photo, else the
 * bundled default portrait picked from their userId) and up to 6 item
 * images, all via the App Group container.
 * Fire-and-forget: no-ops on Android, Expo Go, or an empty feed.
 */
export async function syncWidgetLatestFriend(feed: FeedEntry[]): Promise<void> {
  if (Platform.OS !== 'ios' || feed.length === 0) return;
  // The feed arrives unread-first, not newest-first — pick the true latest.
  const latest = feed.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b));
  try {
    const items = await Promise.all(
      latest.itemIds.slice(0, 6).map(async (itemId, i) => {
        let src: string | null = null;
        const mod = ITEM_IMAGES[itemId];
        if (mod) {
          try {
            const asset = Asset.fromModule(mod);
            if (!asset.localUri) await asset.downloadAsync();
            src = asset.localUri;
          } catch {
            // fall back to the emoji tile
          }
        }
        return { src, emoji: latest.emoji[i] ?? '✨' };
      }),
    );
    // Avatar: real upload wins; otherwise the friend's assigned bundled
    // default (same resolution as UserAvatar in-app).
    let avatarSrc: string | null = null;
    if (latest.friendAvatarUrl && latest.friendIsDefaultAvatar === false) {
      avatarSrc = latest.friendAvatarUrl;
    } else {
      try {
        const asset = Asset.fromModule(getDefaultAvatar(latest.friendUserId));
        if (!asset.localUri) await asset.downloadAsync();
        avatarSrc = asset.localUri;
      } catch {
        // widget falls back to its 🐰 placeholder
      }
    }
    await nativeSyncLatestFriendReflect(
      JSON.stringify({
        name: latest.friendName,
        createdAt: latest.createdAt,
        avatar: avatarSrc ? { src: avatarSrc } : null,
        items,
      }),
    );
  } catch {
    // widget sync must never break the feed path
  }
}
