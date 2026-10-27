import { Platform, TurboModuleRegistry } from 'react-native';
import type { MajorUpdateBootstrap, MajorUpdateCatalogItem } from './app-major-update-api';
import { BURROW_FIXED_ART, HOME_BACKGROUND_FLOOR, burrowArtFor, burrowArtForItem } from './burrow-art-assets';
import { HOME_ART_PLACEMENTS } from './burrow-home-layout';
import { roomSlots } from './burrow-presentation';
import { burrowMapEnvironment } from './burrow-map-model';
import { countryForVisit } from './use-burrow-storefront';
import { OUTFIT_LAYERS, outfitKey } from './burrow-outfit-assets';
import {bunnyLayers,type BunnyVariant} from './bunny-variant-assets';
import {bunnyVariant} from './bunny-identity';
import { prepareBurrowImages, preparedBurrowImage, preparedImageKey, retainHomeImages } from './prepared-burrow-images';
import { loadRoomPhoto } from './burrow-room-photo-cache';
import { COIN_UI_ASSET } from './coin-ui-asset';
import {prepareBurrowEnvironment,refreshBurrowEnvironment} from './burrow-environment-state';

export function homeArtSources(slots: Record<string, MajorUpdateCatalogItem>, season: string) {
  const background=burrowArtFor('backgrounds', { autumn: 1, spring: 2, summer: 3, winter: 4 }[season]);
  return [HOME_BACKGROUND_FLOOR.source,background?.source,background?.nightSource,
    burrowArtForItem(slots.wallpaper, 'wallpapers')?.source,
    ...HOME_ART_PLACEMENTS.map(item => burrowArtForItem(slots[item.slot], item.category)?.source),
    burrowArtForItem(slots.frame, 'frames')?.source, burrowArtForItem(slots.couple_doll, 'couple_dolls')?.source,
    BURROW_FIXED_ART.letter.source, COIN_UI_ASSET,
  ].filter((source): source is NonNullable<typeof source> => source != null);
}
let prepared: { key: string; promise: Promise<void> } | null = null;
const readyKeys=new Set<string>();
function homePreparation(data?:MajorUpdateBootstrap|null) {
  const slots=data?roomSlots(data,data.profile.id):{};
  const season=burrowMapEnvironment(Date.now(),data?.profile.timezone_name??undefined,countryForVisit()).season;
  const sources=homeArtSources(slots,season);
  const variant=bunnyVariant(data?.profile.id);
  const bunny=Object.values(bunnyLayers(outfitKey(slots.outfit),variant)).filter((value):value is number=>typeof value==='number');
  // A furniture handoff must not wait for every unused Plushie's private
  // photo. Only the frame and the currently displayed costume are on Home.
  const photos=data?.roomPhotos.filter(photo=>photo.ownerId===data.profile.id
    &&(photo.kind==='frame'||photo.kind==='doll'&&photo.toyId===slots.couple_doll?.stable_id))??[];
  const key=`${sources.map(preparedImageKey).join('|')}:${outfitKey(slots.outfit)}:${variant}:${photos.map(photo=>`${photo.id}:${photo.updatedAt}`).join('|')}`;
  return {slots,sources,bunny,photos,key,variant};
}
/** The returning retained Home may consume a predecoded design synchronously,
 * without revealing its old preparedHome while a focus effect catches up. */
export function isHomeArtPrepared(data:MajorUpdateBootstrap) {
  const {key,sources,bunny}=homePreparation(data);
  return readyKeys.has(key)&&[...sources,...bunny].every(source=>!!preparedBurrowImage(source));
}
export function prepareHomeArt(data?: MajorUpdateBootstrap | null) {
  const {slots,sources,bunny,photos,key,variant}=homePreparation(data);
  const environment=prepareBurrowEnvironment({owner:data?.profile.id??'',timeZone:data?.profile.timezone_name,country:countryForVisit()});
  if (prepared?.key === key) return Promise.all([prepared.promise,environment]).then(()=>{});
  const entry = { key, promise: Promise.resolve() };
  entry.promise = (async () => {
    await environment;
    await prepareBurrowImages(sources);
    await prepareBurrowImages(bunny,512);
    // Animated Skia and Expo Image have separate native image representations.
    if (Platform.OS !== 'web' && (globalThis.SkiaApi || TurboModuleRegistry.get('RNSkiaModule'))) {
      await require('./prepared-bunny').prepareBunny(outfitKey(slots.outfit),variant);
    }
    const photoSources=await Promise.all(photos.map(async photo => {
      const uri = await loadRoomPhoto(photo);
      await prepareBurrowImages([{ uri }], 800);
      return {uri};
    }));
    await refreshBurrowEnvironment();
    readyKeys.add(key);
    while(readyKeys.size>16)readyKeys.delete(readyKeys.values().next().value!);
    if(prepared===entry)retainHomeImages([...sources,...bunny,...photoSources]);
  })().catch(error => { if (prepared === entry) prepared = null; throw error; });
  prepared = entry;
  retainHomeImages([...sources,...bunny]);
  return entry.promise;
}
export async function prepareHomeBunnyVariant(data:MajorUpdateBootstrap,variant:BunnyVariant){
 const key=outfitKey(roomSlots(data,data.profile.id).outfit);
 const sources=Object.values(bunnyLayers(key,variant)).filter((value):value is number=>typeof value==='number');
 await prepareBurrowImages(sources,512);
 if(Platform.OS!=='web'&&(globalThis.SkiaApi||TurboModuleRegistry.get('RNSkiaModule')))await require('./prepared-bunny').prepareBunny(key,variant);
}
