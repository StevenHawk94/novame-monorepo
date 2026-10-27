import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { homeDesignKey, markHomeDesignCommitted, retainHomeDesignHost } from '@/lib/home-design-handoff';
import { roomDesignIds } from '@/lib/room-edit-design';
import { uiWorkPriority } from '@/lib/ui-work-priority';
import { useBurrowDestinationPreload } from '@/lib/burrow-destination-preload';
import { beginInteractionTiming, markInteractionTiming } from '@/lib/interaction-timing';
import { BunnyActor } from './bunny-actor';
import {OutfitThumbnail} from './outfit-thumbnail';
import { ActivityIndicator, Alert, AppState, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import {AppModal as Modal} from '@/components/layout/app-modal';
import { router, type Href } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { dismissToRetainedTab } from '@/lib/retained-tab-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BURROW_PAGE_COLORS, burrowFlatSurface, burrowPageScrollBehavior } from '@/lib/burrow-surface';
import { Image } from './burrow-image';
import { CoinLabel } from './coin-ui';
import {CoinWallet} from './coin-wallet';
import { requirePartner, showPartnerPairing } from '@/lib/partner-pairing';
import { usePartnerEntryGate } from '@/lib/use-partner-entry-gate';
import { BURROW_DECOR_SHOP_CATEGORIES } from '@novame/domain';
import {
  claimGift,
  deleteMemoryRoomEntry, saveBunnyOutfit, saveMemoryRoomEntry, setRoomSleep,
  markAffectionRead, refillRoomNeed, saveRoomLoadout,
  startAdventure, visitPartnerRoom, type MajorUpdateBootstrap, type MajorUpdateCatalogItem,
} from '@/lib/app-major-update-api';
import { burrowClock, burrowErrorMessage, enqueueBurrowPurchase, getBurrowSnapshot, refreshBurrow, runBurrowAction, setBurrowLoadoutLocally, startBurrowAdventureLocally, useBurrow } from '@/lib/burrow-store';
import { showInsufficientCoins } from '@/lib/insufficient-coins';
import { useCoinPurchaseConfirmation } from '@/lib/use-coin-purchase-confirmation';
import { ScreenOverlay } from '@/components/ui/screen-overlay';
import { careCoolingDown } from '@/lib/burrow-care-cooldown';
import { showBurrowToast } from '@/lib/burrow-toast';
import { careCooldownMessage } from '@/lib/burrow-care-cooldown';
import { ROOM_TITLE_STYLE } from '@/lib/room-header-typography';
import { adventureHasArrived, adventureIsAway, careProgress, roomNeedDisplay, roomSlots } from '@/lib/burrow-presentation';
import { markHomeEntryAsset } from '@/lib/home-entry-readiness';
import { isHomeArtPrepared, prepareHomeArt,prepareHomeBunnyVariant } from '@/lib/home-art-preparation';
import {adoptBunnyOnHome} from '@/lib/bunny-identity';
import { retainPageImages } from '@/lib/prepared-burrow-images';
import { useHomeEntry } from '@/lib/use-home-entry';
import { registerOverlay } from '@/lib/overlay-presence';
import { RoomSceneArt as RoomScene } from './room-scene-art';
import { HomeArtScene } from './home-art-scene';
import { DailyPlusBonus } from './daily-plus-bonus';
import { AdventureNappingDialog } from './adventure-napping-dialog';
import { adventureFinishedToday } from '@/lib/burrow-daily-entry';
import type { HomeWalletAnchor } from '@/lib/daily-plus-bonus';
import { PartnerRoomScreen } from './partner-room-screen';
import { HomeArtPreview } from './home-art-preview';
import { AFFECTION_COPY } from './affection-gesture';
import { FriendVisitCard } from './friend-visit-card';
import { AdventureCompletionScreen } from './adventure-completion-screen';
import { AdventureProgressScreen } from './adventure-progress-screen';
import { CollectionRoomScreen } from './collection-room-screen';
import { prefetchAdventureRewards } from '@/lib/adventure-prefetch';
import {useAdventureTeamPrefetch} from '@/lib/use-adventure-team-prefetch';
import { pickRoomPhoto, uploadRoomPhoto } from './room-photo';
import { toyPhotoFor } from '@/lib/burrow-toy-photos';
import { invalidateRoomPhotoCache } from '@/lib/burrow-room-photo-cache';
import { PhotoFrameSheet } from './photo-frame-sheet';
import { FramePhotoCropper } from './frame-photo-cropper';
import { InteractiveDoll } from './interactive-doll';
import { MemoryPhotos } from './memory-photos';
import { BurrowHistory } from './burrow-history';
import { MomentsTimeline } from './moments-timeline';
import { AdventureReady } from './adventure-record-completion';
import { startPendingAdventureJournal } from '@/lib/adventure-journal-jobs';
import { AdventureEntry } from './adventure-entry';
import { AdventureStageTransition } from './adventure-stage-transition';
import { burrowLocalDay } from '@/lib/burrow-local-day';
import { AffectionHub } from './affection-hub';
import { BURROW_BACKGROUNDS, burrowArtFor, burrowArtForItem } from '@/lib/burrow-art-assets';
import { SeasonalWindowArtwork } from './window-artwork';
import { FRAME_ART_REFERENCE_BOUNDS } from '@/lib/room-photo-crop';
import { BURROW_AFFECTION_ICONS, BURROW_QUEST_ICONS, burrowFriendArt } from '@/lib/burrow-ui-assets';
import { BurrowMap } from './burrow-map';
import { BurrowMapScrollView } from './burrow-map-scroll-view';
import { useBurrowAttention, dismissHomeLetterReminder, dismissAdventureReminder } from '@/lib/burrow-attention';
import { QuestBoard } from './quest-board';
import { claimQuestOptimistically } from '@/lib/coin-command-outbox';
import { recordToyInteraction as queueToyInteraction } from '@/lib/toy-interaction-records';
import { recordPhotoToyPlayForRating } from '@/lib/official-rating-milestones';
import { BurrowShop } from './burrow-shop';
import { haptics } from '@/lib/haptics';
import { BurrowBackButton } from './burrow-back-button';
import { burrowPageIsReady, cancelBurrowPageEntry, enterBurrowPage, openPreparedBurrow } from '@/lib/burrow-page-entry';

export type BurrowSection = 'home'|'burrow'|'quests'|'shop'|'moments'|'collection'|'adventure'|'affection'|'decorate'|'partner_room'|'our_room'|'friends_room'|'game_room'|'memories_room'|'carrot_shop';
const titles: Record<BurrowSection,string> = {home:'Our Room',burrow:'Our Burrows',quests:'Quests',shop:'Shop',moments:'Our Moments',collection:'Collection',adventure:'Adventure',affection:'Affection',decorate:'Decorate',partner_room:'Partner’s Room',our_room:'Our Room',friends_room:"Friend's Room",game_room:'Game Room',memories_room:'Memories Room',carrot_shop:'Carrot Shop'};
const questNames:Record<string,string>={write_adventure_record:'Complete today’s Adventure record',send_affection:'Send an Affection',water_partner_flower:'Water a flower',feed_partner_bunny:'Feed your bunny',interact_with_toy:'Play with your doll',visit_partner_room:'Visit your partner’s room',finish_adventure:'Finish an adventure',play_game:'Play a game with your partner'};
const decorCategories=BURROW_DECOR_SHOP_CATEGORIES.filter(category=>category!=='shelf_decor');
const categoryName=(value:string)=>value.replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
export function openBurrow(section:BurrowSection,extra?:Record<string,string>,fromStack=false){
  uiWorkPriority.action();beginInteractionTiming(section);
  const entry={kind:section==='game_room'?'game' as const:section==='shop'?'shop' as const
    :section==='friends_room'?'visit' as const:section==='memories_room'?'journal' as const:section==='moments'||section==='partner_room'?'private' as const
    :section==='affection'?'affection' as const:section==='adventure'?'adventure' as const:'page' as const,
    sessionId:extra?.sessionId,intent:JSON.stringify([section,extra,fromStack])};
  const dispatch=()=>{
  if(section==='adventure'){
    const snapshot=getBurrowSnapshot(),data=snapshot.data;
    if(data)dismissAdventureReminder(data,Date.parse(data.serverNow)+Math.max(0,burrowClock()-snapshot.receivedAt));
  }
  if(section==='partner_room'&&requirePartner())return;
  markInteractionTiming('dispatch');
  if(section==='our_room'){router.push('/(main)/surprise-room' as Href);return;}
  if(section==='carrot_shop'){router.push('/(main)/coin-shop' as Href);return;}
  if(section==='game_room'){router.push({pathname:'/(main)/game-room',params:extra} as Href);return;}
  if(section==='burrow'||section==='collection'||section==='moments'||(section==='shop'&&!extra)){
    const href=`/(main)/(tabs)/${section==='moments'?'friends':section}`;
    if(fromStack)dismissToRetainedTab(href);else router.navigate(href as Href);return;
  }
  if(section==='quests'||section==='home'){
    const route=section==='home'? '/(main)/(tabs)' : '/(main)/(tabs)/quests';
    if(fromStack)dismissToRetainedTab(route);else router.navigate(route as Href);return;
  }
  router.push({pathname:'/(main)/burrow-detail',params:{section,...extra}} as Href);
  };
  if(section==='home'){cancelBurrowPageEntry();dispatch();}
  else enterBurrowPage(entry,dispatch);
}
const navigateToBurrow=openBurrow;
const iconFor=(item:MajorUpdateCatalogItem)=>({windows:'🪟',lamps:'💡',vases:'🌼',decor:'🪴',cushions:'🛏️',tables:'🪵',rugs:'🧶',cabinets:'🗄️',posters:'🍃',music_players:'📻',frames:'🖼️',couple_dolls:'🧸',outfits:'🧥',our_room:'💕',gifts:'🎁',rooms:'🏡',music:'🎵'}[item.category]??'✨');
function CatalogArtwork({item,large=false,compact=false,sizePx}:{item:MajorUpdateCatalogItem;large?:boolean;compact?:boolean;sizePx?:number}){
  const asset=burrowArtForItem(item);
  if(item.category==='outfits')return <OutfitThumbnail outfit={item} size={sizePx??(large?160:compact?74:110)}/>;
  if(!asset)return asset===null||item.status==='retired'?null:<Text style={s.itemIcon}>{iconFor(item)}</Text>;
  const size=sizePx??(large?160:compact?74:110);
  if(item.category==='dresser_plants'||item.category==='couple_dolls'||item.tags.includes('adventure_v2_gift'))return <Image source={asset.source} contentFit="contain" style={{width:size,height:size}} accessibilityLabel={item.title}/>;
  const [left,top,right,bottom]=item.category==='frames'?FRAME_ART_REFERENCE_BOUNDS:asset.bounds;
  const ratio=Math.min(size/(right-left),size/(bottom-top));
  const imageStyle={position:'absolute' as const,left:(size-(right-left)*ratio)/2-left*ratio,top:(size-(bottom-top)*ratio)/2-top*ratio,width:asset.width*ratio,height:asset.height*ratio};
  return <View style={[large?s.itemArtLarge:compact?s.itemArtCompact:s.itemArt,sizePx!=null&&{width:size,height:size}]} accessibilityLabel={item.title}>
    {item.category==='windows'?<SeasonalWindowArtwork asset={asset} style={imageStyle}/>:<Image source={asset.source} contentFit="fill" style={imageStyle}/>}
  </View>;
}
function Action({label,onPress,disabled=false,secondary=false}:{label:string;onPress:()=>void;disabled?:boolean;secondary?:boolean}){
  return <Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} onPress={onPress}
    style={({pressed})=>[s.action,secondary&&s.secondary,(pressed||disabled)&&{opacity:.5}]}><CoinLabel style={[s.actionText,secondary&&{color:'#64402C'}]}>{label}</CoinLabel></Pressable>;
}
function Card({title,body,children}:{title:string;body?:string;children?:React.ReactNode}){
  return <View style={s.card}><Text style={s.cardTitle}>{title}</Text>{body&&<Text style={s.body}>{body}</Text>}{children}</View>;
}

export function BurrowScreen({section,roomType='home',initialCategory='cushions',asTab=false,homeIntent,initialInbox=false,ownedOnly=false,initialItemId,collectionOwnerId,giftRecipientId,giftActorId}:{section:BurrowSection;roomType?:'home'|'our';initialCategory?:string;asTab?:boolean;homeIntent?:string;initialInbox?:boolean;ownedOnly?:boolean;initialItemId?:string;collectionOwnerId?:string;giftRecipientId?:string;giftActorId?:string}){
  const isTab=asTab||['home','quests','moments'].includes(section);
  const openBurrow=(destination:BurrowSection,extra?:Record<string,string>)=>navigateToBurrow(destination,extra,!isTab);
  const focused = useIsFocused();
  const focusedRef = useRef(focused); focusedRef.current = focused;
  const retainedPage=section==='home'?'home':section==='affection'?'affection':section==='adventure'?'adventure':section==='partner_room'?'partner_room':asTab&&['burrow','quests','shop','moments','collection'].includes(section)
    ? section as 'burrow'|'quests'|'shop'|'moments'|'collection' : undefined;
  const {data,loading,error,busy,receivedAt}=useBurrow(section==='home',retainedPage);
  useEffect(()=>{
    if(section!=='home'||!focused)return;
    let live=true;
    const current=getBurrowSnapshot().data;
    if(current)void adoptBunnyOnHome(variant=>prepareHomeBunnyVariant(current,variant),()=>live).catch(()=>{});
    return()=>{live=false;};
  },[section,focused,data?.profile.id]);
  useBurrowDestinationPreload(section,focused,data);
  const checkout=useCoinPurchaseConfirmation(`${data?.profile.id??''}:${data?.partner?.id??''}:${data?.pairVersion??''}`);
  const purchaseLock=useRef(false);
  usePartnerEntryGate(data,section==='moments');
  const {attempt,pending:homeEntering}=useHomeEntry();
  const [preparedHome,setPreparedHome]=useState<MajorUpdateBootstrap|null>(null);
  const homeDesign=useMemo(()=>section==='home'?data:null,[section,data?.catalog,data?.loadouts,data?.roomPhotos,data?.adventureCollection?.displays,
    data?.profile,data?.partner,data?.pairVersion]);
  const insets=useSafeAreaInsets();
  const {width:screenWidth,height:screenHeight}=useWindowDimensions();
  const [clock,setClock]=useState(burrowClock());
  const [walletAnchor,setWalletAnchor]=useState<HomeWalletAnchor|null>(null);
  const [category,setCategory]=useState<string>(initialCategory);
  const [selected,setSelected]=useState<MajorUpdateCatalogItem|null>(null);
  const [draft,setDraft]=useState<Record<string,MajorUpdateCatalogItem>|null>(null);
  const [editingMemory,setEditingMemory]=useState<string|null>(null);
  const [frameSheetOpen,setFrameSheetOpen]=useState(false);
  const [frameCropAsset,setFrameCropAsset]=useState<{uri:string;width:number;height:number}|null>(null);
  const [inboxOpen,setInboxOpen]=useState(false);
  const [letterOpen,setLetterOpen]=useState(false);
  const [letterText,setLetterText]=useState('');
  const [careKind,setCareKind]=useState<'food'|'water'|null>(null);
  const [nappingOpen,setNappingOpen]=useState(false);
  useEffect(()=>setNappingOpen(false),[data?.profile.id,data?.partner?.id,data?.pairVersion,data?.localDate,focused]);
  const [toyOpen,setToyOpen]=useState(false);
  const toyPhotoTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(()=>()=>{if(toyPhotoTimer.current)clearTimeout(toyPhotoTimer.current);},[]);
  const [pullRefreshing,setPullRefreshing]=useState(false);
  const modalOpen=frameSheetOpen||!!frameCropAsset||toyOpen||!!selected||inboxOpen||letterOpen||!!careKind||nappingOpen;
  useEffect(()=>{if(modalOpen)return registerOverlay({});},[modalOpen]);
  const openHomeInteraction=(kind:'toy'|'food'|'water'|'frame'|'letter',compose=false)=>{
    if(!burrowPageIsReady()){enterBurrowPage({},()=>openHomeInteraction(kind,compose));return;}
    const current=getBurrowSnapshot().data;
    if(kind==='letter'&&requirePartner(current))return;
    if(current&&(kind==='food'||kind==='water')&&careCoolingDown(current,kind)){
      showBurrowToast(careCooldownMessage(kind));
      return;
    }
    openPreparedBurrow({pathname:'/(main)/room-interaction',params:{kind,...(kind==='letter'&&compose?{compose:'1'}:{})}} as Href);
  };
  useEffect(()=>{
    if (!focused || !['home','partner_room','our_room','adventure','burrow','friends_room'].includes(section)) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const update = () => { if (AppState.currentState === 'active') setClock(burrowClock()); };
    const resume = () => {
      clearInterval(timer);
      if (AppState.currentState === 'active') { update(); timer = setInterval(update, section === 'adventure' ? 1000 : 30_000); }
    };
    resume(); const sub = AppState.addEventListener('change', resume);
    return () => { clearInterval(timer); sub.remove(); };
  },[focused,section]);
  useEffect(()=>{if(data)markHomeEntryAsset('burrow-data',attempt);},[data,attempt]);
  useEffect(()=>{if(section==='home'&&focused)retainPageImages([]);},[section,focused]);
  useEffect(()=>{
    if(section!=='home'||!homeDesign)return;
    let live=true;
    void prepareHomeArt(homeDesign).then(()=>{if(live){setPreparedHome(homeDesign);markHomeEntryAsset('burrow-art',attempt);
      requestAnimationFrame(()=>{if(live)markHomeEntryAsset('burrow-layout',attempt);});
    }}).catch(()=>{});
    return()=>{live=false;};
  },[section,homeDesign,attempt]);
  useEffect(()=>{if(section==='partner_room'&&data?.partner)void runBurrowAction('visit-partner',()=>visitPartnerRoom(),{silent:true});},[section,data?.partner?.id]);
  // burrowClock is monotonic elapsed time, NEVER an epoch/calendar date.
  // A preloaded Adventure's React timer was paused while hidden. Seek from
  // the current monotonic clock on every Adventure render, including hidden
  // cache updates. Otherwise stale hidden React ticks look like a server-clock
  // correction to the display model. This does not enable a hidden timer.
  const renderClock=section==='adventure'?Math.max(clock,burrowClock()):clock;
  const now=data&&Number.isFinite(Date.parse(data.serverNow))?Date.parse(data.serverNow)+Math.max(0,renderClock-receivedAt):Date.now();
  let bonusDayCurrent=false;
  if(section==='home'&&data?.dailyPlusBonus) {
    try { bonusDayCurrent=burrowLocalDay(now,data.economicTimezone ?? data.profile.timezone_name)===data.localDate; } catch { /* Wait for a fresh, valid server day. */ }
  }
  const attention=useBurrowAttention(data,now,section==='home'?'home':section==='burrow'?'rooms':section==='affection'?'affection':'none');
  // Deep links and arrival while already viewing Adventure also acknowledge
  // immediately, not during cleanup after Home is visible again.
  useEffect(()=>{
    if(section==='adventure'&&focused&&data)dismissAdventureReminder(data,now);
  },[section,focused,data?.profile.id,data?.partner?.id,data?.pairVersion,data?.activeAdventure?.id,data?.activeAdventure?.status,now]);
  const midnightRetry=useRef(0);
  useEffect(()=>{
    if(!focused||section!=='home'||!data||loading||busy||AppState.currentState!=='active'||clock<midnightRetry.current)return;
    try {
      if(burrowLocalDay(now,data.economicTimezone ?? data.profile.timezone_name)!==data.localDate){
        midnightRetry.current=clock+60_000;
        void refreshBurrow();
      }
    } catch { /* Invalid profile timezone must not start a refresh loop. */ }
  },[focused,section,data,loading,busy,clock,now]);
  const adventure=data?.activeAdventure;
  useAdventureTeamPrefetch(section==='adventure'&&!adventure);
  const completion = useRef<MajorUpdateBootstrap | null>(null);
  // Keep the mounted final conversation/modal through the receipt's immediate
  // cache clear, until its explicit navigation to Home has completed.
  if (!data || (completion.current && (completion.current.profile.id !== data.profile.id
    || completion.current.partner?.id !== data.partner?.id || completion.current.pairVersion !== data.pairVersion))) completion.current = null;
  if (section === 'adventure' && focused && data?.activeAdventure && data.adventureResult
    && ['result_ready', 'interaction_required'].includes(data.activeAdventure.status)) completion.current = data;
  useEffect(() => { if (!focused) completion.current = null; }, [focused]);
  const adventureEntry=section==='adventure'&&!!data&&!adventure&&!data.dailyAdventureUsed&&!data.readyRecordId;
  const adventureLogged=section==='adventure'&&!!data&&!adventure&&!data.dailyAdventureUsed&&!!data.readyRecordId;
  const displayedCareProgress=careProgress(data,careKind,now);
  const owner=section==='partner_room'&&data?.partner?data.partner.id:data?.profile.id;
  const needsRoomSlots=['home','partner_room','our_room','decorate'].includes(section);
  const sceneSlots=useMemo(()=>data&&needsRoomSlots?roomSlots(data,owner??data.profile.id,section==='our_room'||roomType==='our'):{},
    [needsRoomSlots,data?.catalog,data?.loadouts,data?.adventureCollection?.displays,data?.profile.id,data?.partner?.id,owner,section,roomType]);
  const preparedDesign=useMemo(()=>homeDesign&&isHomeArtPrepared(homeDesign)?homeDesign:null,[homeDesign,preparedHome,attempt]);
  const homeVisual=section==='home'&&preparedDesign?preparedDesign:preparedHome&&data&&preparedHome.profile.id===data.profile.id
    &&preparedHome.partner?.id===data.partner?.id&&preparedHome.pairVersion===data.pairVersion?preparedHome:null;
  const homeSlots=useMemo(()=>homeVisual?roomSlots(homeVisual,homeVisual.profile.id):sceneSlots,[homeVisual,sceneSlots]);
  useLayoutEffect(()=>section==='home'?retainHomeDesignHost():undefined,[section]);
  useLayoutEffect(()=>{
    if(section==='home'&&homeVisual)markHomeDesignCommitted(homeDesignKey(homeVisual.profile.id,
      homeVisual.partner?.id,homeVisual.pairVersion,roomDesignIds(homeVisual)));
  },[section,homeVisual]);
  const background=section==='adventure'?(data?.adventureResult?BURROW_BACKGROUNDS.adventureFinish:BURROW_BACKGROUNDS.common)
    :section==='affection'?BURROW_BACKGROUNDS.affectionSend
    :section==='friends_room'?BURROW_BACKGROUNDS.friendsRoom
    :BURROW_BACKGROUNDS.common;
  const askToPair=()=>{setSelected(null);showPartnerPairing();};
  useEffect(()=>{
    if(section!=='home'||!homeIntent||!data)return;
    router.setParams({care:undefined});
    if(homeIntent==='water'||homeIntent==='food'){
      openHomeInteraction(homeIntent);
    }
    if(homeIntent==='toy')openHomeInteraction('toy');
    // This one-shot intent is cleared before opening a sheet, so tab revisits do
    // not unexpectedly reopen care after the user dismissed it.
  },[section,homeIntent,data?.profile.id,data?.partner?.id]);
  const act=(name:string,fn:(key:string)=>Promise<unknown>)=>{void runBurrowAction(name,fn,{silent:true});};
  const beginAdventure=(recordId:string)=>{
    try { if(startPendingAdventureJournal(recordId))return; }
    catch { Alert.alert('Your day is safe','Couldn’t save the start on this device. Please try again.'); return; }
    startBurrowAdventureLocally(recordId);
    void runBurrowAction(`start:${recordId}`,key=>startAdventure(recordId,key),{silent:true}).then(ok=>{
      if(!ok)void refreshBurrow({silent:true});
    });
  };
  function recordToyInteraction(){
    if(!data)return;
    const toyId=sceneSlots.couple_doll?.stable_id;
    queueToyInteraction(toyId);
    recordPhotoToyPlayForRating(data.profile.id,toyId,toyPhotoFor(data.roomPhotos,data.profile.id,toyId)?.id);
  }
  function openToyPhoto(){
    setToyOpen(false);
    if(toyPhotoTimer.current)clearTimeout(toyPhotoTimer.current);
    toyPhotoTimer.current=setTimeout(()=>{openHomeInteraction('toy');toyPhotoTimer.current=null;},380);
  }
  function chooseFramePhoto(source:'camera'|'library'){
    if(!data)return;
    setFrameSheetOpen(false);
    // Dismiss the native sheet before invoking the system camera/library UI.
    setTimeout(()=>{void (async()=>{
      try{
        const asset=await pickRoomPhoto(source,'frame');
        if(asset)setFrameCropAsset(asset);
        else setFrameSheetOpen(true);
      }catch(error){
        Alert.alert('Photo not saved',error instanceof Error&&error.message==='camera_permission_denied'
          ? 'Allow camera access in Settings, then try again.':'Please choose a photo and try again.');
        setFrameSheetOpen(true);
      }
    })();},320);
  }
  async function buy(item:MajorUpdateCatalogItem,gift=false){
    if(!data||purchaseLock.current)return;
    if(gift&&!data.partner){Alert.alert('Gift later','You can buy this for your own burrow now. Sending a gift will be available after you connect.');return;}
    if(item.plus_only&&!data.hasPlus){setSelected(null);router.push('/(main)/(modals)/subscription-paywall' as Href);return;}
    if((item.price??0)>0&&(item.price??0)>data.wallet.balance){setSelected(null);showInsufficientCoins();return;}
    const recipient=gift?data.partner?.id:data.profile.id;
    if(!recipient)return;
    const actor=data.profile.id,pairVersion=data.pairVersion;
    purchaseLock.current=true;
    try {
        if(!await checkout.confirm({name:item.title,price:item.price??0,artwork:<CatalogArtwork item={item} large/>,
          ...(gift?{description:`A gift for ${data.partner?.display_name?.trim()||'your partner'}.`}:{})}))return;
        const current=getBurrowSnapshot().data;
        if(!checkout.isCurrent())return;
        if(current?.profile.id!==actor||(gift&&(current.partner?.id!==recipient||current.pairVersion!==pairVersion)))return;
        setSelected(null);
        enqueueBurrowPurchase(item.stable_id,recipient,item.price??0,item.title);
    } catch(error) {
        if(error instanceof Error&&error.message==='insufficient_balance')showInsufficientCoins();
        else Alert.alert('Purchase not saved','Please try again. Your purchase could not be saved on this device.');
    } finally {purchaseLock.current=false;}
  }
  function questGo(id:string){
    if(id==='send_affection')openBurrow('affection');
    else if(id==='play_game')openBurrow('game_room');
    else if(['water_partner_flower','feed_partner_bunny','interact_with_toy'].includes(id))openHomeInteraction(id==='water_partner_flower'?'water':id==='feed_partner_bunny'?'food':'toy');
    else if(id==='visit_partner_room')openBurrow('friends_room');
    else openBurrow('adventure');
  }
  function homeSlot(slot:string){
    if(!data)return;
    if(slot==='bunny'){
      if(adventureIsAway(adventure,now)){openBurrow('adventure');return;}
      openHomeInteraction('food');
    }
    else if(slot==='vase'){
      openHomeInteraction('water');
    }
    else if(slot==='frame')setFrameSheetOpen(true);
    else if(slot==='couple_doll')openHomeInteraction('toy');
    else if(slot==='music_player')router.push('/(main)/music-player');
    else if(slot==='shelf_decor')router.push('/(main)/gift-library');
  }
  function content(){
    if(!data)return null;
    if(section==='home'||section==='partner_room'||section==='our_room'){
      const needs=roomNeedDisplay(data,section==='partner_room'&&!!data.partner,now);
      const mineOutfit=roomSlots(data,data.profile.id).outfit;
      const partnerOutfit=data.partner?roomSlots(data,data.partner.id).outfit:undefined;
      return <>
        <RoomScene slots={section==='our_room'?{...sceneSlots,outfit:mineOutfit}:sceneSlots} partnerOutfit={partnerOutfit}
          ownerId={section==='our_room'?data.profile.id:owner??data.profile.id} partnerOwnerId={data.partner?.id}
          busy={busy} canFeed={needs.food<100} away={section!=='our_room'&&adventureIsAway(section==='partner_room'?data.partnerAdventure:adventure,now)} shared={section==='our_room'}
          photos={data.roomPhotos?.filter(photo=>photo.ownerId===owner)}
          sleeping={{mine:data.sharedRoom.mySleeping,partner:data.sharedRoom.partnerSleeping}} onSlot={slot=>{
          if(slot==='bed')act(`sleep:${!data.sharedRoom.mySleeping}`,key=>setRoomSleep(!data.sharedRoom.mySleeping,key));
          else if(slot==='bunny'&&owner)act(`food:${owner}`,key=>refillRoomNeed(owner,'food',key));
          else if(slot==='vase'&&owner)act(`water:${owner}`,key=>refillRoomNeed(owner,'water',key));
          else if(slot==='frame')setFrameSheetOpen(true);
          else if(slot==='couple_doll')setToyOpen(true);
          else if(slot==='doll_photo')openToyPhoto();
          else if(slot==='music_player'&&section==='home')router.push('/(main)/music-player');
          else if(slot==='music_player')Alert.alert('Your person’s radio','Choose background music from the radio in your own room.');
        }} />
        {section!=='our_room'&&<View style={s.row}>
          <Action label={`🥕 Food ${Math.round(needs.food)}%`} disabled={busy||needs.food>=100} onPress={()=>owner&&act(`food:${owner}`,key=>refillRoomNeed(owner,'food',key))}/>
          <Action label={`💧 Water ${Math.round(needs.water)}%`} disabled={busy||needs.water>=100} onPress={()=>owner&&act(`water:${owner}`,key=>refillRoomNeed(owner,'water',key))}/>
        </View>}
        {section==='home'?<>
          <View style={s.row}><Action label="Send love" onPress={()=>openBurrow('affection')}/><Action secondary label={adventureHasArrived(adventure,now)?'🔴 Adventure · Ready':adventure?'Adventuring…':'Adventure'} onPress={()=>openBurrow('adventure')}/></View>
          {adventureHasArrived(adventure,now)&&<Text accessibilityLiveRegion="polite" style={s.creamCopy}>Your bunny is home. Open Adventure to finish the story.</Text>}
          <Action secondary label="Decorate my burrow" onPress={()=>openBurrow('decorate')}/>
          <Action secondary label="Dress my bunny" onPress={()=>openBurrow('decorate',{category:'outfits'})}/>
          <Action secondary label="Music · choose a tune" onPress={()=>router.push('/(main)/music-player')}/>
          {(data.unread.affection>0||data.unread.gifts>0)&&<Card title="🔴 A little love arrived" body={`${data.unread.affection} gestures · ${data.unread.gifts} gifts`}><Action label="Open inbox" onPress={()=>setInboxOpen(true)}/></Card>}
        </>:section==='our_room'?<>
          <Card title={data.sharedRoom.mySleeping?'Resting together':'A little place to rest'} body={`Your bunny is ${data.sharedRoom.mySleeping?'asleep':'awake'}. Your person’s bunny is ${data.sharedRoom.partnerSleeping?'asleep':'awake'}.`}>
            <Action label={data.sharedRoom.mySleeping?'Wake my bunny':'Put my bunny to sleep'} disabled={busy} onPress={()=>act(`sleep:${!data.sharedRoom.mySleeping}`,key=>setRoomSleep(!data.sharedRoom.mySleeping,key))}/>
            <Text style={s.body}>Tap the bed anytime. Rest is free and has no effect on rewards.</Text>
          </Card>
          {data.sharedRoom.decoratedBy&&<Text style={s.creamCopy}>Last decorated by {data.sharedRoom.decoratedBy===data.profile.id?'you':data.partner?.display_name??'your person'}.</Text>}
          <Action label={data.hasPlus?'Decorate our room':'Explore Plus · decorate together'} onPress={()=>data.hasPlus?openBurrow('decorate',{roomType:'our'}):router.push('/(main)/(modals)/subscription-paywall' as Href)}/>
        </>:<Text style={s.creamCopy}>Small acts of care make the distance feel smaller.</Text>}
      </>;
    }
    if(section==='burrow')return <BurrowMap now={now} timeZone={data.profile.timezone_name} partnerId={data.partner?.id} pairVersion={data.pairVersion} badges={attention.rooms} onRoom={id=>{
      if(id==='my_room')openBurrow('home');
      else if(id==='surprise_room')openPreparedBurrow('/(main)/surprise-room');
      else if(id==='partner_room'&&!data.partner)askToPair();
      else if(id==='rage_room')openPreparedBurrow('/(main)/tame-enemy');
      else openBurrow(id==='collection_room'?'collection':id);
    }}/>;
    if(section==='quests')return <QuestBoard data={data} busy={busy}
      onGo={questGo}
      onClaim={async q=>{
        return claimQuestOptimistically('claim_daily_quest',{assignmentId:q.assignmentId});
      }}
      onSpecialClaim={async(id,stage)=>{
        return claimQuestOptimistically('claim_special_quest',{questId:id,stage});
      }}/>;
    if(section==='shop'||section==='decorate'){
      const decorating=section==='decorate';
      const outfitMode=decorating&&initialCategory==='outfits';
      const preview=draft??sceneSlots;
      const inUse=Object.entries(preview).every(([slot,item])=>item.stable_id===sceneSlots[slot]?.stable_id);
      const owned=(item:MajorUpdateCatalogItem)=>data.inventory.some(i=>i.item_id===item.stable_id&&(i.owner_id===data.profile.id||(!outfitMode&&i.owner_id===data.partner?.id)));
      const unownedPreview=Object.entries(preview).filter(([slot,item])=>outfitMode?slot==='outfit'&&!owned(item):slot!=='outfit'&&!owned(item)).map(([,item])=>item);
      const categories=outfitMode?['outfits']:decorCategories;
      const effectiveCategory=outfitMode?'outfits':category;
      const items=data.catalog.filter(item=>item.category===effectiveCategory&&(decorating||!!item.price));
      return <>
        {decorating&&<><HomeArtPreview timeZone={data.profile.timezone_name} now={now} slots={preview} ownerId={data.profile.id}
          photos={data.roomPhotos?.filter(photo=>photo.ownerId===data.profile.id)}
          away={adventureIsAway(adventure,now)}/><View style={s.row}>
          <Action secondary label="Cancel" disabled={busy} onPress={()=>router.back()}/>
          <Action label={inUse?'In use':'Replace'} disabled={inUse||busy||unownedPreview.length>0} onPress={()=>{
            if(outfitMode&&!preview.outfit){Alert.alert('Choose an outfit','Pick something for your bunny first.');return;}
            const chosen=Object.fromEntries(Object.entries(preview).filter(([slot])=>outfitMode?slot==='outfit':slot!=='outfit').map(([slot,item])=>[slot,item.stable_id]));
            setBurrowLoadoutLocally(chosen,data.profile.id,outfitMode);
            router.back();
            const action=outfitMode?()=>saveBunnyOutfit(preview.outfit.stable_id):()=>saveRoomLoadout('home',chosen);
            void runBurrowAction(outfitMode?`outfit:${preview.outfit.stable_id}`:'shared-loadout',action,{silent:true}).then(ok=>{if(!ok)void refreshBurrow({silent:true});});
          }}/>
        </View><Action secondary label="Reset preview" onPress={()=>{
          const defaults:Record<string,MajorUpdateCatalogItem>={...preview};data.catalog.filter(item=>item.metadata.starter&&item.metadata.slot&&(outfitMode?item.item_type==='outfit':item.item_type==='decor')).forEach(item=>{defaults[item.metadata.slot!]=item;});setDraft(defaults);
        }}/></>}
        <View style={!decorating&&shopStyles.surface}>
        <View style={shopStyles.categoryRail}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={shopStyles.categoryItems}>{categories.map(cat=>{const art=burrowArtFor(cat);return <Pressable accessibilityRole="button" accessibilityState={{selected:effectiveCategory===cat}} key={cat} onPress={()=>setCategory(cat)} style={[shopStyles.category,effectiveCategory===cat&&shopStyles.activeCategory]}>{art&&<Image source={art.source} contentFit="contain" style={shopStyles.categoryArt}/>}<Text numberOfLines={1} style={[shopStyles.categoryText,effectiveCategory===cat&&shopStyles.activeCategoryText]}>{categoryName(cat)}</Text></Pressable>;})}</ScrollView></View>
        <View style={shopStyles.sectionHeading}><Text style={[shopStyles.sectionTitle,!decorating&&shopStyles.lightTitle]}>{categoryName(effectiveCategory)}</Text>{decorating&&<Text style={shopStyles.sectionSubtitle}>Tap an item to see it in your room. Save when it feels right.</Text>}</View>
        {decorating&&unownedPreview.length>0&&<Card title="Just a preview" body="Own these items before saving. Cancel restores your saved room.">
          {unownedPreview.map(item=><Action key={item.stable_id} secondary label={item.title} onPress={()=>setSelected(item)}/>)}
        </Card>}
        <View style={s.grid}>{items.map(item=><Pressable key={item.stable_id} accessibilityRole="button" accessibilityLabel={item.title} style={[s.tile,!decorating&&s.shopTile,!decorating&&shopStyles.productTile,preview[item.metadata.slot??'']?.stable_id===item.stable_id&&decorating&&s.selectedTile]} onPress={()=>{
          if(decorating&&item.metadata.slot){setDraft({...preview,[item.metadata.slot]:item});if(!owned(item))setSelected(item);}else setSelected(item);
        }}><CatalogArtwork item={item} sizePx={!decorating?Math.max(66,Math.min(110,Math.floor((Math.min(screenWidth,560)-60)/3)-10)):undefined}/><Text numberOfLines={2} style={[s.tileTitle,!decorating&&s.shopTileTitle]}>{item.title}</Text><CoinLabel style={s.price}>{owned(item)?'✓ Owned':item.plus_only&&!data.hasPlus?'✦ PLUS':item.price==null?'Adventure find':`{coin} ${item.price}`}</CoinLabel></Pressable>)}</View>
        {!items.length&&<Card title="More little things are on their way" body="This category has no published items yet."/>}
        {!decorating&&<View style={shopStyles.footer}><Action secondary label="My collection" onPress={()=>openBurrow('collection')}/><Action label="Decorate room" onPress={()=>openBurrow('decorate')}/></View>}
        </View>
      </>;
    }
    if(section==='friends_room')return <>
      <View style={{height:Math.max(310,screenHeight*.47),justifyContent:'flex-end',alignItems:'center'}} pointerEvents="none">
        {data.friendVisit&&burrowFriendArt(data.friends.find(friend=>friend.stable_id===data.friendVisit?.friend_id)?.name)&&<Image source={burrowFriendArt(data.friends.find(friend=>friend.stable_id===data.friendVisit?.friend_id)?.name)} contentFit="contain" style={{width:Math.min(screenWidth*.7,320),height:Math.min(screenHeight*.34,300)}}/>}
      </View>
      <FriendVisitCard data={data} busy={busy} showArt={false}/>
    </>;
    if(section==='moments')return null;
    if(section==='affection')return null;
    if(section==='adventure'){
      return <>
        {adventure?<Card title="Your discovery is safe" body="Refresh to load the end of your adventure.">
          <Action label="Refresh" disabled={busy||loading} onPress={()=>void refreshBurrow()}/>
        </Card>:data.dailyAdventureUsed?<Card title="Your bunny is home for today" body="Another adventure will be ready after your local midnight."/>:data.readyRecordId?<AdventureReady disabled={busy} onStart={()=>beginAdventure(data.readyRecordId!)}/>:<AdventureEntry
          onWrite={()=>{prefetchAdventureRewards(data.adventureCollection?.enabled);router.push('/(main)/reflect-typing' as Href);}} onTap={()=>{prefetchAdventureRewards(data.adventureCollection?.enabled);router.push('/(main)/reflect-guided' as Href);}}/>}
      </>;
    }
    if(section==='memories_room')return <BurrowHistory data={data} kind="memories" busy={busy}/>;
    if(section==='game_room')return <Card title="Game Room" body="Choose a game to discover how well you know each other."><Action label="Open games" onPress={()=>router.replace('/(main)/game-room' as Href)}/></Card>;
    return <Card title="Our Burrows" body="Choose a room to spend a little time together."><Action label="Explore rooms" onPress={()=>openBurrow('burrow')}/></Card>;
  }
  if(section==='friends_room'&&data&&(data.friendVisitsVersion===2||data.friendVisit?.version===2))return <FriendVisitCard data={data} busy={busy}/>;
  if(section==='adventure'&&completion.current)return <AdventureStageTransition stageKey={`settlement:${completion.current.activeAdventure!.id}`}>
    <AdventureCompletionScreen key={completion.current.activeAdventure!.id} data={completion.current}/></AdventureStageTransition>;
  if(section==='adventure'&&data&&adventure?.status==='in_progress')return <AdventureStageTransition stageKey="ongoing">
    <AdventureProgressScreen data={data} now={now} onHome={()=>dismissToRetainedTab('/(main)/(tabs)')}/></AdventureStageTransition>;
  if(section==='affection')return <AffectionHub data={data} loading={loading} receivedAt={receivedAt} initialInbox={initialInbox||attention.affection>0}/>;
  if(section==='partner_room')return <PartnerRoomScreen/>;
  if(section==='moments'&&data)return <MomentsTimeline data={data}/>;
  if(section==='collection')return <CollectionRoomScreen data={data} loading={loading} error={error} busy={busy}
    onRefresh={()=>void refreshBurrow({silent:!!data})} onClaimGift={id=>act(`gift:${id}`,()=>claimGift(id))}/>;
  if((section==='shop'||section==='decorate')&&data&&!data.catalogComplete)return <View style={[s.loading,{backgroundColor:'#FFF4E1',paddingTop:insets.top}]}><BurrowBackButton onPress={()=>router.back()}/><View style={{alignItems:'center',gap:18,padding:24}}><ActivityIndicator color="#673019"/><Text style={s.body}>Preparing your shop…</Text><View style={{width:180}}><Action label="Retry" onPress={()=>void refreshBurrow({silent:true})}/></View></View></View>;
  if ((section==='shop'||section==='decorate')&&data) return <BurrowShop data={data} section={section}
    initialCategory={initialCategory} away={adventureIsAway(giftRecipientId?data.partnerAdventure:adventure,now)} ownedOnly={ownedOnly}
    initialItemId={initialItemId} collectionOwnerId={collectionOwnerId} giftRecipientId={giftRecipientId} giftActorId={giftActorId} retainedTab={asTab}/>;
  const flatSurface=burrowFlatSurface(section,adventureEntry||adventureLogged);
  const PageScrollView=section==='burrow'?BurrowMapScrollView:ScrollView;
  const page = <View style={[s.root,{backgroundColor:flatSurface??BURROW_PAGE_COLORS[0],overflow:'hidden'}]}>
    {section!=='home'&&section!=='burrow'&&section!=='quests'&&!adventureEntry&&!adventureLogged&&!(section==='adventure'&&adventure?.status==='in_progress')&&<Image source={background} contentFit="cover" contentPosition="top" style={StyleSheet.absoluteFillObject} pointerEvents="none"/>}
    <View style={[s.frame,section==='home'||section==='burrow'||section==='quests'||adventureEntry?s.homeFrame:{paddingTop:insets.top}]}>
      {/* Keep the complete cached room under the cover. A first launch waits
          for its own data/art; never invent a wallet or expose partial setup. */}
      {section==='home'?<View style={s.homeCanvas} onLayout={()=>markHomeEntryAsset('burrow-layout',attempt)}><HomeArtScene
        timeZone={data?.profile.timezone_name} now={now}
        balance={data?.wallet.balance??null} slots={homeSlots} photos={homeVisual?.roomPhotos??data?.roomPhotos} ownerId={data?.profile.id??''}
        onWalletAnchor={setWalletAnchor}
        away={adventureIsAway(adventure,now)} busy={busy} updates={attention}
        pullToPeekEnabled={focused&&!!homeVisual&&!homeEntering&&!modalOpen}
        onToyInteract={()=>openHomeInteraction('toy')} onToyPhoto={()=>openHomeInteraction('toy')}
        onMenu={()=>openPreparedBurrow('/(main)/menu')} onCarrots={()=>openBurrow('carrot_shop')}
        onAffection={()=>openBurrow('affection')} onAdventure={()=>{
          if(adventureFinishedToday(data,now)){setNappingOpen(true);return;}
          openBurrow('adventure');
        }}
        onLetter={()=>openHomeInteraction('letter')}
        onBurrows={()=>openBurrow('burrow')}
        onSlot={homeSlot}/></View>
      :<>{section!=='burrow'&&section!=='moments'&&section!=='quests'&&!adventureEntry&&!adventureLogged&&!(section==='adventure'&&adventure?.status==='in_progress')&&<View style={[s.header,{paddingVertical:12},section==='shop'&&shopStyles.topHeader]}>{!isTab&&<BurrowBackButton onPress={()=>router.back()}/>}<Text style={[s.heading,['friends_room','game_room','memories_room','collection'].includes(section)&&ROOM_TITLE_STYLE,section==='shop'&&shopStyles.topTitle]}>{titles[section]}</Text>{data&&section!=='friends_room'&&<CoinWallet balance={data.wallet.balance} disabled={section==='carrot_shop'} onPress={()=>openBurrow('carrot_shop')}/>}</View>}
      {!data?<View style={s.loading}>{loading?<ActivityIndicator color="#FFF1DB"/>:<Text style={s.creamCopy}>Your burrow needs a connection to load.</Text>}</View>:<PageScrollView key={section} style={{flex:1}} onLayout={()=>markHomeEntryAsset('burrow-layout',attempt)} contentContainerStyle={section==='burrow'?s.mapContent:[adventureEntry?adventureStyles.entryScroll:section==='quests'?s.mapContent:s.content,{paddingBottom:adventureEntry?insets.bottom:isTab?24:insets.bottom+24}]} {...burrowPageScrollBehavior(section)} refreshControl={section==='burrow'||section==='carrot_shop'||section==='quests'?undefined:<RefreshControl refreshing={pullRefreshing} onRefresh={()=>{setPullRefreshing(true);void refreshBurrow().finally(()=>setPullRefreshing(false));}} tintColor="#FFF1DB"/>}>{content()}</PageScrollView>}</>}
      {error&&<View style={[s.error,section==='home'&&s.homeError]} accessibilityRole="alert"><Text style={s.body}>{burrowErrorMessage(error)}</Text><Action secondary label="Refresh" disabled={busy||loading} onPress={()=>void refreshBurrow()}/></View>}
      {busy&&<View style={s.busy} pointerEvents="none"><ActivityIndicator color="#FFF"/><Text style={s.creamCopy}>Saving your little moment…</Text></View>}
      {(section==='burrow'||(adventureEntry&&!isTab))&&<BurrowBackButton onPress={()=>router.canGoBack()?router.back():openBurrow('home')} style={{position:'absolute',top:insets.top+12,left:18,zIndex:10}}/>}
    </View>
    {section==='home'&&data&&<DailyPlusBonus key={`${data.profile.id}:${data.localDate}`} userId={data.profile.id}
      bonus={data.dailyPlusBonus} localDate={data.localDate} balance={data.wallet.balance} anchor={walletAnchor}
      enabled={focused&&bonusDayCurrent&&!homeEntering&&!busy&&!toyOpen&&!inboxOpen&&!letterOpen&&!careKind&&!selected&&!frameSheetOpen&&!nappingOpen}/>}
    {section==='home'&&focused&&nappingOpen&&<AdventureNappingDialog onClose={()=>setNappingOpen(false)}/>}
    <ScreenOverlay visible={toyOpen&&!!data} transparent onRequestClose={()=>setToyOpen(false)}>
      <View style={[s.scrim,{justifyContent:'center',paddingHorizontal:20}]}><View style={[s.sheet,s.toySheet]} accessibilityViewIsModal>
        <Text accessibilityRole="header" style={s.cardTitle}>A little love for your toy</Text>
        <Text style={s.body}>Tap, press or gently drag the doll. It bounces back and sends up little hearts.</Text>
        {(()=>{const asset=burrowArtForItem(sceneSlots.couple_doll,'couple_dolls');if(!asset)return <Text style={s.itemIcon}>🧸</Text>;
          const ratio=Math.min(214/asset.width,238/asset.height);
          return <InteractiveDoll asset={asset} photo={data?toyPhotoFor(data.roomPhotos,data.profile.id,sceneSlots.couple_doll?.stable_id):undefined}
            disabled={busy} onInteract={recordToyInteraction} interactionScope={data?`${data.profile.id}:${data.partner?.id??''}:${data.pairVersion??''}:${sceneSlots.couple_doll?.stable_id}:${toyPhotoFor(data.roomPhotos,data.profile.id,sceneSlots.couple_doll?.stable_id)?.id??'empty'}`:undefined}
            onEditPhoto={openToyPhoto} style={s.toyStage}
            artStyle={{position:'absolute',left:(240-asset.width*ratio)/2,top:(250-asset.height*ratio)/2,width:asset.width*ratio,height:asset.height*ratio}}/>;})()}
        <Action label="Add or change face photo" onPress={openToyPhoto}/>
        <Action secondary label="Done" onPress={()=>setToyOpen(false)}/>
      </View></View>
    </ScreenOverlay>
    {data&&(section==='home'||frameSheetOpen)&&<PhotoFrameSheet visible={frameSheetOpen} photo={data.roomPhotos?.find(photo=>photo.ownerId===data.profile.id&&photo.kind==='frame')}
      onClose={()=>setFrameSheetOpen(false)} onChoose={chooseFramePhoto}
      remaining={data.photoUsage?.frame.remaining} limit={data.photoUsage?.frame.limit}
      onHistory={()=>{setFrameSheetOpen(false);requestAnimationFrame(()=>router.push('/(main)/frame-photo-history' as Href));}}/>}
    {frameCropAsset&&data&&<FramePhotoCropper asset={frameCropAsset}
      onCancel={()=>{setFrameCropAsset(null);setFrameSheetOpen(true);}}
      onConfirm={async crop=>{await uploadRoomPhoto(data,data.profile.id,'frame',frameCropAsset,crop);setFrameCropAsset(null);setFrameSheetOpen(true);}}/>}
    <Modal visible={inboxOpen&&!!data} transparent animationType="slide" onRequestClose={()=>setInboxOpen(false)}>
      <View style={s.scrim}><ScrollView style={s.sheet} contentContainerStyle={{gap:16,paddingBottom:35}}>{data&&<>
        <Text accessibilityRole="header" style={s.cardTitle}>A little love arrived</Text>
        {data.affectionInbox.length>0?<>{data.affectionInbox.map(message=><View key={message.id} style={s.inboxAffection}>
          <Image source={BURROW_AFFECTION_ICONS[message.affection_type]} contentFit="contain" style={s.affectionIcon}/>
          <View style={{flex:1,gap:6}}><Text style={s.tileTitle}>{data.partner?.display_name??'Your person'} sent you {message.affection_type==='miss_you'?'a Miss You':message.affection_type==='spicy'?'a Spicy moment':`a ${AFFECTION_COPY[message.affection_type].label}`}</Text>
            <Action label="Receive with love" disabled={busy} onPress={()=>{void haptics.light();act(`read-affection:${message.id}`,()=>markAffectionRead([message.id]));}}/></View>
        </View>)}</>:<Text style={s.body}>No unread gestures.</Text>}
        {data.gifts.map(gift=><Card key={gift.id} title={data.catalog.find(item=>item.stable_id===gift.item_id)?.title??'A little gift'}><Action label="Add to my collection" disabled={busy} onPress={()=>act(`gift:${gift.id}`,()=>claimGift(gift.id))}/></Card>)}
        {!data.gifts.length&&<Text style={s.body}>No unopened gifts.</Text>}
        <Action secondary label="Close inbox" onPress={()=>setInboxOpen(false)}/>
      </>}</ScrollView></View>
    </Modal>
    <Modal visible={letterOpen&&!!data} transparent animationType="slide" onRequestClose={()=>setLetterOpen(false)}>
      <View style={s.scrim}><View style={s.sheet} accessibilityViewIsModal>
        <Text accessibilityRole="header" style={s.cardTitle}>A letter for your person 💌</Text>
        <Text style={s.body}>{data?.partner?'Write one little thing you want them to remember. It will appear in your shared Memories Room.':'Write one little thing worth remembering. Your letter will be saved in Memories Room.'}</Text>
        <TextInput accessibilityLabel="Love letter" multiline maxLength={4800} autoFocus value={letterText} onChangeText={setLetterText} placeholder="Dear you…" placeholderTextColor="#927560" style={s.letterInput}/>
        <Text style={s.body}>{letterText.length} / 4800</Text>
        <Action label={data?.partner?'Send my letter':'Save my letter'} disabled={busy||!letterText.trim()} onPress={()=>{
          void runBurrowAction('love-letter',key=>saveMemoryRoomEntry(null,`💌 ${letterText.trim()}`,null,key)).then(ok=>{if(ok){setLetterText('');setLetterOpen(false);}});
        }}/>
        <Action secondary label="Keep writing later" disabled={busy} onPress={()=>setLetterOpen(false)}/>
      </View></View>
    </Modal>
    <Modal visible={!!careKind&&!!data} transparent animationType="slide" onRequestClose={()=>setCareKind(null)}>
      <View style={s.scrim}><View style={s.sheet} accessibilityViewIsModal>
        <Text accessibilityRole="header" style={s.cardTitle}>{careKind==='food'?'Feed your bunny':'Water your flowers'}</Text>
        <Text style={{fontSize:82,textAlign:'center'}}>{careKind==='food'?'🐰':'🌼'}</Text>
        <Text style={s.body}>{careKind==='food'?'A little snack will bring their energy back.':'A gentle watering keeps your flowers bright.'}</Text>
        {displayedCareProgress!==null&&<View style={s.progress}><View style={[s.progressFill,{width:`${Math.round(displayedCareProgress)}%`}]} /></View>}
        <Action label={careKind==='food'?'Give a little snack':'Water gently'} disabled={busy} onPress={()=>{if(!data||!careKind)return;const kind=careKind;void haptics.light();void runBurrowAction(`${kind}:${data.profile.id}`,key=>refillRoomNeed(data.profile.id,kind,key)).then(ok=>{if(ok)setCareKind(null);});}}/>
        <Action secondary label="Later" disabled={busy} onPress={()=>setCareKind(null)}/>
      </View></View>
    </Modal>
    {/* No exiting native Modal may compete with the next checkout overlay. */}
    <ScreenOverlay visible={!!selected} transparent onRequestClose={()=>setSelected(null)}>
      <View style={s.scrim}><ScrollView style={[s.sheet,{maxHeight:'88%'}]} contentContainerStyle={{gap:14,paddingBottom:30}}>{selected&&data&&<>
        <CatalogArtwork item={selected} large/><Text style={s.cardTitle}>{selected.title}</Text><Text style={s.body}>{selected.description}</Text>
        <Text style={s.body}>More {categoryName(selected.category)} choices</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:10}}>{data.catalog.filter(item=>item.category===selected.category&&item.stable_id!==selected.stable_id&&!!item.price).slice(0,8).map(item=><Pressable key={item.stable_id} accessibilityRole="button" accessibilityLabel={`Preview ${item.title}`} onPress={()=>setSelected(item)} style={{width:108,padding:8,borderRadius:14,backgroundColor:'#F7E5CC',alignItems:'center'}}><CatalogArtwork item={item}/><Text numberOfLines={2} style={s.tileTitle}>{item.title}</Text></Pressable>)}</ScrollView>
        {selected.price!=null&&selected.price>0&&!data.inventory.some(i=>i.owner_id===data.profile.id&&i.item_id===selected.stable_id)&&<Action label={selected.plus_only&&!data.hasPlus?'Plus required':`Buy for {coin} ${selected.price}`} disabled={busy} onPress={()=>buy(selected)}/>}
        {!!selected.price&&selected.tradable&&!!data.partner&&<Action secondary label={`Gift my partner · {coin} ${selected.price}`} disabled={busy||data.inventory.some(i=>i.owner_id===data.partner?.id&&i.item_id===selected.stable_id)} onPress={()=>buy(selected,true)}/>}
        <Action secondary label="Close" disabled={busy} onPress={()=>setSelected(null)}/>
      </>}</ScrollView></View>
    </ScreenOverlay>
  </View>;
  return section==='adventure' ? <AdventureStageTransition stageKey={data?.readyRecordId?'ready':'entry'}>{page}</AdventureStageTransition> : page;
}

const s=StyleSheet.create({
  root:{flex:1},frame:{flex:1,width:'100%',maxWidth:560,alignSelf:'center'},homeFrame:{maxWidth:undefined},homeCanvas:{flex:1},homeError:{position:'absolute',left:0,right:0,top:100},header:{paddingHorizontal:18,paddingVertical:15,flexDirection:'row',alignItems:'center',gap:10},heading:{color:'#FFF3E0',fontSize:25,fontWeight:'800',flex:1},wallet:{backgroundColor:'#FFF3DF',paddingHorizontal:12,paddingVertical:9,borderRadius:30},walletText:{color:'#563720',fontSize:16,fontWeight:'800'},back:{width:36,height:36,borderRadius:18,backgroundColor:'#FFF3DF',alignItems:'center'},backText:{fontSize:32,lineHeight:34,color:'#663B26'},content:{paddingHorizontal:18,gap:18},mapContent:{paddingHorizontal:0},card:{backgroundColor:'#FFF4E1',borderRadius:25,padding:22,gap:14,shadowColor:'#4E281B',shadowOffset:{width:0,height:4},shadowOpacity:.13,shadowRadius:0,elevation:2},cardTitle:{color:'#553521',fontSize:22,fontWeight:'800'},body:{color:'#79563E',fontSize:15,lineHeight:23},creamCopy:{color:'#FFF0D7',fontSize:15,lineHeight:23,textAlign:'center'},row:{flexDirection:'row',gap:12},action:{flexGrow:1,flexShrink:1,backgroundColor:'#2F8D72',paddingHorizontal:14,paddingVertical:16,borderRadius:20,alignItems:'center',justifyContent:'center',minHeight:50},secondary:{backgroundColor:'#F9D9AA'},actionText:{color:'#FFF8EB',fontSize:16,fontWeight:'800',textAlign:'center'},grid:{flexDirection:'row',flexWrap:'wrap',gap:12},tile:{width:'46%',flexGrow:1,backgroundColor:'#FFF3DF',borderRadius:24,padding:18,alignItems:'center',gap:12,borderWidth:2,borderColor:'transparent'},shopTile:{width:'30%',flexGrow:0,padding:3,gap:6,borderRadius:17},shopTileTitle:{fontSize:13,lineHeight:17},collectionTile:{width:'29%',minWidth:94,flexGrow:1,padding:8,gap:6,borderRadius:17},collectionTitle:{fontSize:13,lineHeight:17},selectedTile:{borderColor:'#EAA340',backgroundColor:'#FFE8BC'},itemIcon:{fontSize:53,textAlign:'center'},itemArt:{width:110,height:110,overflow:'hidden'},itemArtCompact:{width:74,height:74,overflow:'hidden'},itemArtLarge:{width:160,height:160,alignSelf:'center',overflow:'hidden'},tileTitle:{color:'#563B27',fontSize:17,fontWeight:'700',textAlign:'center'},price:{color:'#2D775C',fontWeight:'700',fontSize:14},chips:{gap:8,paddingVertical:4},chip:{paddingHorizontal:17,paddingVertical:13,backgroundColor:'#F9DAB3',borderRadius:18,alignItems:'center',minWidth:82},chipSelected:{backgroundColor:'#F3AF4D'},chipText:{color:'#633823',fontWeight:'700'},categoryArt:{width:52,height:52},roomDoor:{width:'78%',backgroundColor:'#EBA35B',padding:25,borderRadius:75,borderWidth:9,borderColor:'#9C542E',alignItems:'center',gap:8},roomIcon:{fontSize:49},roomHint:{color:'#71472A',textAlign:'center',lineHeight:19,fontSize:13},tunnel:{position:'absolute',left:'49%',top:60,bottom:40,width:18,backgroundColor:'#C58247',borderRadius:30},heroEmoji:{fontSize:110,textAlign:'center',paddingVertical:42},progress:{height:13,borderRadius:10,overflow:'hidden',backgroundColor:'#E7D6BB'},progressFill:{height:13,backgroundColor:'#D88748'},scrim:{flex:1,backgroundColor:'#1E100DBB',justifyContent:'flex-end',alignItems:'center'},sheet:{width:'100%',maxWidth:560,padding:30,paddingBottom:50,gap:18,backgroundColor:'#FFF2DD',borderTopLeftRadius:32,borderTopRightRadius:32},toySheet:{borderRadius:30,padding:22,paddingBottom:22},toyStage:{width:240,height:250,alignSelf:'center'},inboxAffection:{flexDirection:'row',alignItems:'center',gap:14,padding:12,backgroundColor:'#FFF9EE',borderRadius:20},error:{padding:16,gap:10,backgroundColor:'#FFE2CE',margin:16,borderRadius:18},loading:{flex:1,alignItems:'center',justifyContent:'center'},busy:{position:'absolute',bottom:24,alignSelf:'center',backgroundColor:'#523727EE',padding:15,borderRadius:20,gap:8},questIcon:{width:64,height:64,alignSelf:'center'},affectionIcon:{width:76,height:76},letterInput:{minHeight:160,maxHeight:260,textAlignVertical:'top',color:'#503324',fontSize:17,borderWidth:1,borderColor:'#D9B897',borderRadius:17,padding:16,backgroundColor:'#FFF9EE'},
});

const affectionStyles=StyleSheet.create({
  title:{color:'#FFF8EE',fontSize:30,fontWeight:'800',marginTop:12},
  subtitle:{color:'#FFF0DE',fontSize:17,lineHeight:24,marginBottom:18},
});

const shopStyles=StyleSheet.create({
  topHeader:{minHeight:64,justifyContent:'center'},
  topTitle:{textAlign:'center'},
  topWallet:{position:'absolute',right:12,top:13},
  surface:{backgroundColor:'#FFF9F0',marginHorizontal:-18,paddingHorizontal:18,paddingBottom:24,gap:18,minHeight:650},
  categoryRail:{backgroundColor:'#FFF9F0',marginHorizontal:-18,marginTop:-5,borderBottomWidth:1,borderColor:'#E7D0B9'},
  categoryItems:{paddingHorizontal:9,gap:2},
  category:{width:75,minHeight:82,alignItems:'center',justifyContent:'center',gap:4,borderBottomWidth:3,borderColor:'transparent'},
  activeCategory:{borderColor:'#D9622B'},
  categoryArt:{width:34,height:34},
  categoryText:{fontSize:11,fontWeight:'700',color:'#8F7567'},
  activeCategoryText:{color:'#C85729'},
  sectionHeading:{gap:2,marginTop:4},
  sectionTitle:{fontSize:27,fontWeight:'900',color:'#FFF8EE'},
  sectionSubtitle:{fontSize:14,color:'#FDE0C4'},
  lightTitle:{color:'#3E1E14'},
  lightSubtitle:{color:'#805E4D'},
  productTile:{backgroundColor:'#FFFDF8',borderColor:'#F6E8D6',borderWidth:1,shadowColor:'#542413',shadowOpacity:.17,shadowOffset:{width:0,height:3},shadowRadius:2,elevation:2},
  footer:{flexDirection:'row',gap:10,paddingVertical:16},
});


const adventureStyles=StyleSheet.create({
  entryScroll:{paddingHorizontal:0,flexGrow:1},
});
