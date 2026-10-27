import type { MajorUpdateBootstrap } from './app-major-update-api';
import type { GameSummary } from './burrow-game-room-api';
import type { ImageProps } from 'expo-image';
import { burrowArtForItem, BURROW_BACKGROUNDS } from './burrow-art-assets';
import { prepareBurrowImages, preparedImageKey, preparedBurrowImage, retainPageImages } from './prepared-burrow-images';
import { decorationOptions } from './burrow-collection-options';
import { BURROW_SHOP_CATEGORIES } from './burrow-shop-categories';
import {getAppViewport} from './app-viewport';
import { gameRoomInitialRows } from './game-room-layout';
export type PreparedPage = 'shop' | 'game' | 'surprise' | 'release' | 'affection' | 'adventure';
const ready = new Set<string>();
const pending = new Map<string, Promise<void>>();
function sources(kind: PreparedPage, data: MajorUpdateBootstrap) {
  if(kind==='affection')return [BURROW_BACKGROUNDS.affectionSend,
    ...Object.values(require('./burrow-ui-assets').BURROW_AFFECTION_ICONS)] as ImageProps['source'][];
  if(kind==='adventure'){
    const entry=require('./burrow-ui-assets').BURROW_ADVENTURE_ENTRY_ART;
    const {start,current,end}=require('./adventure-progress-assets').ADVENTURE_PROGRESS_ART;
    return [...Object.values(entry),start,current,end] as ImageProps['source'][];
  }
  if(kind==='surprise')return require('./surprise-frame-assets').SURPRISE_FRAME_OPTIONS.slice(0,9).map((frame:{source:number})=>frame.source) as number[];
  if(kind==='release')return [require('../../assets/burrow-webp/monster-bg.webp'),
    ...Object.values(require('./monster-images').MONSTER_ART as Record<string,{normal:number;hit:number}>).flatMap(art=>[art.normal,art.hit])];
  if(kind==='game'){
    const art=require('./burrow-game-room-art');
    const {GAME_ROOM_GAMES,GAME_ROOM_CATEGORIES,gameRailItems}=require('./burrow-game-room-content');
    const games=GAME_ROOM_GAMES as GameSummary[];
    const window=getAppViewport();
    const first=(GAME_ROOM_CATEGORIES as string[]).slice(0,gameRoomInitialRows(window.width,window.height,GAME_ROOM_CATEGORIES.length)).flatMap(category=>gameRailItems(games.filter(game=>game.category===category).map(game=>{
      const offer=data.catalog.find(item=>item.stable_id===`game:${game.id}`);
      return {...game,active:!!offer,plus_only:offer?.plus_only??game.plus_only};
    })).slice(0,4)) as GameSummary[];
    // Decode every potentially visible rail before entry, not only two rows.
    return [...first.map(game=>art.gameRoomIcons[game.id]),
      ...require('./burrow-ui-assets').BURROW_GAME_RULE_ICONS,
      require('../../assets/burrow-webp/game room/waiting-page.webp')] as ImageProps['source'][];
  }
  return [BURROW_BACKGROUNDS.common,...BURROW_SHOP_CATEGORIES.slice(0,2)
    .flatMap(category=>decorationOptions(data.catalog,category,false,data.profile?.id??'',data.inventory??[]).slice(0,9))
    .map(item=>{const art=burrowArtForItem(item);return art?.thumbnail??art?.source;}).filter((source):source is NonNullable<typeof source>=>source!=null)];
}
const keyFor=(kind:PreparedPage,data:MajorUpdateBootstrap)=>`${kind}:${sources(kind,data).map(preparedImageKey).join('|')}`;
export const burrowPageArtReady=(kind:PreparedPage,data:MajorUpdateBootstrap)=>ready.has(keyFor(kind,data))&&sources(kind,data).every(source=>!!preparedBurrowImage(source));
export function warmBurrowPageArt(kind:PreparedPage,data:MajorUpdateBootstrap,{retain=true}:{retain?:boolean}={}) {
  const key=keyFor(kind,data);
  if(retain)retainPageImages(sources(kind,data));
  if(burrowPageArtReady(kind,data))return Promise.resolve();
  const active=pending.get(key);if(active)return active;
  const task=prepareBurrowImages(sources(kind,data),kind==='affection'||kind==='adventure'?1600:kind==='release'?1200:600).then(()=>{ready.add(key);})
    .finally(()=>{pending.delete(key);});
  pending.set(key,task);return task;
}
