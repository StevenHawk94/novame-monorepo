import { Asset } from 'expo-asset';

import { nativeSyncLatestFriendReflect } from '../../modules/widget-sync';
import { ITEM_IMAGES } from './item-images.g';
import { TAP_PERSON_IMAGES } from './tap-person-images';
import { baseItemIconUrl } from './base-item-icons';
import { ensurePriorityR2Image } from './download-queue';
import {initialAvatar,uploadedAvatarUri} from './avatar';
import {sessionUserId} from './session-lifecycle';
import { remoteImageUri } from './remote-items';
import type { FeedEntry, PairingStatus } from './friends-api';
import {widgetUpdatesEnabled} from './widget-policy';
// Retain the native widget implementation for a future redesign. Clear stale
// private content once, but do not copy avatars/icons or refresh its feed.
let pausedWidgetCleared=false;
async function pauseWidget(){
  if(pausedWidgetCleared)return;
  const cleared=await nativeSyncLatestFriendReflect(JSON.stringify({state:'unpaired',name:'',createdAt:'',avatar:null,items:[],totalItems:0}));
  if(cleared)pausedWidgetCleared=true;
}

/**
 * Pushes the complete Paired state to the native home-screen widget:
 * unpaired, paired-with-no-shared-moment, or the newest shared moment.
 * Fire-and-forget: no-ops only when the optional native module is absent.
 */
export async function syncWidgetLatestFriend(
  feed: FeedEntry[],
  pairing: PairingStatus | null = null,
): Promise<void> {
  if(!widgetUpdatesEnabled()){await pauseWidget();return;}
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
        const bundled = ITEM_IMAGES[itemId] ?? TAP_PERSON_IMAGES[itemId];
        let src: string | null = remoteImageUri(itemId)
          || (!bundled ? baseItemIconUrl(itemId) : '')
          || null;
        if (src) {
          // Reuse the exact R2 bytes already rendered by ItemSprite. This
          // avoids a second network race in the widget process and prevents
          // an older bundled icon from lingering after an admin replacement.
          src = await ensurePriorityR2Image(src);
        }
        // Tap Your Day uses its own curated asset table. Without this lookup,
        // those ids fell through to dictionary emoji (for example Family ->
        // the system 🐰), so the widget did not match the in-app Paired UI.
        const mod = bundled;
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
    const avatarSrc=uploadedAvatarUri(latest.friendAvatarUrl,latest.friendIsDefaultAvatar);
    const fallback=initialAvatar(latest.friendUserId,latest.friendName,sessionUserId());
    await nativeSyncLatestFriendReflect(
      JSON.stringify({
        state: 'latest',
        name: latest.friendName,
        createdAt: latest.createdAt,
        avatar: { ...(avatarSrc?{src:avatarSrc}:{}), initial:fallback.initial, backgroundColor:fallback.backgroundColor },
        items,
        totalItems: latest.itemIds.length,
      }),
    );
  } catch {
    // widget sync must never break the feed path
  }
}
