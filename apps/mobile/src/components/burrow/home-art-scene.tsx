import { BackIcon } from './burrow-back-button';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import { Image } from './burrow-image';
import {CoinWallet} from './coin-wallet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {GestureDetector} from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import {useHomePullPreview} from '@/lib/use-home-pull-preview';
import type { MajorUpdateBootstrap, MajorUpdateCatalogItem } from '@/lib/app-major-update-api';
import type { HomeWalletAnchor } from '@/lib/daily-plus-bonus';
import { RoomPhoto } from './room-photo';
import { UpdateBadge } from './update-badge';
import { HomeLoveLetter } from './home-love-letter';
import { OutfitBunny } from './outfit-bunny';
import { homeBunnyBox } from '@/lib/bunny-idle-motion';
import { useBurrowEnvironment } from '@/lib/use-burrow-environment';
import { RoomPhotoPlaceholder } from './room-photo-placeholder';
import { DollPhotoPreview } from './doll-photo-preview';
import { toyPhotoFor } from '@/lib/burrow-toy-photos';
import { dollFaceRect, framePhotoRect } from '@/lib/burrow-doll-face';
import { burrowArtFor, burrowArtForItem, HOME_BACKGROUND_FLOOR, HOME_WINDOW_LANDSCAPES } from '@/lib/burrow-art-assets';
import { WindowArtwork } from './window-artwork';
import { HOME_ART_HEIGHT, HOME_ART_WIDTH, HOME_ART_PLACEMENTS as art, HOME_DOLL_PLACEMENT as dollPlacement, HOME_FRAME_PLACEMENT, homeAnchoredBox as anchoredBox, homeArtLayout, homeTabBarHeight, homeBackgroundLayout } from '@/lib/burrow-home-layout';

// Coordinates are taken from the 900 × 1950 positioning reference. The art
// canvas is aligned with the bottom of the whole display, including the tab
// bar, so shorter displays crop its top instead of pushing furniture down.
export const DESIGN_WIDTH = HOME_ART_WIDTH;
export const DESIGN_HEIGHT = HOME_ART_HEIGHT;
const EMPTY_PHOTOS:MajorUpdateBootstrap['roomPhotos']=[];

type Props = {
  timeZone?: string | null;
  now?: number;
  updates?: { letter: number; affection: number; adventure: number };
  balance: number | null;
  onWalletAnchor?: (anchor: HomeWalletAnchor) => void;
  slots: Record<string, MajorUpdateCatalogItem>;
  photos?: MajorUpdateBootstrap['roomPhotos'];
  ownerId: string;
  away?: boolean;
  busy?: boolean;
  pullToPeekEnabled?: boolean;
  onMenu: () => void;
  onCarrots: () => void;
  onAffection: () => void;
  previewBottomCrop?: number;
  previewOnly?: boolean;
  previewInteractive?: boolean;
  initialSize?: { width: number; height: number };
  onToyInteract?: () => void;
  onToyPhoto?: () => void;
  toyPulse?: number;
  onAdventure: () => void;
  onLetter: () => void;
  onBurrows: () => void;
  /** Compatibility for previews; Home furniture is never a decorate shortcut. */
  onDecorate?: () => void;
  onSlot: (slot: string) => void;
  partnerRoom?: { name: string; onBack: () => void; onGift: () => void; onSurprise: () => void; onTouch?:()=>void; touchIndicator?:ReactNode };
};

export function HomeArtScene({ timeZone, now, updates, balance, onWalletAnchor, slots, photos = EMPTY_PHOTOS, ownerId, away, busy, pullToPeekEnabled=false, onMenu, onCarrots, onAffection, previewOnly = false, previewInteractive = false, previewBottomCrop = 0, initialSize, onToyInteract, onToyPhoto, onAdventure, onLetter, onBurrows, onSlot, partnerRoom }: Props) {
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [layout, setLayout] = useState(() => initialSize ?? {
    width: window.width,
    height: window.height - (partnerRoom ? 0 : homeTabBarHeight(window.width, insets.bottom)),
  });
  const tabBarHeight = partnerRoom ? 0 : homeTabBarHeight(layout.width, insets.bottom);
  const { scale, artWidth, left: artLeft } = homeArtLayout(layout.width, layout.height, tabBarHeight, previewOnly);
  const pull=useHomePullPreview({enabled:pullToPeekEnabled&&!previewOnly&&!partnerRoom&&!busy,
    scale,visibleHeight:layout.height+tabBarHeight,scope:ownerId});
  // Parent focus/clock/badge updates must not reconstruct the entire room's
  // element tree. Stable dispatchers still use the latest permission/business
  // closures; memoized artwork must never retain an old purchase/partner state.
  const actions=useRef({onSlot,onToyInteract,onToyPhoto,onLetter,onBurrows});actions.current={onSlot,onToyInteract,onToyPhoto,onLetter,onBurrows};
  const slotAction=useCallback((slot:string)=>actions.current.onSlot(slot),[]);
  const toyAction=useCallback(()=>{const value=actions.current;if(value.onToyInteract)value.onToyInteract();else value.onSlot('couple_doll');},[]);
  const toyPhotoAction=useCallback(()=>{const value=actions.current;(value.onToyPhoto??value.onToyInteract)?.();},[]);
  const letterAction=useCallback(()=>actions.current.onLetter(),[]),burrowsAction=useCallback(()=>actions.current.onBurrows(),[]);
  const partnerName=partnerRoom?.name,canEditToy=!!(onToyPhoto||onToyInteract);
  const frame = photos.find(photo => photo.ownerId === ownerId && photo.kind === 'frame');
  const doll = toyPhotoFor(photos, ownerId, slots.couple_doll?.stable_id);
  const dollArt = burrowArtForItem(slots.couple_doll, 'couple_dolls');
  const wallpaper = burrowArtForItem(slots.wallpaper, 'wallpapers') ?? burrowArtFor('wallpapers')!;
  const environment = useBurrowEnvironment(timeZone, now);
  // Shop/Decorate preview the design, not the live adventure's presence.
  // Keep the selected outfit visible there without changing the actual room.
  const bunnyAway = !!away && !previewOnly;
  const season = burrowArtFor('backgrounds', { autumn: 1, spring: 2, summer: 3, winter: 4 }[environment.season])!;
  const backgroundLayout=homeBackgroundLayout();
  const rimSource=environment.period==='night'?season.nightSource??season.source:season.source;
  const box = (x: number, y: number, w: number, h: number) => ({ position: 'absolute' as const, left: x * scale, top: y * scale, width: w * scale, height: h * scale });
  const hotspot = (label: string, slot: string, x: number, y: number, w: number, h: number) =>
    <Pressable key={slot} accessibilityRole="button" accessibilityLabel={label} disabled={busy} onPress={pull.guard(() => slotAction(slot))} style={box(x, y, w, h)} />;

  const artwork=useMemo(()=><>
      <Image source={wallpaper.source} contentFit="fill" pointerEvents="none" style={box(0, DESIGN_HEIGHT - 700 - 1200, 900, 1200)} />
      {/* Keep the old 900x2000 sheet's floor anchor, rim gap and top crop.
          Both periods occupy ONE source canvas; furniture is never repositioned. */}
      {/* These boxes already have the source aspect ratios. Native pixel-grid
          rounding can change that ratio by <1px: contain would letterbox the
          sides. Fill the SAME boxes, without overscan or geometry changes. */}
      <Image source={HOME_BACKGROUND_FLOOR.source} contentFit="fill" pointerEvents="none" testID="home-background-floor"
        style={box(backgroundLayout.floor.x,backgroundLayout.floor.y,backgroundLayout.floor.width,backgroundLayout.floor.height)}/>
      <Image source={rimSource} contentFit="fill" pointerEvents="none" testID="home-background-rim" accessibilityLabel={`${environment.season} ${environment.period??'day'} landscape`}
        style={box(backgroundLayout.rim.x,backgroundLayout.rim.y,backgroundLayout.rim.width,backgroundLayout.rim.height)}/>
      {art.map(item => {
        const asset = burrowArtForItem(slots[item.slot], item.category);
        if (asset && item.category === 'windows') return <WindowArtwork key={item.key} asset={asset}
          landscape={HOME_WINDOW_LANDSCAPES[environment.season][environment.period]} style={anchoredBox(asset, item, scale)}/>;
        return asset && <Image key={item.key} source={asset.source} contentFit="fill" style={anchoredBox(asset, item, scale)} pointerEvents="none" />;
      })}
      {/* Keep this renderer/resources mounted while away and behind Adventure.
          Returning Home must reveal a ready bunny, not start a new decoder. */}
      <View pointerEvents="none" accessibilityElementsHidden={bunnyAway} importantForAccessibility={bunnyAway ? 'no-hide-descendants' : 'auto'}
        style={[homeBunnyBox(scale), { opacity: bunnyAway ? 0 : 1 }]}>
        <OutfitBunny outfit={slots.outfit} ownerId={ownerId} width={homeBunnyBox(scale).width} height={homeBunnyBox(scale).height}
          animated={!previewOnly && !partnerRoom} staticComposite={previewOnly} active={!bunnyAway}/>
      </View>

      {/* User photos are private and never embedded in the bundled reference art. */}
      {(() => { const asset = burrowArtForItem(slots.frame, 'frames');
        return asset && <View pointerEvents="none" style={anchoredBox(asset, HOME_FRAME_PLACEMENT, scale)}>
          <Image source={asset.source} contentFit="fill" style={styles.fill} />
          <View style={[styles.framePhoto, framePhotoRect(asset)]}>{frame ? <RoomPhoto photo={frame} /> : <RoomPhotoPlaceholder kind="frame" />}</View>
        </View>; })()}
      {dollArt&&(previewOnly?<View pointerEvents="none" style={anchoredBox(dollArt, dollPlacement, scale)}>
        <View style={[styles.dollPhoto,dollFaceRect(dollArt)]}>{doll ? <RoomPhoto photo={doll} /> : <RoomPhotoPlaceholder kind="doll" />}</View><Image source={dollArt.source} contentFit="fill" style={styles.fill} />
      </View>:partnerName!==undefined?<DollPhotoPreview asset={dollArt} photo={doll} style={anchoredBox(dollArt,dollPlacement,scale)}
        disabled={busy} onEditPhoto={canEditToy?pull.guard(toyPhotoAction):undefined} label={`Change ${partnerName}'s doll photo`}/>:<Pressable
        accessibilityRole="button" accessibilityLabel="Open Toy" disabled={busy}
        onPress={pull.guard(toyAction)} style={anchoredBox(dollArt,dollPlacement,scale)}>
        {/* Home is only an entry point: no pan responder, press deformation,
            hearts, haptics or interaction task receipt before opening Toy. */}
        <DollPhotoPreview asset={dollArt} photo={doll} style={styles.fill} />
      </Pressable>)}
      <HomeLoveLetter scale={scale} count={!previewOnly&&!partnerRoom?updates?.letter??0:0}/>
      {dollArt&&partnerRoom?.touchIndicator&&<View pointerEvents="none" style={anchoredBox(dollArt,dollPlacement,scale)}>{partnerRoom.touchIndicator}</View>}

      {previewInteractive&&art.map(item=>{
        const asset=burrowArtForItem(slots[item.slot],item.category);
        if(!asset)return null;
        const [left,top,right,bottom]=asset.bounds;
        const placed=anchoredBox(asset,item,scale);
        return <Pressable key={`select-${item.slot}`} accessibilityRole="button" accessibilityLabel={`Select ${item.category.replaceAll('_',' ')}`}
          onPress={pull.guard(()=>slotAction(item.slot))} style={{position:'absolute',left:placed.left+left*placed.width/asset.width,
            top:placed.top+top*placed.height/asset.height,width:(right-left)*placed.width/asset.width,
            height:(bottom-top)*placed.height/asset.height}}/>;
      })}
      {previewInteractive&&<>
        {hotspot('Select photo frames', 'frame', 635, 755, 125, 190)}
        {dollArt&&<Pressable accessibilityRole="button" accessibilityLabel="Select couple dolls" onPress={pull.guard(()=>slotAction('couple_doll'))} style={anchoredBox(dollArt,dollPlacement,scale)}/>}
        {hotspot('Select outfits', 'outfit', 125, 1158, 205, 255)}
      </>}

      {!previewOnly&&<>{(!partnerRoom||!away)&&hotspot(away ? 'Open adventure' : 'Feed bunny', 'bunny', 125, 1158, 205, 255)}
      {hotspot(partnerRoom ? 'Water partner’s flowers' : 'Water flowers', 'vase', 610, 1118, 140, 190)}
      {!partnerRoom && hotspot('Choose a collected adventure gift', 'shelf_decor', 565, 580, 120, 140)}
      {!partnerRoom&&<>{hotspot('Open room photo', 'frame', 635, 760, 125, 205)}
      {hotspot('Choose music', 'music_player', 670, 600, 125, 135)}
      <Pressable accessibilityRole="button" accessibilityLabel="Love letters" accessibilityHint={`${updates?.letter??0} unread notes`} onPress={pull.guard(letterAction)} style={box(550, 1245, 85, 65)} />
      <Pressable accessibilityRole="button" accessibilityLabel="Explore our burrows" onPress={pull.guard(burrowsAction)} style={box(755, 915, 145, 365)} />
      </>}</>}
    </>,[scale,slots,photos,ownerId,bunnyAway,busy,previewOnly,previewInteractive,partnerName,canEditToy,
      environment.season,environment.period,updates?.letter,pull.guard,slotAction,toyAction,toyPhotoAction,letterAction,burrowsAction]);

  return <GestureDetector gesture={pull.gesture}><View collapsable={false} style={styles.root} onLayout={event => {
    const { width, height } = event.nativeEvent.layout;
    setLayout(previous => previous.width === width && previous.height === height ? previous : { width, height });
  }}>
    {!previewOnly&&<StatusBar hidden />}
    {!previewOnly&&<><Image source={wallpaper.source} contentFit="cover" contentPosition="top"
      pointerEvents="none" style={styles.backgroundFill} /><View pointerEvents="none" style={styles.backgroundMask} /></>}
    <Animated.View testID="home-pull-room" pointerEvents="box-none" style={[styles.canvas, { left: artLeft, width: artWidth, height: DESIGN_HEIGHT * scale, bottom: previewOnly ? -previewBottomCrop * scale : -tabBarHeight },pull.animatedStyle]}>{artwork}</Animated.View>

    {/* Header controls are screen-anchored, so safe-area spacing must not use
        the artwork's crop/scale alone. Leave breathing room below the notch. */}
    {!previewOnly&&!partnerRoom&&<><View style={[styles.header, { top: insets.top + 16, paddingHorizontal: 38 * scale }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Open menu" onPress={pull.guard(onMenu)} style={[styles.menu, { width: 82 * scale, height: 74 * scale }]}>
        <View style={{ gap: 3 * scale }}>{[0, 1, 2].map(index => <View key={index} style={[styles.menuBar, { width: 77 * scale, height: 16 * scale, borderWidth: 4 * scale }]} />)}</View>
      </Pressable>
      <CoinWallet balance={balance} fontSize={36*scale} onPress={pull.guard(onCarrots)}
        onAnchor={anchor=>onWalletAnchor?.({...anchor,coinSize:60*scale,fontSize:36*scale,gap:7.92*scale,paddingLeft:10.08*scale,paddingRight:10.08*scale})}/>
    </View>

    <View style={[styles.actions, { bottom: 101 * scale, paddingHorizontal: 90 * scale, gap: 105 * scale }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Affection" onPress={pull.guard(onAffection)} style={({pressed})=>[styles.action, { height: 115 * scale, borderRadius: 30 * scale },pressed&&styles.actionPressed]}><Text style={[styles.actionText, { fontSize: 24 * scale }]}>Affection</Text><UpdateBadge count={updates?.affection ?? 0} style={{right:8,top:8}} /></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Adventure" onPress={pull.guard(onAdventure)} style={({pressed})=>[styles.action, { height: 115 * scale, borderRadius: 30 * scale },pressed&&styles.actionPressed]}><Text style={[styles.actionText, { fontSize: 24 * scale, color: '#704038' }]}>Adventure</Text><UpdateBadge count={updates?.adventure ?? 0} dot style={{right:10,top:10}} /></Pressable>
    </View></>}
    {partnerRoom&&<>
      <View pointerEvents="box-none" style={[styles.header,{top:Math.max(insets.top+8,64*scale),paddingHorizontal:Math.max(18,40*scale)}]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Leave partner’s room" onPress={pull.guard(partnerRoom.onBack)} style={styles.partnerBack}><BackIcon color="#864B2A"/></Pressable>
        <View style={styles.partnerName}><Text numberOfLines={1} style={styles.partnerNameText}>{partnerRoom.name}’s Room</Text></View>
      </View>
      {partnerRoom.onTouch&&<Pressable accessibilityRole="button" accessibilityLabel="Open partner touches" onPress={partnerRoom.onTouch} style={{position:'absolute',top:insets.top+72,right:22,padding:10,backgroundColor:'#FFF9EF',borderRadius:26}}><Text style={{fontSize:26}}>❤️‍🔥</Text>{partnerRoom.touchIndicator}</Pressable>}
      <View style={[styles.partnerFooter,{paddingBottom:Math.max(16,insets.bottom),paddingHorizontal:Math.max(18,64*scale)}]}>
        <Text numberOfLines={2} style={styles.partnerPrompt}>Gift {partnerRoom.name} something to be happy with:</Text>
        <View style={styles.partnerButtons}>
          <Pressable accessibilityRole="button" accessibilityLabel="Gift Furniture" disabled={busy} onPress={pull.guard(partnerRoom.onGift)} style={[styles.partnerGift,busy&&{opacity:.55}]}><Text style={styles.partnerGiftText}>Gift Furniture</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Gift Surprise" disabled={busy} onPress={pull.guard(partnerRoom.onSurprise)} style={[styles.partnerGift,styles.partnerSurprise,busy&&{opacity:.55}]}><Text style={[styles.partnerGiftText,{color:'#FFF9EF'}]}>Gift Surprise</Text></Pressable>
        </View>
      </View>
    </>}
  </View></GestureDetector>;
}

const styles = StyleSheet.create({
  root: { flex: 1, width: '100%', overflow: 'hidden', backgroundColor: '#B75833' },
  backgroundFill: { ...StyleSheet.absoluteFillObject },
  backgroundMask: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(37, 20, 13, 0.35)' },
  canvas: { position: 'absolute' },
  fill: { width: '100%', height: '100%' },
  header: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  menu: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  menuBar: { width: 37, height: 9, borderRadius: 8, borderWidth: 2, borderColor: '#FFF9F2', backgroundColor: '#281B16' },
  actions: { position: 'absolute', left: 0, right: 0, flexDirection: 'row' },
  action: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFF2DC', shadowColor: '#D8872C', shadowOpacity: 1, shadowRadius: 0, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  actionPressed: { backgroundColor: '#F3DFBF', transform: [{ translateY: 3 }, { scale: 0.98 }], shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0, elevation: 0 },
  actionText: { color: '#583418', fontSize: 13, fontWeight: '700' },
  framePhoto: { position: 'absolute', overflow: 'hidden' },
  dollPhoto: { position: 'absolute', overflow: 'hidden' },
  partnerBack:{width:46,height:46,borderRadius:23,backgroundColor:'#FFFFFF',alignItems:'center',justifyContent:'center'},
  partnerName:{maxWidth:'72%',backgroundColor:'#FFF9EF',borderRadius:13,paddingHorizontal:23,paddingVertical:13,shadowColor:'#D8872C',shadowOpacity:1,shadowRadius:0,shadowOffset:{width:0,height:2}},
  partnerNameText:{fontSize:18,fontWeight:'800',color:'#60331F'},
  partnerFooter:{position:'absolute',left:0,right:0,bottom:0,backgroundColor:'#FFF3DB',paddingTop:15,gap:15},
  partnerPrompt:{fontSize:15,fontWeight:'700',color:'#25180F',textAlign:'center'},partnerButtons:{flexDirection:'row',gap:20},
  partnerGift:{flex:1,minHeight:55,borderRadius:20,backgroundColor:'#FFC344',alignItems:'center',justifyContent:'center',paddingHorizontal:8},
  partnerSurprise:{backgroundColor:'#63321C'},partnerGiftText:{fontSize:16,fontWeight:'800',color:'#231709'},
});
