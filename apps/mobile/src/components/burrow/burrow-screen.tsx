import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { AFFECTION_TYPES, BURROW_DECOR_SHOP_CATEGORIES, type AffectionType } from '@novame/domain';
import { affectionCooldownRemainingMs } from '@novame/engine';
import {
  claimAdventureResult, claimDailyQuest, claimSpecialQuest, claimGift, completeAffection,
  deleteMemoryRoomEntry, interactBurrowToy, saveBunnyOutfit, saveMemoryRoomEntry, setRoomSleep,
  markAffectionRead, purchaseCatalogItem, refillRoomNeed, saveRoomLoadout, settleAdventure,
  startAdventure, visitPartnerRoom, type MajorUpdateBootstrap, type MajorUpdateCatalogItem,
} from '@/lib/app-major-update-api';
import { burrowClock, burrowErrorMessage, refreshBurrow, runBurrowAction, useBurrow } from '@/lib/burrow-store';
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
import { haptics } from '@/lib/haptics';

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
  router.push({pathname:'/(main)/burrow-detail',params:{section,...extra}} as Href);
}
const iconFor=(item:MajorUpdateCatalogItem)=>({windows:'🪟',lamps:'💡',vases:'🌼',decor:'🪴',cushions:'🛏️',tables:'🪵',rugs:'🧶',cabinets:'🗄️',posters:'🍃',music_players:'📻',frames:'🖼️',couple_dolls:'🧸',outfits:'🧥',our_room:'💕',gifts:'🎁',rooms:'🏡',music:'🎵'}[item.category]??'✨');
function CatalogArtwork({item,large=false,compact=false}:{item:MajorUpdateCatalogItem;large?:boolean;compact?:boolean}){
  const asset=burrowArtForItem(item);
  if(!asset)return <Text style={s.itemIcon}>{iconFor(item)}</Text>;
  const size=large?160:compact?74:110;
  const [left,top,right,bottom]=asset.bounds;
  const ratio=Math.min(size/(right-left),size/(bottom-top));
  return <View style={large?s.itemArtLarge:compact?s.itemArtCompact:s.itemArt} accessibilityLabel={item.title}>
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

export function BurrowScreen({section,roomType='home',initialCategory='windows',asTab=false,homeIntent}:{section:BurrowSection;roomType?:'home'|'our';initialCategory?:string;asTab?:boolean;homeIntent?:string}){
  const {data,loading,error,busy,receivedAt}=useBurrow();
  const {attempt}=useHomeEntry();
  const insets=useSafeAreaInsets();
  const [clock,setClock]=useState(burrowClock());
  const [category,setCategory]=useState<string>(initialCategory);
  const [collectionTab,setCollectionTab]=useState('furniture');
  const [collectionOwner,setCollectionOwner]=useState<'mine'|'partner'>('mine');
  const [selected,setSelected]=useState<MajorUpdateCatalogItem|null>(null);
  const [affection,setAffection]=useState<AffectionType|null>(null);
  const [loveSent,setLoveSent]=useState(false);
  const [draft,setDraft]=useState<Record<string,MajorUpdateCatalogItem>|null>(null);
  const [feedback,setFeedback]=useState<string|null>(null);
  const [editingMemory,setEditingMemory]=useState<string|null>(null);
  const [photoEditor,setPhotoEditor]=useState<'frame'|'doll'|null>(null);
  const [musicOpen,setMusicOpen]=useState(false);
  const [inboxOpen,setInboxOpen]=useState(false);
  const [letterOpen,setLetterOpen]=useState(false);
  const [letterText,setLetterText]=useState('');
  const [careKind,setCareKind]=useState<'food'|'water'|null>(null);
  const [toyPulse,setToyPulse]=useState(0);
  const toyRecordedDay=useRef<string|null>(null);
  const [pairPrompt,setPairPrompt]=useState<string|null>(null);
  const modalOpen=!!photoEditor||musicOpen||!!selected||inboxOpen||letterOpen||!!careKind||!!pairPrompt;
  useEffect(()=>{if(modalOpen)return registerOverlay({});},[modalOpen]);
  const isTab=asTab||['home','burrow','quests','shop','moments'].includes(section);
  useEffect(()=>{const timer=setInterval(()=>setClock(burrowClock()),1000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{if(data)markHomeEntryAsset('burrow-data',attempt);},[data,attempt]);
  useEffect(()=>{if(section==='partner_room'&&data?.partner)void runBurrowAction('visit-partner',()=>visitPartnerRoom());},[section,data?.partner?.id]);
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
  const owner=section==='partner_room'?data?.partner?.id:data?.profile.id;
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
    if(!data.partner){askToPair('Connect with your person to care for your shared burrow.');return;}
    if(homeIntent==='water'||homeIntent==='food'){
      if(roomNeedDisplay(data,false,now)[homeIntent]>=100){
        Alert.alert(homeIntent==='food'?'Your bunny is full':'Your flowers are happy',
          homeIntent==='food'?'Come back when your bunny is hungry again.':'They have enough water for now.');
      }else setCareKind(homeIntent);
    }
    if(homeIntent==='toy')homeSlot('couple_doll');
    // This one-shot intent is cleared before opening a sheet, so tab revisits do
    // not unexpectedly reopen care after the user dismissed it.
  },[section,homeIntent,data?.profile.id,data?.partner?.id]);
  const act=(name:string,fn:(key:string)=>Promise<unknown>)=>{
    if(!data?.partner){askToPair();return;}
    void runBurrowAction(name,fn);
  };
  function recordToyInteraction(){
    if(!data?.partner){askToPair('Connect with your person to play with the dolls together.');return;}
    const scope=`${data.profile.id}:${data.partner.id}:${data.localDate}`;
    if(toyRecordedDay.current===scope)return;
    toyRecordedDay.current=scope;
    void runBurrowAction(`toy:${scope}`,key=>interactBurrowToy(key)).then(ok=>{if(!ok&&toyRecordedDay.current===scope)toyRecordedDay.current=null;});
  }
  function buy(item:MajorUpdateCatalogItem,gift=false){
    if(!data)return;
    if(!data.partner){askToPair(gift?'Connect with your person to send gifts.':'Connect with your person before buying for your burrow.');return;}
    if(item.plus_only&&!data.hasPlus){setSelected(null);router.push('/(main)/(modals)/subscription-paywall' as Href);return;}
    if((item.price??0)>data.wallet.balance){setSelected(null);openBurrow('carrot_shop');return;}
    const recipient=gift?data.partner?.id:data.profile.id;
    if(!recipient)return;
    Alert.alert(gift?'Send this gift?':'Make it yours?',`${item.title} · ${item.price} carrots`,[
      {text:'Cancel',style:'cancel'},
      {text:gift?'Send gift':'Buy',onPress:()=>{void runBurrowAction(`buy:${item.stable_id}:${recipient}`,key=>purchaseCatalogItem(item.stable_id,recipient,key)).then(ok=>{if(ok)setSelected(null);});}},
    ]);
  }
  function questGo(id:string){
    if(!data?.partner){askToPair('Connect with your person to start shared quests.');return;}
    if(id==='send_affection')openBurrow('affection');
    else if(id==='play_game')openBurrow('game_room');
    else if(['water_partner_flower','feed_partner_bunny','interact_with_toy'].includes(id))router.navigate({pathname:'/(main)/(tabs)',params:{care:id==='water_partner_flower'?'water':id==='feed_partner_bunny'?'food':'toy'}} as Href);
    else if(id==='visit_partner_room')openBurrow('friends_room');
    else openBurrow('adventure');
  }
  function homeSlot(slot:string){
    if(!data?.partner){askToPair('Connect with your person to interact with the burrow.');return;}
    if(slot==='bunny'){
      if(adventureIsAway(adventure,now)){openBurrow('adventure');return;}
      if(roomNeedDisplay(data,false,now).food<100)setCareKind('food');
      else Alert.alert('Your bunny is full','Come back when your bunny is hungry again.');
    }
    else if(slot==='vase')roomNeedDisplay(data,false,now).water<100?setCareKind('water'):Alert.alert('Your flowers are happy','They have enough water for now.');
    else if(slot==='frame')setPhotoEditor('frame');
    else if(slot==='couple_doll'){setToyPulse(value=>value+1);recordToyInteraction();}
    else if(slot==='music_player')setMusicOpen(true);
  }
  function content(){
    if(!data)return null;
    if(!data.partner&&section==='partner_room')return <Card title="Your person’s room" body="You can explore the burrow now. Connect when you’re ready to visit and care for your person’s room."><Action label="Visit your person" onPress={()=>askToPair('Connect with your person to visit their room.')}/></Card>;
    if(!data.partner&&section==='our_room')return <><RoomScene slots={sceneSlots} shared={false}/><Card title="A room for two" body="This room is ready to explore. Connect with your person to rest and decorate together."><Action label="Decorate together" onPress={()=>askToPair('Connect with your person to decorate your shared room.')}/></Card></>;
    if(section==='home'||section==='partner_room'||section==='our_room'){
      const needs=roomNeedDisplay(data,section==='partner_room',now);
      const mineOutfit=roomSlots(data,data.profile.id).outfit;
      const partnerOutfit=data.partner?roomSlots(data,data.partner.id).outfit:undefined;
      return <>
        <RoomScene slots={section==='our_room'?{...sceneSlots,outfit:mineOutfit}:sceneSlots} partnerOutfit={partnerOutfit}
          busy={busy} canFeed={needs.food<100} away={section!=='our_room'&&adventureIsAway(section==='partner_room'?data.partnerAdventure:adventure,now)} shared={section==='our_room'}
          photos={data.roomPhotos?.filter(photo=>photo.ownerId===owner)}
          sleeping={{mine:data.sharedRoom.mySleeping,partner:data.sharedRoom.partnerSleeping}} onSlot={slot=>{
          if(!data.partner){askToPair('Connect with your person to interact with the burrow.');return;}
          if(slot==='bed')act(`sleep:${!data.sharedRoom.mySleeping}`,key=>setRoomSleep(!data.sharedRoom.mySleeping,key));
          else if(slot==='bunny'&&owner)act(`food:${owner}`,key=>refillRoomNeed(owner,'food',key));
          else if(slot==='vase'&&owner)act(`water:${owner}`,key=>refillRoomNeed(owner,'water',key));
          else if(slot==='frame')setPhotoEditor('frame');
          else if(slot==='couple_doll')recordToyInteraction();
          else if(slot==='doll_photo')setPhotoEditor('doll');
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
          <Action secondary label="Music · choose a tune" onPress={()=>data.partner?setMusicOpen(true):askToPair('Connect with your person to choose your room’s music.')}/>
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
    if(section==='quests')return <>
      <Text style={s.creamCopy}>Three little steps for {data.localDate}.</Text>
      {!data.partner&&<Card title="Daily Quests" body="Explore your quests now. Connect with your person when you want to start or collect rewards.">{['Record a little of your day','Send your person affection','Water your person’s flowers'].map(label=><Action key={label} secondary label={label} onPress={()=>askToPair('Connect with your person to start shared quests.')}/>)}</Card>}
      {data.quests.quests.map(q=><Card key={q.assignmentId} title={questNames[q.questId]??q.questId} body={`${Math.min(q.progress,q.target)} / ${q.target} · +10 carrots`}>
        {q.questId in BURROW_QUEST_ICONS&&<Image source={BURROW_QUEST_ICONS[q.questId as keyof typeof BURROW_QUEST_ICONS]} contentFit="contain" style={s.questIcon}/ >}
        <Action label={q.claimedAt?'Collected ✓':q.completedAt?'Collect reward':'Let’s go'} disabled={busy||!!q.claimedAt} onPress={()=>q.completedAt?act(`quest:${q.assignmentId}`,()=>claimDailyQuest(q.assignmentId)):questGo(q.questId)}/>
      </Card>)}
      <Text style={s.heading}>Special Quests</Text>
      {!data.partner&&<Card title="More to discover" body="Collect items, meet friends, and make memories together after connecting."><Action secondary label="See shared quests" onPress={()=>askToPair('Connect with your person to take on shared quests.')}/></Card>}
      {data.specialQuests.map(q=><Card key={q.questId} title={categoryName(q.questId)} body={`Stage ${q.stage} · ${q.progress} / ${q.target} · +15 carrots`}>{q.questId in BURROW_QUEST_ICONS&&<Image source={BURROW_QUEST_ICONS[q.questId as keyof typeof BURROW_QUEST_ICONS]} contentFit="contain" style={s.questIcon}/>}<Action label={q.progress>=q.target?'Collect reward':'Keep exploring'} disabled={busy||q.progress<q.target} onPress={()=>act(`special:${q.questId}:${q.stage}`,()=>claimSpecialQuest(q.questId,q.stage))}/></Card>)}
      <Text style={s.creamCopy}>Tasks refresh at your local midnight. A reward is collected only once.</Text>
    </>;
    if(section==='carrot_shop')return <><CarrotShop balance={data.wallet.balance}/><Action secondary label="Back" onPress={()=>router.back()}/></>;
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
          <Action label="Done" disabled={busy||unownedPreview.length>0} onPress={()=>{if(!data.partner){askToPair('Connect with your person to save your room design.');return;}const action=outfitMode?()=>saveBunnyOutfit(preview.outfit.stable_id):()=>saveRoomLoadout('home',Object.fromEntries(Object.entries(preview).filter(([slot])=>slot!=='outfit').map(([slot,item])=>[slot,item.stable_id])));if(outfitMode&&!preview.outfit){Alert.alert('Choose an outfit','Pick something for your bunny first.');return;}void runBurrowAction(outfitMode?`outfit:${preview.outfit.stable_id}`:'shared-loadout',action).then(ok=>{if(ok)router.back();});}}/>
        </View><Action secondary label="Reset preview" onPress={()=>{
          const defaults:Record<string,MajorUpdateCatalogItem>={...preview};data.catalog.filter(item=>item.metadata.starter&&item.metadata.slot&&(outfitMode?item.item_type==='outfit':item.item_type==='decor')).forEach(item=>{defaults[item.metadata.slot!]=item;});setDraft(defaults);
        }}/></>}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>{categories.map(cat=>{const art=burrowArtFor(cat);return <Pressable accessibilityRole="button" key={cat} onPress={()=>setCategory(cat)} style={[s.chip,effectiveCategory===cat&&s.chipSelected]}>{art&&<Image source={art.source} contentFit="contain" style={s.categoryArt}/>}<Text style={s.chipText}>{categoryName(cat)}</Text></Pressable>;})}</ScrollView>
        <Text style={s.creamCopy}>{decorating?'Tap to preview. Your room changes only when you save.':'Little things to make your burrow feel like yours.'}</Text>
        {decorating&&unownedPreview.length>0&&<Card title="Just a preview" body="Own these items before saving. Cancel restores your saved room.">
          {unownedPreview.map(item=><Action key={item.stable_id} secondary label={item.title} onPress={()=>setSelected(item)}/>)}
        </Card>}
        <View style={s.grid}>{items.map(item=><Pressable key={item.stable_id} accessibilityRole="button" accessibilityLabel={item.title} style={[s.tile,preview[item.metadata.slot??'']?.stable_id===item.stable_id&&decorating&&s.selectedTile]} onPress={()=>{
          if(decorating&&item.metadata.slot){setDraft({...preview,[item.metadata.slot]:item});if(!owned(item))setSelected(item);}else setSelected(item);
        }}><CatalogArtwork item={item}/><Text style={s.tileTitle}>{item.title}</Text><Text style={s.price}>{owned(item)?'Owned ✓':item.plus_only&&!data.hasPlus?'PLUS':`🥕 ${item.price??'Adventure find'}`}</Text></Pressable>)}</View>
        {!items.length&&<Card title="More little things are on their way" body="This category has no published items yet."/>}
        {!decorating&&<><Action label="Decorate my burrow" onPress={()=>openBurrow('decorate')}/><Action secondary label="My collection" onPress={()=>openBurrow('collection')}/></>}
      </>;
    }
    if(section==='friends_room')return <>
      <FriendVisitCard data={data} busy={busy}/>
      {!data.partner&&<Card title="A place for new friends" body="Explore the room now. Connect with your person when you’re ready for shared visits."><Action label="Connect with your person" onPress={()=>askToPair('Connect with your person to meet friends together.')}/></Card>}
      <Text style={s.creamCopy}>{data.discoveries.filter(d=>d.user_id===data.profile.id).length} friends met on your adventures</Text>
      <View style={s.grid}>{data.friends.map(friend=>{const found=data.discoveries.some(d=>d.user_id===data.profile.id&&d.friend_id===friend.stable_id);const art=burrowFriendArt(friend.name);return <View key={friend.stable_id} style={s.tile}>{art?<Image source={art} contentFit="contain" style={{width:110,height:110,opacity:found?1:.25}}/>:<Text style={[s.itemIcon,!found&&{opacity:.25}]}>🐾</Text>}<Text style={s.tileTitle}>{found?friend.name:'Someone to meet'}</Text></View>;})}</View>
    </>;
    if(section==='collection'){
      const tab=collectionTab;
      const whose=collectionOwner==='mine'?data.profile.id:data.partner?.id;
      const inventory=data.inventory.filter(i=>i.owner_id===whose);
      const list=data.catalog.filter(item=>inventory.some(i=>i.item_id===item.stable_id)&&(tab==='gifts'?item.item_type==='souvenir'||inventory.some(i=>i.item_id===item.stable_id&&['friend_visit','gift','adventure_gift'].includes(i.source)):tab==='outfits'?item.item_type==='outfit':['decor','our_room'].includes(item.item_type)));
      return <>
        <View style={s.row}>{(['mine','partner'] as const).map(value=><Action key={value} secondary={collectionOwner!==value} label={value==='mine'?'Mine':'Partner’s'} onPress={()=>value==='partner'&&!data.partner?askToPair('Connect with your person to see their collection.'):setCollectionOwner(value)}/>)}</View>
        <ScrollView horizontal contentContainerStyle={s.chips}>{['furniture','outfits','gifts','friends'].map(value=><Pressable accessibilityRole="button" key={value} style={[s.chip,tab===value&&s.chipSelected]} onPress={()=>setCollectionTab(value)}><Text style={s.chipText}>{categoryName(value)}</Text></Pressable>)}</ScrollView>
        {collectionOwner==='mine'&&data.affectionInbox.length>0&&<Card title="Your person thought of you" body={AFFECTION_TYPES.map(type=>{const count=data.affectionInbox.filter(e=>e.affection_type===type).length;return count?`${AFFECTION_COPY[type].symbol} ${count}`:'';}).filter(Boolean).join('   ')}><Action label="Love received" disabled={busy} onPress={()=>act('read-affection',()=>markAffectionRead(data.affectionInbox.map(e=>e.id)))}/></Card>}
        {collectionOwner==='mine'&&data.gifts.map(gift=><Card key={gift.id} title={data.catalog.find(i=>i.stable_id===gift.item_id)?.title??'A little gift'}><Action label="Open gift" disabled={busy} onPress={()=>act(`gift:${gift.id}`,()=>claimGift(gift.id))}/></Card>)}
        <View style={s.grid}>{tab==='friends'?data.friends.map(friend=>{
          const found=data.discoveries.some(d=>d.user_id===whose&&d.friend_id===friend.stable_id);const friendArt=burrowFriendArt(friend.name);return <View key={friend.stable_id} style={[s.tile,s.collectionTile]}>{friendArt?<Image source={friendArt} contentFit="contain" style={[{width:74,height:74},!found&&{opacity:.2}]}/>:<Text style={[s.itemIcon,!found&&{opacity:.2}]}>{friend.name==='Fenn'?'🦊':'🦫'}</Text>}<Text style={[s.tileTitle,s.collectionTitle]}>{found?friend.name:'Undiscovered'}</Text></View>;
        }):list.map(item=><Pressable key={item.stable_id} style={[s.tile,s.collectionTile]} accessibilityRole="button" onPress={()=>setSelected(item)}><CatalogArtwork item={item} compact/><Text style={[s.tileTitle,s.collectionTitle]}>{item.title}</Text><Text style={s.price}>Owned ✓</Text></Pressable>)}</View>
        {tab!=='friends'&&!list.length&&<Card title="Your story is just beginning" body="Adventure finds and things you buy will appear here."/>}
        <Action label="Decorate my burrow" onPress={()=>openBurrow('decorate')}/>
      </>;
    }
    if(section==='moments')return data.partner?<BurrowHistory data={data} kind="moments" busy={busy}/>:<Card title="Our Moments" body="Your shared days will appear here when you connect with your person. You can explore the rest of the burrow first."><Action label="Share a moment together" onPress={()=>askToPair('Connect with your person to share moments.')}/></Card>;
    if(section==='affection')return <>
      <AffectionDelivery sender={data.profile} recipient={data.partner} sent={loveSent}/>
      {loveSent?<Card title="Love sent" body="A little warmth is waiting for your person."><Action label="Done" onPress={()=>router.back()}/></Card>:cooldown>0?<Card title="A little pause between gestures" body={`Your next free gesture is ready in ${countdown(cooldown)}.`}><Action label="Explore Plus · no gesture cooldown" onPress={()=>router.push('/(main)/(modals)/subscription-paywall' as Href)}/><Action secondary label="Back to my burrow" onPress={()=>router.back()}/></Card>:<>
        <View style={s.grid}>{AFFECTION_TYPES.map(type=><Pressable key={type} style={[s.tile,affection===type&&s.selectedTile]} accessibilityRole="button" onPress={()=>data.partner?setAffection(type):askToPair('Connect with your person to send them a little love.')}><Image source={BURROW_AFFECTION_ICONS[type]} contentFit="contain" style={s.affectionIcon}/><Text style={s.tileTitle}>{AFFECTION_COPY[type].label}</Text></Pressable>)}</View>
        {affection&&<AffectionGesture key={affection} type={affection} disabled={busy} onComplete={metrics=>{if(!data.partner){askToPair('Connect with your person to send them a little love.');return;}void runBurrowAction(`affection:${affection}`,key=>completeAffection(affection,metrics,key)).then(ok=>{if(ok)setLoveSent(true);});}}/>}
      </>}
    </>;
    if(section==='adventure'){
      const result=data.adventureResult;
      const friend=result?.metadata?.friendSnapshot;
      const trail=adventure?adventureTrail(adventure.started_at,adventure.ends_at,now):null;
      return <>
        {adventure?.status==='in_progress'?<BunnyActor standalone outfit={roomSlots(data,data.profile.id).outfit} pose="digging"/>:<Text style={s.heroEmoji}>{result?'🎁':'🧭'}</Text>}
        {!data.partner?<Card title="Start today’s adventure" body="Your bunny is ready to explore. Connect with your person when you want to begin the adventure together."><Action label="Start adventure" onPress={()=>askToPair('Connect with your person to start an adventure.')}/></Card>:feedback?<Card title="A little story to keep" body={feedback}><Action label="Back to home" onPress={()=>router.back()}/></Card>:adventure?adventure.status==='in_progress'?<Card title="Digging up a little wonder…" body={`Back in ${countdown(remaining)}`}>
          <View style={s.progress}><View style={[s.progressFill,{width:`${Math.min(100,Math.max(0,100*(1-remaining/(new Date(adventure.ends_at).getTime()-new Date(adventure.started_at).getTime()))))}%`}]} /></View>
          <Text style={s.body}>Your bunny carries today’s story along the trail. You can close the app; the adventure keeps going.</Text>
          {trail&&<><Text style={s.cardTitle}>{trail.meters} m explored · Next waypoint {trail.nextMeters} m</Text>
            <Text accessibilityRole="header" style={s.cardTitle}>Adventure logs</Text>
            {trail.logs.map(log=><Text key={log.meters} style={s.body}>{log.meters} m · {log.copy}</Text>)}
            <Text style={s.body}>Trail milestones tell the journey; rewards are revealed on arrival.</Text></>}
          {remaining===0&&<Action label="Your bunny is back · Open" disabled={busy} onPress={()=>act(`settle:${adventure.id}`,()=>settleAdventure(adventure.id))}/>}
        </Card>:adventure.status==='interaction_required'?<AdventureFriendCard data={data} busy={busy} onComplete={setFeedback}/>:result?.result_type==='item'?<AdventureTreasure key={adventure.id} title={result.metadata?.itemSnapshot?.title??'A little discovery'} busy={busy} onClaim={()=>act(`claim:${adventure.id}`,()=>claimAdventureResult(adventure.id))}/>:<Card title={result?.result_type==='quiet'?'A quiet journey home':result?.result_type==='friend'?`You met ${friend?.name??'a new friend'}!`:'A treasure chest!'}
          body={result?.result_type==='quiet'?'You’ve found every available treasure on this trail. Today’s adventure still counts.':result?.item_id?result.metadata?.itemSnapshot?.title:'A little discovery is waiting for you.'}>
          <Action label={result?.result_type==='quiet'?'Welcome home':result?.result_type==='friend'?'Say hello':'Claim item'} disabled={busy} onPress={()=>act(`claim:${adventure.id}`,()=>claimAdventureResult(adventure.id))}/>
        </Card>:data.dailyAdventureUsed?<Card title="Your bunny is home for today" body="Another adventure will be ready after your local midnight."/>:<Card title="Start today’s adventure" body="Your bunny’s waiting on today’s story.">
          {data.readyRecordId?<><Text style={s.body}>Your day is saved. Ready for the trail?</Text><Action label={`Start adventure · ${data.hasPlus?'2':'8'} hours`} disabled={busy} onPress={()=>act(`start:${data.readyRecordId}`,key=>startAdventure(data.readyRecordId,key))}/></>:<Action label="Share your day" onPress={()=>router.push('/(main)/reflect' as Href)}/>}
        </Card>}
      </>;
    }
    if(section==='memories_room')return data.partner?<BurrowHistory data={data} kind="memories" busy={busy}/>:<Card title="Memories Room" body="This room is ready for the little stories you’ll keep together."><Action label="Create a shared memory" onPress={()=>askToPair('Connect with your person to create shared memories.')}/></Card>;
    if(section==='self_care_room')return <>{[['New Lens','new-lens'],['True North','true-north'],['Small Wins','quiet-wins']].map(([label,path])=><Card key={path} title={label}><Action label="Take a little time" onPress={()=>router.push(`/(main)/${path}` as Href)}/></Card>)}</>;
    if(section==='game_room')return <Card title="Game Room" body="Choose a game to discover how well you know each other."><Action label="Open games" onPress={()=>router.replace('/(main)/game-room' as Href)}/></Card>;
    return <Card title="Our Burrows" body="Choose a room to spend a little time together."><Action label="Explore rooms" onPress={()=>router.navigate('/(main)/(tabs)/burrow' as Href)}/></Card>;
  }
  return <LinearGradient colors={section==='affection'?['#E88791','#EDABA2']:['#793D29','#B85B35','#D6834B']} style={s.root}>
    {section!=='home'&&section!=='burrow'&&<Image source={background} contentFit="cover" contentPosition="bottom" style={StyleSheet.absoluteFillObject} pointerEvents="none"/>}
    {section==='moments'&&<MomentsHearts/>}
    <View style={[s.frame,section==='home'||section==='burrow'?s.homeFrame:{paddingTop:insets.top}]}>
      {section==='home'?data?<View style={s.homeCanvas} onLayout={()=>markHomeEntryAsset('burrow-layout',attempt)}><HomeArtScene
        balance={data.wallet.balance} slots={sceneSlots} photos={data.roomPhotos} ownerId={data.profile.id}
        away={adventureIsAway(adventure,now)} busy={busy} toyPulse={toyPulse}
        onToyInteract={recordToyInteraction} onToyPhoto={()=>data.partner?setPhotoEditor('doll'):askToPair('Connect with your person to add a doll photo.')}
        onMenu={()=>router.push('/(main)/(modals)/me' as Href)} onCarrots={()=>openBurrow('carrot_shop')}
        onAffection={()=>data.unread.affection>0?setInboxOpen(true):openBurrow('affection')} unreadAffection={data.unread.affection} onAdventure={()=>openBurrow('adventure')}
        onLetter={()=>data.partner?setLetterOpen(true):askToPair('Connect with your person to send a love letter.')}
        onBurrows={()=>openBurrow('burrow')}
        onDecorate={()=>openBurrow('decorate')} onSlot={homeSlot}/></View>
        :<View style={s.loading}>{loading?<ActivityIndicator color="#FFF1DB"/>:<Text style={s.creamCopy}>Your burrow could not load. Pull down on another tab to retry.</Text>}</View>
      :<>{section!=='burrow'&&section!=='moments'&&<View style={s.header}>{!isTab&&<Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={()=>router.back()} style={s.back}><Text style={s.backText}>‹</Text></Pressable>}<Text style={s.heading}>{titles[section]}</Text>{data&&<Pressable accessibilityRole="button" accessibilityLabel={`Carrot Shop. Balance ${data.wallet.balance}`} onPress={()=>openBurrow('carrot_shop')} style={s.wallet}><Text style={s.walletText}>🥕 {data.wallet.balance.toLocaleString()} ＋</Text></Pressable>}</View>}
      {!data?<View style={s.loading}>{loading?<ActivityIndicator color="#FFF1DB"/>:<Text style={s.creamCopy}>Your burrow needs a connection to load.</Text>}</View>:<ScrollView key={section} onLayout={()=>markHomeEntryAsset('burrow-layout',attempt)} contentContainerStyle={[section==='burrow'?s.mapContent:s.content,{paddingBottom:isTab?24:insets.bottom+24}]} refreshControl={<RefreshControl refreshing={loading&&!busy} onRefresh={()=>void refreshBurrow()} tintColor="#FFF1DB"/>}>{content()}</ScrollView>}</>}
      {error&&<View style={[s.error,section==='home'&&s.homeError]} accessibilityRole="alert"><Text style={s.body}>{burrowErrorMessage(error)}</Text><Action secondary label={error==='not_paired'?'Connect with my person':'Refresh'} disabled={busy||loading} onPress={()=>error==='not_paired'?askToPair():void refreshBurrow()}/></View>}
      {busy&&<View style={s.busy} pointerEvents="none"><ActivityIndicator color="#FFF"/><Text style={s.creamCopy}>Saving your little moment…</Text></View>}
    </View>
    {photoEditor&&data&&owner&&<RoomPhotoEditor data={data} ownerId={owner} kind={photoEditor} onClose={()=>setPhotoEditor(null)}/>}
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
        <Text style={s.body}>Write one little thing you want them to remember. It will appear in your shared Memories Room.</Text>
        <TextInput accessibilityLabel="Love letter" multiline maxLength={4800} autoFocus value={letterText} onChangeText={setLetterText} placeholder="Dear you…" placeholderTextColor="#927560" style={s.letterInput}/>
        <Text style={s.body}>{letterText.length} / 4800</Text>
        <Action label="Send my letter" disabled={busy||!letterText.trim()} onPress={()=>{if(!data?.partner){setLetterOpen(false);askToPair('Connect with your person to send a love letter.');return;}
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
        {!!selected.price&&selected.tradable&&<Action secondary label={`Gift my partner · 🥕 ${selected.price}`} disabled={busy||!!data.partner&&data.inventory.some(i=>i.owner_id===data.partner?.id&&i.item_id===selected.stable_id)} onPress={()=>buy(selected,true)}/>}
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
  root:{flex:1},frame:{flex:1,width:'100%',maxWidth:560,alignSelf:'center'},homeFrame:{maxWidth:undefined},homeCanvas:{flex:1},homeError:{position:'absolute',left:0,right:0,top:100},header:{paddingHorizontal:18,paddingVertical:15,flexDirection:'row',alignItems:'center',gap:10},heading:{color:'#FFF3E0',fontSize:25,fontWeight:'800',flex:1},wallet:{backgroundColor:'#FFF3DF',paddingHorizontal:12,paddingVertical:9,borderRadius:30},walletText:{color:'#563720',fontSize:16,fontWeight:'800'},back:{width:36,height:36,borderRadius:18,backgroundColor:'#FFF3DF',alignItems:'center'},backText:{fontSize:32,lineHeight:34,color:'#663B26'},content:{paddingHorizontal:18,gap:18},mapContent:{paddingHorizontal:0},card:{backgroundColor:'#FFF4E1',borderRadius:25,padding:22,gap:14,shadowColor:'#4E281B',shadowOffset:{width:0,height:4},shadowOpacity:.13,shadowRadius:0,elevation:2},cardTitle:{color:'#553521',fontSize:22,fontWeight:'800'},body:{color:'#79563E',fontSize:15,lineHeight:23},creamCopy:{color:'#FFF0D7',fontSize:15,lineHeight:23,textAlign:'center'},row:{flexDirection:'row',gap:12},action:{flexGrow:1,flexShrink:1,backgroundColor:'#2F8D72',paddingHorizontal:14,paddingVertical:16,borderRadius:20,alignItems:'center',justifyContent:'center',minHeight:50},secondary:{backgroundColor:'#F9D9AA'},actionText:{color:'#FFF8EB',fontSize:16,fontWeight:'800',textAlign:'center'},grid:{flexDirection:'row',flexWrap:'wrap',gap:12},tile:{width:'46%',flexGrow:1,backgroundColor:'#FFF3DF',borderRadius:24,padding:18,alignItems:'center',gap:12,borderWidth:2,borderColor:'transparent'},collectionTile:{width:'29%',minWidth:94,flexGrow:1,padding:8,gap:6,borderRadius:17},collectionTitle:{fontSize:13,lineHeight:17},selectedTile:{borderColor:'#EAA340',backgroundColor:'#FFE8BC'},itemIcon:{fontSize:53,textAlign:'center'},itemArt:{width:110,height:110,overflow:'hidden'},itemArtCompact:{width:74,height:74,overflow:'hidden'},itemArtLarge:{width:160,height:160,alignSelf:'center',overflow:'hidden'},tileTitle:{color:'#563B27',fontSize:17,fontWeight:'700',textAlign:'center'},price:{color:'#2D775C',fontWeight:'700',fontSize:14},chips:{gap:8,paddingVertical:4},chip:{paddingHorizontal:17,paddingVertical:13,backgroundColor:'#F9DAB3',borderRadius:18,alignItems:'center',minWidth:82},chipSelected:{backgroundColor:'#F3AF4D'},chipText:{color:'#633823',fontWeight:'700'},categoryArt:{width:52,height:52},roomDoor:{width:'78%',backgroundColor:'#EBA35B',padding:25,borderRadius:75,borderWidth:9,borderColor:'#9C542E',alignItems:'center',gap:8},roomIcon:{fontSize:49},roomHint:{color:'#71472A',textAlign:'center',lineHeight:19,fontSize:13},tunnel:{position:'absolute',left:'49%',top:60,bottom:40,width:18,backgroundColor:'#C58247',borderRadius:30},heroEmoji:{fontSize:110,textAlign:'center',paddingVertical:42},progress:{height:13,borderRadius:10,overflow:'hidden',backgroundColor:'#E7D6BB'},progressFill:{height:13,backgroundColor:'#D88748'},scrim:{flex:1,backgroundColor:'#1E100DBB',justifyContent:'flex-end',alignItems:'center'},sheet:{width:'100%',maxWidth:560,padding:30,paddingBottom:50,gap:18,backgroundColor:'#FFF2DD',borderTopLeftRadius:32,borderTopRightRadius:32},inboxAffection:{flexDirection:'row',alignItems:'center',gap:14,padding:12,backgroundColor:'#FFF9EE',borderRadius:20},error:{padding:16,gap:10,backgroundColor:'#FFE2CE',margin:16,borderRadius:18},loading:{flex:1,alignItems:'center',justifyContent:'center'},busy:{position:'absolute',bottom:24,alignSelf:'center',backgroundColor:'#523727EE',padding:15,borderRadius:20,gap:8},questIcon:{width:64,height:64,alignSelf:'center'},affectionIcon:{width:76,height:76},letterInput:{minHeight:160,maxHeight:260,textAlignVertical:'top',color:'#503324',fontSize:17,borderWidth:1,borderColor:'#D9B897',borderRadius:17,padding:16,backgroundColor:'#FFF9EE'},
});
