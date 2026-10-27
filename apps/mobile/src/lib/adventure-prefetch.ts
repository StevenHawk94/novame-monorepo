import { prepareAdventureEncounters } from './app-major-update-api';
import { ensurePriorityR2Image } from './download-queue';
import { sessionEpoch, subscribeSessionIdentity } from './session-lifecycle';
import { Image as NativeImage } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import type { MajorUpdateBootstrap } from './app-major-update-api';
import { burrowFriendArt } from './burrow-ui-assets';
import { BURROW_BACKGROUNDS, BURROW_FIXED_ART, burrowArtForItem } from './burrow-art-assets';
import { ADVENTURE_COIN_ART } from './adventure-treasure-art';
import { normalizeMetroAssetUri } from './metro-asset-uri';
import { prepareBurrowImage, retainNotificationImages } from './prepared-burrow-images';

let flight: Promise<void> | null = null;
let lastPrepared = 0;
const warmed = new Set<string>();
const imageFlights=new Map<string,Promise<void>>();
subscribeSessionIdentity(() => { flight = null; lastPrepared = 0; warmed.clear();imageFlights.clear();retainNotificationImages([]); });

/** Warm the complete pages as well as character poses/rewards before the chest. */
export async function warmAdventureCompletion(data: MajorUpdateBootstrap) {
  if(!data.activeAdventure){retainNotificationImages([]);return;}
  const meta = data.adventureResult?.metadata ?? data.adventurePlan?.result.metadata;
  const sources = [BURROW_BACKGROUNDS.adventureFinish, BURROW_BACKGROUNDS.adventureFriends,
    BURROW_FIXED_ART.treasureClosed, BURROW_FIXED_ART.treasureOpen, ADVENTURE_COIN_ART?.source,
    ...(meta?.encounterV2 ? [burrowArtForItem(meta.treasureSnapshot ?? undefined)?.source, burrowArtForItem(meta.giftSnapshot)?.source,
      burrowFriendArt(meta.friendSnapshot?.name), burrowFriendArt(meta.friendSnapshot?.name, true)] : [])];
  const epoch=sessionEpoch();
  retainNotificationImages(sources.filter(source=>source!=null));
  await Promise.all(sources.filter(source=>source!=null).map(async source => {
    const raw = typeof source === 'number' ? NativeImage.resolveAssetSource(source)?.uri
      : source && typeof source === 'object' && 'uri' in source ? source.uri : null;
    const url = raw ? normalizeMetroAssetUri(raw) : null;
    if (!url) return;
    const pending=imageFlights.get(url);if(pending)return pending;
    const task=(async()=>{
      if(!warmed.has(url)){
        const ok=await (url.startsWith('https://') ? ensurePriorityR2Image(url,-1) : ExpoImage.prefetch(url,'memory-disk'));
        if(!ok)throw Error('adventure_art_unavailable');
      }
      // File prefetch alone is not first-frame readiness. Share the decoded
      // native ref with the destination's real Image component.
      await prepareBurrowImage(source,1200);
      if(epoch===sessionEpoch())warmed.add(url);
    })().finally(()=>{if(imageFlights.get(url)===task)imageFlights.delete(url);});
    imageFlights.set(url,task);return task;
  }));
}

/** Server reserves exactly two immutable outcomes. Never block typing on downloads. */
export function prefetchAdventureRewards(enabled = false): void {
  if (!enabled || flight || Date.now() - lastPrepared < 30_000) return;
  const epoch = sessionEpoch();
  const request = (async () => {
    const result = await prepareAdventureEncounters();
    if (epoch !== sessionEpoch()) return;
    await Promise.all(result.gifts.slice(0, 2).map(gift => ensurePriorityR2Image(gift.url, -1)));
    if (epoch === sessionEpoch()) lastPrepared = Date.now();
  })().catch(() => { /* Offline entry is still usable; start retries reservation atomically. */ });
  flight = request;
  void request.finally(() => { if (flight === request) flight = null; });
}
