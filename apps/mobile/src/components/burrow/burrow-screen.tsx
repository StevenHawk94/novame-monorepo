import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { router, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { AFFECTION_TYPES, BURROW_DECOR_SHOP_CATEGORIES, type AffectionType } from '@novame/domain';
import { affectionCooldownRemainingMs } from '@novame/engine';
import {
  claimAdventureResult, claimDailyQuest, claimSpecialQuest, claimGift, completeAffection,
  deleteMemoryRoomEntry, deleteRoomFramePhoto, interactBurrowToy, saveBunnyOutfit, saveMemoryRoomEntry, setRoomSleep,
  markAffectionRead, purchaseCatalogItem, refillRoomNeed, saveRoomLoadout, settleAdventure,
  startAdventure, visitPartnerRoom, type MajorUpdateBootstrap, type MajorUpdateCatalogItem,
} from '@/lib/app-major-update-api';
import { burrowClock, burrowErrorMessage, refreshBurrow, runBurrowAction, setBurrowLoadoutLocally, startBurrowAdventureLocally, useBurrow } from '@/lib/burrow-store';
import { adventureHasArrived, adventureIsAway, careProgress, roomNeedDisplay, roomSlots } from '@/lib/burrow-presentation';
import { markHomeEntryAsset } from '@/lib/home-entry-readiness';
import { useHomeEntry } from '@/lib/use-home-entry';
import { registerOverlay } from '@/lib/overlay-presence';
import { RoomSceneArt as RoomScene } from './room-scene-art';
import { HomeArtScene } from './home-art-scene';
import { HomeArtPreview } from './home-art-preview';
import { CarrotShop } from './carrot-shop';
import { AFFECTION_COPY, AffectionGesture } from './affection-gesture';
import { FriendVisitCard } from './friend-visit-card';
import { AdventureFriendCard } from './adventure-friend-card';
import { RoomPhotoEditor } from './room-photo';
import { PhotoFrameSheet } from './photo-frame-sheet';
import { InteractiveDoll } from './interactive-doll';
import { BurrowMusicPicker } from './burrow-music';
import { BunnyActor } from './bunny-actor';
import { MemoryPhotos } from './memory-photos';
import { BurrowHistory } from './burrow-history';
import { adventureTrail } from '@/lib/adventure-trail';
import { AdventureTreasure } from './adventure-treasure';
import { burrowLocalDay } from '@/lib/burrow-local-day';
import { AffectionDelivery } from './affection-delivery';
import { BURROW_BACKGROUNDS, burrowArtFor, burrowArtForItem } from '@/lib/burrow-art-assets';
import { BURROW_AFFECTION_ICONS, BURROW_QUEST_ICONS, burrowFriendArt } from '@/lib/burrow-ui-assets';
import { BurrowMap } from './burrow-map';
import { MomentsHearts } from './moments-hearts';
import { QuestBoard } from './quest-board';
import { haptics } from '@/lib/haptics';
import { BurrowBackButton } from './burrow-back-button';
import { useBurrowSwipeBack } from './use-burrow-swipe-back';

export type BurrowSection = 'home'|'burrow'|'quests'|'shop'|'moments'|'collection'|'adventure'|'affection'|'decorate'|'partner_room'|'our_room'|'friends_room'|'game_room'|'memories_room'|'self_care_room'|'carrot_shop';
const titles: Record<BurrowSection,string> = {home:'Our Room',burrow:'Our Burrows',quests:'Quests',shop:'Shop',moments:'Our Moments',collection:'Collection',adventure:'Adventure',affection:'Affection',decorate:'Decorate',partner_room:'Partner’s Room',our_room:'Our Room',friends_room:'Friends’ Room',game_room:'Game Room',memories_room:'Memories Room',self_care_room:'Rage Room',carrot_shop:'Carrot Shop'};
const roomInfo:Record<string,{title:string;icon:string;subtitle:string}>={
  my_room:{title:'My Room',icon:'🐰',subtitle:'A cozy place to come home to'},
  partner_room:{title:'Partner’s Room',icon:'💌',subtitle:'Stop by and leave a little care'},
  our_room:{title:'Our Room',icon:'💕',subtitle:'A quiet corner, just for us'},
  friends_room:{title:'Friends’ Room',icon:'🦊',subtitle:'Meet the keepers of little stories'},
  game_room:{title:'Game Room',icon:'🏆',subtitle:'70 little ways to know each other'},
  rage_room:{title:'Rage Room',icon:'⚡',subtitle:'Make space around a difficult feeling'},
  self_care_room:{title:'Self Care',icon:'🌿',subtitle:'A gentler next step'},
  memories_room:{title:'Memories Room',icon:'📖',subtitle:'Little moments worth keeping'},
  collection_room:{title:'Collection',icon:'🎒',subtitle:'Everything you’ve found along the way'},
};
const questNames:Record<string,string>={write_adventure_record:'Complete today’s Adventure record',send_affection:'Send an Affection',water_partner_flower:'Water a flower',feed_partner_bunny:'Feed your bunny',interact_with_toy:'Play with your doll',visit_partner_room:'Visit your partner’s room',finish_adventure:'Finish an adventure',play_game:'Play a game with your partner'};
const decorCategories=BURROW_DECOR_SHOP_CATEGORIES;
const categoryName=(value:string)=>value.replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
export function openBurrow(section:BurrowSection,extra?:Record<string,string>){
  if(section==='game_room'){router.push({pathname:'/(main)/game-room',params:extra} as Href);return;}
  if(section==='burrow'||section==='shop'||section==='quests'||section==='moments'||section==='home'){
    const route=section==='home'? '/(main)/(tabs)' : `/(main)/(tabs)/${section==='moments'?'friends':section}`;
    router.navigate(route as Href);return;
  }
  router.push({pathname:'/(main)/burrow-detail',params:{section,...extra}} as Href);
}
const iconFor=(item:MajorUpdateCatalogItem)=>({windows:'🪟',lamps:'💡',vases:'🌼',decor:'🪴',cushions:'🛏️',tables:'🪵',rugs:'🧶',cabinets:'🗄️',posters:'🍃',music_players:'📻',frames:'🖼️',couple_dolls:'🧸',outfits:'🧥',our_room:'💕',gifts:'🎁',rooms:'🏡',music:'🎵'}[item.category]??'✨');
function CatalogArtwork({item,large=false,compact=false,sizePx}:{item:MajorUpdateCatalogItem;large?:boolean;compact?:boolean;sizePx?:number}){
  const asset=burrowArtForItem(item);
  if(!asset)return <Text style={s.itemIcon}>{iconFor(item)}</Text>;
  const size=sizePx??(large?160:compact?74:110);
  const [left,top,right,bottom]=asset.bounds;
  const ratio=Math.min(size/(right-left),size/(bottom-top));
  return <View style={[large?s.itemArtLarge:compact?s.itemArtCompact:s.itemArt,sizePx!=null&&{width:size,height:size}]} accessibilityLabel={item.title}>
    <Image source={asset.source} contentFit="fill" style={{position:'absolute',left:(size-(right-left)*ratio)/2-left*ratio,top:(size-(bottom-top)*ratio)/2-top*ratio,width:asset.width*ratio,height:asset.height*ratio}}/>
  </View>;
}
function Action({label,onPress,disabled=false,secondary=false}:{label:string;onPress:()=>void;disabled?:boolean;secondary?:boolean}){
  return <Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} onPress={onPress}
    style={({pressed})=>[s.action,secondary&&s.secondary,(pressed||disabled)&&{opacity:.5}]}><Text style={[s.actionText,secondary&&{color:'#64402C'}]}>{label}</Text></Pressable>;
}
function Card({title,body,children}:{title:string;body?:string;children?:React.ReactNode}){
  return <View style={s.card}><Text style={s.cardTitle}>{title}</Text>{body&&<Text style={s.body}>{body}</Text>}{children}</View>;
}

export function BurrowScreen({section,roomType='home',initialCategory='cushions',asTab=false,homeIntent}:{section:BurrowSection;roomType?:'home'|'our';initialCategory?:string;asTab?:boolean;homeIntent?:string}){
  const {data,loading,error,busy,receivedAt}=useBurrow();
  const {attempt}=useHomeEntry();
  const insets=useSafeAreaInsets();
  const {width:screenWidth,height:screenHeight}=useWindowDimensions();
  const [clock,setClock]=useState(burrowClock());
  const [category,setCategory]=useState<string>(initialCategory);
  const [collectionTab,setCollectionTab]=useState<'items'|'gifts'|'friends'>('items');
  const [collectionItemFilter,setCollectionItemFilter]=useState<'all'|'furniture'|'outfits'|'rooms'>('all');
  const [collectionOwner,setCollectionOwner]=useState<'mine'|'partner'>('mine');
  const [selected,setSelected]=useState<MajorUpdateCatalogItem|null>(null);
  const [affection,setAffection]=useState<AffectionType|null>(null);
  const [loveSent,setLoveSent]=useState(false);
  const [draft,setDraft]=useState<Record<string,MajorUpdateCatalogItem>|null>(null);
  const [feedback,setFeedback]=useState<string|null>(null);
  const [editingMemory,setEditingMemory]=useState<string|null>(null);
  const [photoEditor,setPhotoEditor]=useState<'frame'|'doll'|null>(null);
  const [photoEditorSource,setPhotoEditorSource]=useState<'camera'|'library'|undefined>();
  const [frameSheetOpen,setFrameSheetOpen]=useState(false);
  const [musicOpen,setMusicOpen]=useState(false);
  const [inboxOpen,setInboxOpen]=useState(false);
  const [letterOpen,setLetterOpen]=useState(false);
  const [letterText,setLetterText]=useState('');
  const [careKind,setCareKind]=useState<'food'|'water'|null>(null);
  const [toyOpen,setToyOpen]=useState(false);
  const toyPhotoTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(()=>()=>{if(toyPhotoTimer.current)clearTimeout(toyPhotoTimer.current);},[]);
  const [pullRefreshing,setPullRefreshing]=useState(false);
  const toyRecordedDay=useRef<string|null>(null);
  const [pairPrompt,setPairPrompt]=useState<string|null>(null);
  const modalOpen=!!photoEditor||frameSheetOpen||toyOpen||musicOpen||!!selected||inboxOpen||letterOpen||!!careKind||!!pairPrompt;
  useEffect(()=>{if(modalOpen)return registerOverlay({});},[modalOpen]);
  const isTab=asTab||['home','quests','moments'].includes(section);
  const swipeBack=useBurrowSwipeBack(()=>section==='shop'||section==='burrow'?openBurrow('home'):router.back());
  const openHomeInteraction=(kind:'toy'|'food'|'water'|'frame'|'letter')=>router.push({pathname:'/(main)/room-interaction',params:{kind}} as Href);
  useEffect(()=>{const timer=setInterval(()=>setClock(burrowClock()),1000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{if(data)markHomeEntryAsset('burrow-data',attempt);},[data,attempt]);
  useEffect(()=>{if(section==='partner_room'&&data?.partner)void runBurrowAction('visit-partner',()=>visitPartnerRoom(),{silent:true});},[section,data?.partner?.id]);
  const now=data?new Date(data.serverNow).getTime()+Math.max(0,clock-receivedAt):clock;
  const midnightRetry=useRef(0);
  useEffect(()=>{
    if(section!=='home'||!data||loading||busy||AppState.currentState!=='active'||clock<midnightRetry.current)return;
    try {
      if(burrowLocalDay(now,data.profile.timezone_name)!==data.localDate){
        midnightRetry.current=clock+60_000;
        void refreshBurrow();
      }
    } catch { /* Invalid profile timezone must not start a refresh loop. */ }
  },[section,data,loading,busy,clock,now]);
  const adventure=data?.activeAdventure;
  const displayedCareProgress=careProgress(data,careKind,now);
  const remaining=adventure?Math.max(0,new Date(adventure.ends_at).getTime()-now):0;
  const countdown=(ms:number)=>`${Math.floor(ms/3600000)}h ${Math.floor(ms%3600000/60000)}m ${Math.floor(ms%60000/1000)}s`;
  const cooldown=data?affectionCooldownRemainingMs(data.lastAffectionAt?new Date(data.lastAffectionAt).getTime():null,now,data.hasPlus):0;
  const owner=section==='partner_room'&&data?.partner?data.partner.id:data?.profile.id;
  const sceneSlots=useMemo(()=>data?roomSlots(data,owner??data.profile.id,section==='our_room'||roomType==='our'):{},[data,owner,section,roomType]);
  const hour=(()=>{try{return Number(new Intl.DateTimeFormat('en-US',{hour:'2-digit',hourCycle:'h23',timeZone:data?.profile.timezone_name??'UTC'}).format(new Date(now)));}catch{return new Date(now).getHours();}})();
  const background=section==='burrow'?(hour>=19||hour<6?BURROW_BACKGROUNDS.burrowNight:BURROW_BACKGROUNDS.burrowDay)
    :section==='adventure'?(data?.adventureResult?BURROW_BACKGROUNDS.adventureFinish:BURROW_BACKGROUNDS.adventure)
    :section==='affection'?(loveSent?BURROW_BACKGROUNDS.affectionSend:BURROW_BACKGROUNDS.affectionSelect)
    :section==='friends_room'?BURROW_BACKGROUNDS.friendsRoom
    :section==='carrot_shop'?BURROW_BACKGROUNDS.carrotShop
    :BURROW_BACKGROUNDS.common;
  const askToPair=(reason='Connect with your person to use this shared feature.')=>{setSelected(null);setPairPrompt(reason);};
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
    startBurrowAdventureLocally(recordId);
    void runBurrowAction(`start:${recordId}`,key=>startAdventure(recordId,key),{silent:true}).then(ok=>{
      if(!ok)void refreshBurrow({silent:true});
    });
  };
  function recordToyInteraction(){
    if(!data)return;
    const scope=`${data.profile.id}:${data.partner?.id??'solo'}:${data.localDate}`;
    if(toyRecordedDay.current===scope)return;
    toyRecordedDay.current=scope;
    void runBurrowAction(`toy:${scope}`,key=>interactBurrowToy(key),{silent:true}).then(ok=>{if(!ok&&toyRecordedDay.current===scope)toyRecordedDay.current=null;});
  }
  function openToyPhoto(){
    setToyOpen(false);
    if(toyPhotoTimer.current)clearTimeout(toyPhotoTimer.current);
    // Wait for the toy's native modal to dismiss before presenting the photo
    // picker sheet; stacking native modals can terminate iOS development builds.
    toyPhotoTimer.current=setTimeout(()=>{setPhotoEditor('doll');toyPhotoTimer.current=null;},380);
  }
  function buy(item:MajorUpdateCatalogItem,gift=false){
    if(!data)return;
    if(gift&&!data.partner){Alert.alert('Gift later','You can buy this for your own burrow now. Sending a gift will be available after you connect.');return;}
    if(item.plus_only&&!data.hasPlus){setSelected(null);router.push('/(main)/(modals)/subscription-paywall' as Href);return;}
    if((item.price??0)>data.wallet.balance){setSelected(null);openBurrow('carrot_shop');return;}
    const recipient=gift?data.partner?.id:data.profile.id;
    if(!recipient)return;
    Alert.alert(gift?'Send this gift?':'Make it yours?',`${item.title} · ${item.price} carrots`,[
      {text:'Cancel',style:'cancel'},
      {text:gift?'Send gift':'Buy',onPress:()=>{setSelected(null);void runBurrowAction(`buy:${item.stable_id}:${recipient}`,key=>purchaseCatalogItem(item.stable_id,recipient,key),{silent:true});}},
    ]);
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
    else if(slot==='vase')openHomeInteraction('water');
    else if(slot==='frame')setFrameSheetOpen(true);
    else if(slot==='couple_doll')openHomeInteraction('toy');
    else if(slot==='music_player')setMusicOpen(true);
  }
  function content(){
    if(!data)return null;
    if(section==='home'||section==='partner_room'||section==='our_room'){
      const needs=roomNeedDisplay(data,section==='partner_room'&&!!data.partner,now);
      const mineOutfit=roomSlots(data,data.profile.id).outfit;
      const partnerOutfit=data.partner?roomSlots(data,data.partner.id).outfit:undefined;
      return <>
        <RoomScene slots={section==='our_room'?{...sceneSlots,outfit:mineOutfit}:sceneSlots} partnerOutfit={partnerOutfit}
          busy={busy} canFeed={needs.food<100} away={section!=='our_room'&&adventureIsAway(section==='partner_room'?data.partnerAdventure:adventure,now)} shared={section==='our_room'}
          photos={data.roomPhotos?.filter(photo=>photo.ownerId===owner)}
          sleeping={{mine:data.sharedRoom.mySleeping,partner:data.sharedRoom.partnerSleeping}} onSlot={slot=>{
          if(slot==='bed')act(`sleep:${!data.sharedRoom.mySleeping}`,key=>setRoomSleep(!data.sharedRoom.mySleeping,key));
          else if(slot==='bunny'&&owner)act(`food:${owner}`,key=>refillRoomNeed(owner,'food',key));
          else if(slot==='vase'&&owner)act(`water:${owner}`,key=>refillRoomNeed(owner,'water',key));
          else if(slot==='frame')setFrameSheetOpen(true);
          else if(slot==='couple_doll')setToyOpen(true);
          else if(slot==='doll_photo')openToyPhoto();
          else if(slot==='music_player'&&section==='home')setMusicOpen(true);
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
          <Action secondary label="Music · choose a tune" onPress={()=>setMusicOpen(true)}/>
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
    if(section==='burrow')return <BurrowMap night={hour>=19||hour<6} visiting={!!data.friendVisit&&!data.friendVisit.completed_at&&!data.friendVisit.declined_at} onRoom={id=>{
      if(id==='our_room')router.navigate('/(main)/(tabs)' as Href);
      else if(id==='rage_room')router.push('/(main)/tame-enemy' as Href);
      else openBurrow(id==='collection_room'?'collection':id);
    }}/>;
    if(section==='quests')return <QuestBoard data={data} busy={busy}
      onGo={questGo}
      onClaim={q=>runBurrowAction(`quest:${q.assignmentId}`,()=>claimDailyQuest(q.assignmentId),{silent:true})}
      onSpecialClaim={(id,stage)=>runBurrowAction(`special:${id}:${stage}`,()=>claimSpecialQuest(id,stage),{silent:true})}
      onSpecialGo={id=>id==='games_played'?openBurrow('game_room'):id==='items_collected'?openBurrow('collection'):openBurrow('adventure')}/>;
    if(section==='carrot_shop')return <CarrotShop balance={data.wallet.balance}/>;
    if(section==='shop'||section==='decorate'){
      const decorating=section==='decorate';
      const outfitMode=decorating&&initialCategory==='outfits';
      const preview=draft??sceneSlots;
      const owned=(item:MajorUpdateCatalogItem)=>data.inventory.some(i=>i.item_id===item.stable_id&&(i.owner_id===data.profile.id||(!outfitMode&&i.owner_id===data.partner?.id)));
      const unownedPreview=Object.entries(preview).filter(([slot,item])=>outfitMode?slot==='outfit'&&!owned(item):slot!=='outfit'&&!owned(item)).map(([,item])=>item);
      const categories=outfitMode?['outfits']:decorCategories;
      const effectiveCategory=outfitMode?'outfits':category;
      const items=data.catalog.filter(item=>item.category===effectiveCategory&&(decorating||!!item.price));
      return <>
        {decorating&&<><HomeArtPreview slots={preview} ownerId={data.profile.id}
          photos={data.roomPhotos?.filter(photo=>photo.ownerId===data.profile.id)}
          away={adventureIsAway(adventure,now)}/><View style={s.row}>
          <Action secondary label="Cancel" disabled={busy} onPress={()=>router.back()}/>
          <Action label="Done" disabled={busy||unownedPreview.length>0} onPress={()=>{
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
        <View style={shopStyles.sectionHeading}><Text style={[shopStyles.sectionTitle,!decorating&&shopStyles.lightTitle]}>{categoryName(effectiveCategory)}</Text><Text style={[shopStyles.sectionSubtitle,!decorating&&shopStyles.lightSubtitle]}>{decorating?'Tap an item to see it in your room. Save when it feels right.':'Make your burrow feel like yours.'}</Text></View>
        {decorating&&unownedPreview.length>0&&<Card title="Just a preview" body="Own these items before saving. Cancel restores your saved room.">
          {unownedPreview.map(item=><Action key={item.stable_id} secondary label={item.title} onPress={()=>setSelected(item)}/>)}
        </Card>}
        <View style={s.grid}>{items.map(item=><Pressable key={item.stable_id} accessibilityRole="button" accessibilityLabel={item.title} style={[s.tile,!decorating&&s.shopTile,!decorating&&shopStyles.productTile,preview[item.metadata.slot??'']?.stable_id===item.stable_id&&decorating&&s.selectedTile]} onPress={()=>{
          if(decorating&&item.metadata.slot){setDraft({...preview,[item.metadata.slot]:item});if(!owned(item))setSelected(item);}else setSelected(item);
        }}><CatalogArtwork item={item} sizePx={!decorating?Math.max(66,Math.min(110,Math.floor((Math.min(screenWidth,560)-60)/3)-10)):undefined}/><Text numberOfLines={2} style={[s.tileTitle,!decorating&&s.shopTileTitle]}>{item.title}</Text><Text style={s.price}>{owned(item)?'✓ Owned':item.plus_only&&!data.hasPlus?'✦ PLUS':`🥕 ${item.price??'Adventure find'}`}</Text></Pressable>)}</View>
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
    if(section==='collection'){
      const tab=collectionTab;
      const whose=collectionOwner==='mine'?data.profile.id:data.partner?.id;
      const inventory=data.inventory.filter(i=>i.owner_id===whose);
      const ownedIds=new Set(inventory.map(i=>i.item_id));
      const ownedItems=data.catalog.filter(item=>ownedIds.has(item.stable_id)&&['decor','our_room','outfit'].includes(item.item_type));
      const giftItems=data.catalog.filter(item=>inventory.some(i=>i.item_id===item.stable_id&&['friend_visit','gift','adventure_gift'].includes(i.source)));
      const list=tab==='gifts'?giftItems:ownedItems.filter(item=>collectionItemFilter==='all'||(collectionItemFilter==='furniture'?item.item_type==='decor':collectionItemFilter==='outfits'?item.item_type==='outfit':item.item_type==='our_room'));
      const ownedFriends=data.discoveries.filter(d=>d.user_id===whose&&!!d.interaction_completed_at).length;
      const tileSize=Math.max(52,Math.floor((Math.min(screenWidth,560)-68-(tab==='friends'?16:24))/(tab==='friends'?3:4)));
      return <>
        <Text style={collectionStyles.subtitle}>Everything we’ve found along the way</Text>
        <View style={collectionStyles.board}>
        {!!data.partner&&<View style={collectionStyles.ownerRow}>{(['mine','partner'] as const).map(value=><Pressable accessibilityRole="button" accessibilityState={{selected:collectionOwner===value}} key={value} style={[collectionStyles.owner,collectionOwner===value&&collectionStyles.ownerSelected]} onPress={()=>setCollectionOwner(value)}><Text style={[collectionStyles.ownerText,collectionOwner===value&&collectionStyles.ownerTextSelected]}>{value==='mine'?'My collection':'Partner’s'}</Text></Pressable>)}</View>}
        <View style={collectionStyles.tabs}>{(['items','gifts','friends'] as const).map(value=><Pressable accessibilityRole="button" accessibilityState={{selected:tab===value}} key={value} style={[collectionStyles.tab,tab===value&&collectionStyles.activeTab]} onPress={()=>setCollectionTab(value)}><Text style={[collectionStyles.tabText,tab===value&&collectionStyles.activeTabText]}>{value==='items'?'▣  Items':value==='gifts'?'▧  Gifts':'♣  Friends'}</Text></Pressable>)}</View>
        <View style={collectionStyles.headingRow}><Text style={collectionStyles.heading}>{tab==='items'?'Items':tab==='gifts'?'Gifts':'Friends'}</Text><Text style={collectionStyles.count}>{tab==='items'?ownedItems.length:tab==='gifts'?giftItems.length:ownedFriends} {tab==='friends'?'met':'collected'}</Text></View>
        {tab==='items'&&<View style={collectionStyles.filters}>{(['all','furniture','outfits','rooms'] as const).map(value=><Pressable accessibilityRole="button" accessibilityState={{selected:collectionItemFilter===value}} key={value} style={collectionStyles.filter} onPress={()=>setCollectionItemFilter(value)}><Text style={[collectionStyles.filterText,collectionItemFilter===value&&collectionStyles.activeFilterText]}>{categoryName(value)}</Text>{collectionItemFilter===value&&<View style={collectionStyles.filterUnderline}/>}</Pressable>)}</View>}
        {collectionOwner==='mine'&&data.affectionInbox.length>0&&<Card title="Your person thought of you" body={AFFECTION_TYPES.map(type=>{const count=data.affectionInbox.filter(e=>e.affection_type===type).length;return count?`${AFFECTION_COPY[type].symbol} ${count}`:'';}).filter(Boolean).join('   ')}><Action label="Love received" disabled={busy} onPress={()=>act('read-affection',()=>markAffectionRead(data.affectionInbox.map(e=>e.id)))}/></Card>}
        {collectionOwner==='mine'&&data.gifts.map(gift=><Card key={gift.id} title={data.catalog.find(i=>i.stable_id===gift.item_id)?.title??'A little gift'}><Action label="Open gift" disabled={busy} onPress={()=>act(`gift:${gift.id}`,()=>claimGift(gift.id))}/></Card>)}
        <View style={collectionStyles.grid}>{tab==='friends'?data.friends.map(friend=>{
          const found=data.discoveries.some(d=>d.user_id===whose&&d.friend_id===friend.stable_id&&!!d.interaction_completed_at);const friendArt=burrowFriendArt(friend.name);return <View key={friend.stable_id} style={[collectionStyles.tile,{width:tileSize}]}>{found&&friendArt?<Image source={friendArt} contentFit="contain" style={{width:tileSize-12,height:tileSize-12}}/>:<Text style={collectionStyles.unknown}>?</Text>}<Text numberOfLines={2} style={collectionStyles.tileTitle}>{found?friend.name:'Undiscovered'}</Text></View>;
        }):list.map(item=><Pressable key={item.stable_id} style={[collectionStyles.tile,{width:tileSize}]} accessibilityRole="button" accessibilityLabel={`View ${item.title}`} onPress={()=>setSelected(item)}><CatalogArtwork item={item} sizePx={tileSize-12}/><Text numberOfLines={2} style={collectionStyles.tileTitle}>{item.title}</Text><Text style={collectionStyles.owned}>✓ Owned</Text></Pressable>)}
          {((tab==='items'&&collectionItemFilter==='all')||tab==='gifts')&&data.catalog.filter(item=>!ownedIds.has(item.stable_id)&&(tab==='gifts'?item.item_type==='souvenir':['decor','our_room','outfit'].includes(item.item_type))).slice(0,tab==='gifts'?8:4).map(item=><View key={item.stable_id} style={[collectionStyles.tile,collectionStyles.unknownTile,{width:tileSize}]} accessibilityLabel="Undiscovered item"><Text style={collectionStyles.unknown}>?</Text><Text style={collectionStyles.unknownLabel}>Undiscovered</Text></View>)}
        </View>
        {tab!=='friends'&&!list.length&&<Text style={collectionStyles.empty}>Your story is just beginning. Finds and purchases will appear here.</Text>}
        </View>
        <Pressable accessibilityRole="button" onPress={()=>tab==='items'?openBurrow('decorate'):tab==='gifts'?router.navigate('/(main)/(tabs)/shop' as Href):openBurrow('friends_room')} style={collectionStyles.footerButton}><Text style={collectionStyles.footerText}>{tab==='items'?'Decorate My Burrow':tab==='gifts'?'Find a Gift':'Visit Friends’ Room'}</Text></Pressable>
      </>;
    }
    if(section==='moments')return <BurrowHistory data={data} kind="moments" busy={busy}/>;
    if(section==='affection')return loveSent?<>
      <AffectionDelivery sender={data.profile} recipient={data.partner} sent/>
      <Card title="Love sent" body="A little warmth is waiting for your person."><Action label="Done" onPress={()=>router.back()}/></Card>
    </>:affection?<>
      <AffectionDelivery sender={data.profile} recipient={data.partner} sent={false}/>
      <AffectionGesture key={affection} type={affection} disabled={busy} onComplete={metrics=>{if(!data.partner){askToPair('Connect with your person to send them a little love.');return;}setLoveSent(true);void runBurrowAction(`affection:${affection}`,key=>completeAffection(affection,metrics,key),{silent:true}).then(ok=>{if(!ok)setLoveSent(false);});}}/>
      <Action secondary label="Choose a different affection" disabled={busy} onPress={()=>setAffection(null)}/>
    </>:<>
      <Text style={affectionStyles.title}>Send a little love</Text>
      <Text style={affectionStyles.subtitle}>{data.partner?`What do you want to send to ${data.partner.display_name??'your person'}?`:'Choose a gesture. Connect with your person when you’re ready to send it.'}</Text>
      {cooldown>0&&!!data.partner?<Card title="A little pause between gestures" body={`Your next free gesture is ready in ${countdown(cooldown)}.`}><Action label="Explore Plus · no gesture cooldown" onPress={()=>router.push('/(main)/(modals)/subscription-paywall' as Href)}/></Card>:null}
      <View style={s.grid}>{(['cuddle','kiss','miss_you','hug','spicy','gratitude'] as const).map(type=><Pressable key={type} style={s.tile} accessibilityRole="button" accessibilityLabel={AFFECTION_COPY[type].label} onPress={()=>!data.partner?askToPair('Connect with your person to send them a little love.'):cooldown>0?Alert.alert('A little pause',`Your next free gesture is ready in ${countdown(cooldown)}.`):setAffection(type)}><Image source={BURROW_AFFECTION_ICONS[type]} contentFit="contain" style={s.affectionIcon}/><Text style={s.tileTitle}>{AFFECTION_COPY[type].label}</Text></Pressable>)}</View>
    </>;
    if(section==='adventure'){
      const result=data.adventureResult;
      const friend=result?.metadata?.friendSnapshot;
      const trail=adventure?adventureTrail(adventure.started_at,adventure.ends_at,now):null;
      return <>
        {adventure?.status==='in_progress'?<View style={adventureStyles.diggingHero}><BunnyActor standalone outfit={roomSlots(data,data.profile.id).outfit} pose="digging" standaloneSize={{width:175,height:215}}/></View>:<View style={{height:Math.min(300,screenWidth*.7)}}/>}
        {feedback?<Card title="A little story to keep" body={feedback}><Action label="Back to home" onPress={()=>router.back()}/></Card>:adventure?adventure.status==='in_progress'?<View style={adventureStyles.progressPage}>
          {data.hasPlus&&<Text style={adventureStyles.plusBadge}>PLUS</Text>}
          <Text style={adventureStyles.progressTitle}>Your adventure is ongoing</Text>
          <View style={adventureStyles.progressCard}>
            <View style={adventureStyles.progressTop}><Text style={adventureStyles.progressHeading}>Digging…</Text><Text style={adventureStyles.progressTime}>Back in {countdown(remaining)}</Text></View>
            <View style={adventureStyles.progressTrack}><View style={[adventureStyles.progressFill,{width:`${Math.min(100,Math.max(0,100*(1-remaining/(new Date(adventure.ends_at).getTime()-new Date(adventure.started_at).getTime()))))}%`}]}/></View>
            <View style={adventureStyles.progressTop}><Text style={adventureStyles.progressDistance}>{trail?.meters??0} m dug</Text><Text style={adventureStyles.progressTime}>Next: {trail?.nextMeters??'treasure'} m</Text></View>
          </View>
          <View style={adventureStyles.logCard}><Text style={adventureStyles.progressHeading}>Adventure Logs</Text>
            {(trail?.logs??[]).length?trail!.logs.map(log=><Text key={log.meters} style={adventureStyles.logText}>• {log.meters} m · {log.copy}</Text>)
              :<Text style={adventureStyles.logText}>Your bunny has just begun the journey.</Text>}
            <Text style={adventureStyles.logHint}>You can leave. We’ll save your place.</Text>
            {remaining===0?<Action label="Your bunny is back · Open" disabled={busy} onPress={()=>act(`settle:${adventure.id}`,()=>settleAdventure(adventure.id))}/>
              :<Action label="Back to Home" onPress={()=>router.navigate('/(main)/(tabs)' as Href)}/>}
          </View>
        </View>:adventure.status==='interaction_required'?<AdventureFriendCard data={data} busy={busy} onComplete={setFeedback}/>:result?.result_type==='item'?<AdventureTreasure key={adventure.id} title={result.metadata?.itemSnapshot?.title??'A little discovery'} busy={busy} onClaim={()=>act(`claim:${adventure.id}`,()=>claimAdventureResult(adventure.id))}/>:<Card title={result?.result_type==='quiet'?'A quiet journey home':result?.result_type==='friend'?`You met ${friend?.name??'a new friend'}!`:'A treasure chest!'}
          body={result?.result_type==='quiet'?'You’ve found every available treasure on this trail. Today’s adventure still counts.':result?.item_id?result.metadata?.itemSnapshot?.title:'A little discovery is waiting for you.'}>
          <Action label={result?.result_type==='quiet'?'Welcome home':result?.result_type==='friend'?'Say hello':'Claim item'} disabled={busy} onPress={()=>act(`claim:${adventure.id}`,()=>claimAdventureResult(adventure.id))}/>
        </Card>:data.dailyAdventureUsed?<Card title="Your bunny is home for today" body="Another adventure will be ready after your local midnight."/>:<View style={adventureStyles.entry}>
          <Text style={adventureStyles.entryTitle}>Start Today’s Adventure</Text>
          <Text style={adventureStyles.entrySubtitle}>Your bunny’s waiting on today’s story</Text>
          {data.readyRecordId?<Pressable accessibilityRole="button" disabled={busy} onPress={()=>beginAdventure(data.readyRecordId!)} style={adventureStyles.choice}>
            <View style={{flex:1}}><Text style={adventureStyles.choiceTitle}>Your story is ready</Text><Text style={adventureStyles.choiceText}>Start exploring · {data.hasPlus?'2':'8'} hours</Text></View><Text style={adventureStyles.choiceIcon}>➜</Text>
          </Pressable>:<><Pressable accessibilityRole="button" onPress={()=>router.push('/(main)/reflect-typing' as Href)} style={adventureStyles.choice}>
            <View style={{flex:1}}><Text style={adventureStyles.choiceTitle}>Write Freely</Text><Text style={adventureStyles.choiceText}>Write anything you feel worth remembering.</Text></View><Text style={adventureStyles.choiceIcon}>✎</Text>
          </Pressable><Pressable accessibilityRole="button" onPress={()=>router.push('/(main)/reflect-guided' as Href)} style={adventureStyles.choice}>
            <View style={{flex:1}}><Text style={adventureStyles.choiceTitle}>Tap your day</Text><Text style={adventureStyles.choiceText}>Select little things that tell your day.</Text></View><Text style={adventureStyles.choiceIcon}>♡</Text>
          </Pressable></>}
          <Text style={adventureStyles.note}>What you share will shape what the adventure looks like, what you find, and who you meet.</Text>
        </View>}
      </>;
    }
    if(section==='memories_room')return <BurrowHistory data={data} kind="memories" busy={busy}/>;
    if(section==='self_care_room')return <>{[['New Lens','new-lens'],['True North','true-north'],['Small Wins','quiet-wins']].map(([label,path])=><Card key={path} title={label}><Action label="Take a little time" onPress={()=>router.push(`/(main)/${path}` as Href)}/></Card>)}</>;
    if(section==='game_room')return <Card title="Game Room" body="Choose a game to discover how well you know each other."><Action label="Open games" onPress={()=>router.replace('/(main)/game-room' as Href)}/></Card>;
    return <Card title="Our Burrows" body="Choose a room to spend a little time together."><Action label="Explore rooms" onPress={()=>router.navigate('/(main)/(tabs)/burrow' as Href)}/></Card>;
  }
  return <LinearGradient {...(!isTab?swipeBack:{})} colors={section==='affection'?['#E88791','#EDABA2']:['#793D29','#B85B35','#D6834B']} style={s.root}>
    {section!=='home'&&section!=='burrow'&&<Image source={background} contentFit="cover" contentPosition="top" style={StyleSheet.absoluteFillObject} pointerEvents="none"/>}
    {section==='moments'&&<MomentsHearts/>}
    <View style={[s.frame,section==='home'||section==='burrow'?s.homeFrame:{paddingTop:insets.top}]}>
      {section==='home'?data?<View style={s.homeCanvas} onLayout={()=>markHomeEntryAsset('burrow-layout',attempt)}><HomeArtScene
        balance={data.wallet.balance} slots={sceneSlots} photos={data.roomPhotos} ownerId={data.profile.id}
        away={adventureIsAway(adventure,now)} busy={busy}
        onToyInteract={()=>openHomeInteraction('toy')} onToyPhoto={()=>openHomeInteraction('toy')}
        onMenu={()=>router.push('/(main)/(modals)/me' as Href)} onCarrots={()=>openBurrow('carrot_shop')}
        onAffection={()=>data.unread.affection>0?setInboxOpen(true):openBurrow('affection')} unreadAffection={data.unread.affection} onAdventure={()=>openBurrow('adventure')}
        onLetter={()=>openHomeInteraction('letter')}
        onBurrows={()=>openBurrow('burrow')}
        onDecorate={()=>openBurrow('decorate')} onSlot={homeSlot}/></View>
        :<View style={s.loading}>{loading?<ActivityIndicator color="#FFF1DB"/>:<Text style={s.creamCopy}>Your burrow could not load. Pull down on another tab to retry.</Text>}</View>
      :<>{section!=='burrow'&&section!=='moments'&&section!=='quests'&&<View style={[s.header,{paddingVertical:12},section==='shop'&&shopStyles.topHeader]}>{!isTab&&<BurrowBackButton onPress={()=>section==='shop'?openBurrow('home'):router.back()}/>}<Text style={[s.heading,section==='shop'&&shopStyles.topTitle]}>{titles[section]}</Text>{data&&<Pressable accessibilityRole="button" accessibilityLabel={`Carrot Shop. Balance ${data.wallet.balance}`} disabled={section==='carrot_shop'} onPress={()=>openBurrow('carrot_shop')} style={[s.wallet,section==='shop'&&shopStyles.topWallet]}><Text style={s.walletText}>🥕 {data.wallet.balance.toLocaleString()}{section==='carrot_shop'?'':' ＋'}</Text></Pressable>}</View>}
      {!data?<View style={s.loading}>{loading?<ActivityIndicator color="#FFF1DB"/>:<Text style={s.creamCopy}>Your burrow needs a connection to load.</Text>}</View>:<ScrollView key={section} style={{flex:1}} onLayout={()=>markHomeEntryAsset('burrow-layout',attempt)} contentContainerStyle={section==='burrow'?s.mapContent:[s.content,{paddingBottom:isTab?24:insets.bottom+24}]} bounces={section!=='burrow'&&section!=='carrot_shop'} alwaysBounceVertical={false} overScrollMode="never" refreshControl={section==='burrow'||section==='carrot_shop'?undefined:<RefreshControl refreshing={pullRefreshing} onRefresh={()=>{setPullRefreshing(true);void refreshBurrow().finally(()=>setPullRefreshing(false));}} tintColor="#FFF1DB"/>}>{content()}</ScrollView>}</>}
      {error&&<View style={[s.error,section==='home'&&s.homeError]} accessibilityRole="alert"><Text style={s.body}>{burrowErrorMessage(error)}</Text><Action secondary label="Refresh" disabled={busy||loading} onPress={()=>void refreshBurrow()}/></View>}
      {busy&&<View style={s.busy} pointerEvents="none"><ActivityIndicator color="#FFF"/><Text style={s.creamCopy}>Saving your little moment…</Text></View>}
      {section==='burrow'&&<BurrowBackButton onPress={()=>openBurrow('home')} style={{position:'absolute',top:insets.top+12,left:18,zIndex:10}}/>}
    </View>
    <Modal visible={toyOpen&&!!data} transparent presentationStyle="overFullScreen" animationType="fade" onRequestClose={()=>setToyOpen(false)}>
      <View style={[s.scrim,{justifyContent:'center',paddingHorizontal:20}]}><View style={[s.sheet,s.toySheet]} accessibilityViewIsModal>
        <Text accessibilityRole="header" style={s.cardTitle}>A little love for your toy</Text>
        <Text style={s.body}>Tap, press or gently drag the doll. It bounces back and sends up little hearts.</Text>
        {(()=>{const asset=burrowArtForItem(sceneSlots.couple_doll,'couple_dolls');if(!asset)return <Text style={s.itemIcon}>🧸</Text>;
          const [left,top,right,bottom]=asset.bounds;const ratio=Math.min(214/(right-left),238/(bottom-top));
          return <InteractiveDoll asset={asset} photo={data?.roomPhotos?.find(photo=>photo.ownerId===data.profile.id&&photo.kind==='doll')}
            disabled={busy} onInteract={recordToyInteraction}
            onEditPhoto={openToyPhoto} style={s.toyStage}
            artStyle={{position:'absolute',left:(240-(right-left)*ratio)/2-left*ratio,top:(250-(bottom-top)*ratio)/2-top*ratio,width:asset.width*ratio,height:asset.height*ratio}}/>;})()}
        <Action label="Add or change face photo" onPress={openToyPhoto}/>
        <Action secondary label="Done" onPress={()=>setToyOpen(false)}/>
      </View></View>
    </Modal>
    {frameSheetOpen&&data&&<PhotoFrameSheet photo={data.roomPhotos?.find(photo=>photo.ownerId===data.profile.id&&photo.kind==='frame')}
      onClose={()=>setFrameSheetOpen(false)} onChoose={source=>{setFrameSheetOpen(false);setTimeout(()=>{setPhotoEditorSource(source);setPhotoEditor('frame');},320);}}
      onRemove={async()=>{const photo=data.roomPhotos?.find(item=>item.ownerId===data.profile.id&&item.kind==='frame');if(!photo)return;await deleteRoomFramePhoto(photo.id,data.profile.id);await refreshBurrow();}}/>}
    {photoEditor&&data&&owner&&<RoomPhotoEditor data={data} ownerId={photoEditor==='doll'?data.profile.id:owner} kind={photoEditor} initialSource={photoEditorSource} onClose={()=>{setPhotoEditor(null);setPhotoEditorSource(undefined);}}/>}
    {musicOpen&&data&&<BurrowMusicPicker data={data} onClose={()=>setMusicOpen(false)}/>}
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
    <Modal visible={!!selected} transparent animationType="slide" onRequestClose={()=>setSelected(null)}>
      <View style={s.scrim}><ScrollView style={[s.sheet,{maxHeight:'88%'}]} contentContainerStyle={{gap:14,paddingBottom:30}}>{selected&&data&&<>
        <CatalogArtwork item={selected} large/><Text style={s.cardTitle}>{selected.title}</Text><Text style={s.body}>{selected.description}</Text>
        <Text style={s.body}>More {categoryName(selected.category)} choices</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:10}}>{data.catalog.filter(item=>item.category===selected.category&&item.stable_id!==selected.stable_id&&!!item.price).slice(0,8).map(item=><Pressable key={item.stable_id} accessibilityRole="button" accessibilityLabel={`Preview ${item.title}`} onPress={()=>setSelected(item)} style={{width:108,padding:8,borderRadius:14,backgroundColor:'#F7E5CC',alignItems:'center'}}><CatalogArtwork item={item}/><Text numberOfLines={2} style={s.tileTitle}>{item.title}</Text></Pressable>)}</ScrollView>
        {selected.price!=null&&selected.price>0&&!data.inventory.some(i=>i.owner_id===data.profile.id&&i.item_id===selected.stable_id)&&<Action label={selected.plus_only&&!data.hasPlus?'Plus required':`Buy for 🥕 ${selected.price}`} disabled={busy} onPress={()=>buy(selected)}/>}
        {!!selected.price&&selected.tradable&&!!data.partner&&<Action secondary label={`Gift my partner · 🥕 ${selected.price}`} disabled={busy||data.inventory.some(i=>i.owner_id===data.partner?.id&&i.item_id===selected.stable_id)} onPress={()=>buy(selected,true)}/>}
        <Action secondary label="Close" disabled={busy} onPress={()=>setSelected(null)}/>
      </>}</ScrollView></View>
    </Modal>
    <Modal visible={!!pairPrompt} transparent animationType="fade" onRequestClose={()=>setPairPrompt(null)}>
      <View style={s.scrim}><View style={s.sheet} accessibilityViewIsModal>
        <Text accessibilityRole="header" style={s.cardTitle}>Connect with your person</Text>
        <Text style={s.body}>{pairPrompt}</Text>
        <Action label="Connect now" onPress={()=>{setPairPrompt(null);router.push('/(main)/friend-add');}}/>
        <Action secondary label="Not now" onPress={()=>setPairPrompt(null)}/>
      </View></View>
    </Modal>
  </LinearGradient>;
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

const collectionStyles=StyleSheet.create({
  subtitle:{color:'#FCE6D0',fontSize:15,marginTop:-12,marginBottom:8},
  board:{backgroundColor:'#FFF4E3',borderRadius:25,paddingHorizontal:16,paddingTop:22,paddingBottom:30,gap:16,shadowColor:'#2B140B',shadowOffset:{width:0,height:6},shadowOpacity:.3,shadowRadius:0,elevation:5},
  ownerRow:{flexDirection:'row',alignSelf:'center',padding:3,borderRadius:16,backgroundColor:'#EBD4B8',gap:3},
  owner:{paddingHorizontal:17,paddingVertical:9,borderRadius:14},
  ownerSelected:{backgroundColor:'#FFF9EF'},
  ownerText:{color:'#75543D',fontSize:13,fontWeight:'700'},
  ownerTextSelected:{color:'#A44929'},
  tabs:{flexDirection:'row',borderWidth:1,borderColor:'#E9CFAC',borderRadius:20,padding:4,gap:3},
  tab:{flex:1,minHeight:50,justifyContent:'center',alignItems:'center',borderRadius:16},
  activeTab:{backgroundColor:'#BD5F38'},
  tabText:{color:'#533221',fontWeight:'800',fontSize:15},
  activeTabText:{color:'#FFF9EF'},
  headingRow:{flexDirection:'row',alignItems:'baseline',justifyContent:'space-between'},
  heading:{fontSize:27,fontWeight:'900',color:'#3D2118'},
  count:{fontSize:13,color:'#88654D'},
  filters:{flexDirection:'row',justifyContent:'space-between',gap:2},
  filter:{flex:1,alignItems:'center',paddingVertical:9,gap:6},
  filterText:{fontSize:12,color:'#805F4A',fontWeight:'600'},
  activeFilterText:{color:'#BF572B',fontWeight:'800'},
  filterUnderline:{height:3,width:'72%',backgroundColor:'#C5592B',borderRadius:3},
  grid:{flexDirection:'row',flexWrap:'wrap',gap:8},
  tile:{minHeight:145,backgroundColor:'#FFF9EE',borderRadius:15,borderWidth:1,borderColor:'#F2E3CA',alignItems:'center',padding:5,gap:3,justifyContent:'flex-start'},
  tileTitle:{color:'#3D251A',fontSize:11,lineHeight:14,fontWeight:'800',textAlign:'center',minHeight:28},
  owned:{fontSize:10,fontWeight:'700',color:'#2F8D72'},
  unknownTile:{backgroundColor:'#F3E8D9'},
  unknown:{height:87,textAlignVertical:'center',fontSize:42,color:'#BCA28B',fontWeight:'900'},
  unknownLabel:{fontSize:9,color:'#8A6F5C',textAlign:'center'},
  empty:{color:'#7B6049',textAlign:'center',lineHeight:21},
  footerButton:{backgroundColor:'#FFC653',borderRadius:17,minHeight:57,alignItems:'center',justifyContent:'center',marginHorizontal:16,shadowColor:'#402217',shadowOpacity:.25,shadowOffset:{width:0,height:4},shadowRadius:0,elevation:3},
  footerText:{color:'#542E1C',fontSize:17,fontWeight:'800'},
});

const adventureStyles=StyleSheet.create({
  diggingHero:{height:230,justifyContent:'center',backgroundColor:'#2A1109AA',borderRadius:24,marginTop:12},
  progressPage:{gap:16,paddingBottom:30},
  plusBadge:{alignSelf:'center',backgroundColor:'#F4BA5C',color:'#3C1D0F',fontWeight:'900',fontSize:15,overflow:'hidden',paddingHorizontal:22,paddingVertical:6,borderRadius:20},
  progressTitle:{color:'#FFF8E9',fontSize:23,fontWeight:'800',textAlign:'center'},
  progressCard:{backgroundColor:'#FFF9EF',borderRadius:24,padding:20,gap:17},
  progressTop:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:10},
  progressHeading:{fontSize:22,fontWeight:'800',color:'#553521'},
  progressTime:{fontSize:14,color:'#664330'},
  progressTrack:{height:10,borderRadius:7,backgroundColor:'#E8DBC9',overflow:'hidden'},
  progressFill:{height:'100%',backgroundColor:'#CC7650'},
  progressDistance:{fontSize:19,color:'#553521',fontWeight:'800'},
  logCard:{backgroundColor:'#FFF9EF',borderRadius:24,padding:22,gap:14},
  logText:{fontSize:15,lineHeight:23,color:'#74533E'},
  logHint:{fontSize:13,color:'#987761',textAlign:'center'},
  entry:{alignItems:'center',gap:12,paddingBottom:26},
  entryTitle:{fontSize:25,fontWeight:'900',color:'#FFF9EB',textAlign:'center'},
  entrySubtitle:{fontSize:15,color:'#FFF2DF',textAlign:'center',marginBottom:17},
  choice:{width:'100%',minHeight:78,backgroundColor:'#FFF6E8',borderRadius:21,paddingHorizontal:20,paddingVertical:14,flexDirection:'row',alignItems:'center',gap:12,shadowColor:'#2C150D',shadowOffset:{width:0,height:5},shadowOpacity:.5,shadowRadius:0,elevation:5},
  choiceTitle:{fontSize:19,fontWeight:'800',color:'#402519'},
  choiceText:{fontSize:14,lineHeight:20,color:'#694932'},
  choiceIcon:{fontSize:29,fontWeight:'800',color:'#B46E48'},
  note:{marginTop:18,fontSize:13,lineHeight:19,color:'#FFF3E2',textAlign:'center'},
});
