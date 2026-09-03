import { Asset } from 'expo-asset';
import { Image as ExpoImage } from 'expo-image';

import { nativeSyncLatestFriendReflect } from '../../modules/widget-sync';
import { ITEM_IMAGES } from './item-images.g';
import { getDefaultAvatar } from './avatar';
import { remoteImageUri } from './remote-items';
import type { FeedEntry, PairingStatus } from './friends-api';

/**
 * Pushes the complete Paired state to the native home-screen widget:
 * unpaired, paired-with-no-shared-moment, or the newest shared moment.
 * Fire-and-forget: no-ops only when the optional native module is absent.
 */
export async function syncWidgetLatestFriend(
  feed: FeedEntry[],
  pairing: PairingStatus | null = null,
): Promise<void> {
  const partner = pairing?.paired ? pairing.partner : null;
  // Never let a previous partner's cached row leak into a new pairing.
  const eligible = partner
    ? feed.filter((entry) => entry.friendUserId === partner.userId)
    : feed;
  // The feed arrives unread-first, not newest-first — pick the true latest.
  const latest = eligible.length > 0
    ? eligible.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b))
    : null;
  try {
    if (!latest) {
      await nativeSyncLatestFriendReflect(JSON.stringify({
        state: partner ? 'empty' : 'unpaired',
        name: partner?.displayName ?? '',
        createdAt: '',
        avatar: null,
        items: [],
        totalItems: 0,
      }));
      return;
    }
    const items = await Promise.all(
      latest.itemIds.slice(0, 6).map(async (itemId, i) => {
        // A published R2 replacement/addition wins over the bundled fallback,
        // matching ItemSprite everywhere else in the app.
        let src: string | null = remoteImageUri(itemId) || null;
        if (src) {
          // Reuse the exact R2 bytes already rendered by ItemSprite. This
          // avoids a second network race in the widget process and prevents
          // an older bundled icon from lingering after an admin replacement.
          src = await ExpoImage.getCachePathAsync(src) ?? src;
        }
        const mod = ITEM_IMAGES[itemId];
        if (!src && mod) {
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
        state: 'latest',
        name: latest.friendName,
        createdAt: latest.createdAt,
        avatar: avatarSrc ? { src: avatarSrc } : null,
        items,
        totalItems: latest.itemIds.length,
      }),
    );
  } catch {
    // widget sync must never break the feed path
  }
}
