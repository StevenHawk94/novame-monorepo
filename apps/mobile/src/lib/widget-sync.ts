import { Platform } from 'react-native';
import { Asset } from 'expo-asset';

import { nativeSyncLatestFriendReflect } from '../../modules/widget-sync';
import { ITEM_IMAGES } from './item-images.g';
import type { FeedEntry } from './friends-api';

/**
 * Pushes the newest friend-feed entry to the iOS home-screen widget
 * (avatar is the app's 🐰 placeholder, drawn widget-side; we ship the
 * name, timestamp and up to 6 item images via the App Group container).
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
    await nativeSyncLatestFriendReflect(
      JSON.stringify({ name: latest.friendName, createdAt: latest.createdAt, items }),
    );
  } catch {
    // widget sync must never break the feed path
  }
}
