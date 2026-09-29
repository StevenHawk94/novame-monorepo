import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { AFFECTION_TYPES, BURROW_ROOM_IDS, SHOP_CATEGORIES, type AffectionType } from '@novame/domain';
import { affectionCooldownRemainingMs } from '@novame/engine';
import {
  claimAdventureResult, claimDailyQuest, claimSpecialQuest, claimGift, completeAffection,
  deleteMemoryRoomEntry, setRoomSleep,
  markAffectionRead, purchaseCatalogItem, refillRoomNeed, saveRoomLoadout, settleAdventure,
  startAdventure, visitPartnerRoom, type MajorUpdateBootstrap, type MajorUpdateCatalogItem,
} from '@/lib/app-major-update-api';
import { burrowClock, burrowErrorMessage, refreshBurrow, runBurrowAction, useBurrow } from '@/lib/burrow-store';
import { adventureHasArrived, adventureIsAway, roomNeedDisplay, roomSlots } from '@/lib/burrow-presentation';
import { markHomeEntryAsset } from '@/lib/home-entry-readiness';
import { useHomeEntry } from '@/lib/use-home-entry';
import { registerOverlay } from '@/lib/overlay-presence';
import { RoomScene } from './room-scene';
import { HomeArtScene } from './home-art-scene';
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

export type BurrowSection = 'home'|'burrow'|'quests'|'shop'|'moments'|'collection'|'adventure'|'affection'|'decorate'|'partner_room'|'our_room'|'friends_room'|'game_room'|'memories_room'|'self_care_room'|'carrot_shop';
const titles: Record<BurrowSection,string> = {home:'My Burrow',burrow:'Our Burrows',quests:'Quests',shop:'Shop',moments:'Our Moments',collection:'Collection',adventure:'Today’s Adventure',affection:'Send a little love',decorate:'Decorate',partner_room:'Partner’s Room',our_room:'Our Room',friends_room:'Our Friends',game_room:'Game Room',memories_room:'Memories Room',self_care_room:'A little space for you',carrot_shop:'Carrot Shop'};
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
const questNames:Record<string,string>={write_adventure_record:'Record a little of your day',send_affection:'Send your partner affection',water_partner_flower:'Water your partner’s flowers',feed_partner_bunny:'Feed your partner’s bunny',visit_partner_room:'Visit your partner’s room',finish_adventure:'Finish an adventure',play_game:'Play together'};
const categoryName=(value:string)=>value.replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
export function openBurrow(section:BurrowSection,extra?:Record<string,string>){
  if(section==='game_room'){router.push({pathname:'/(main)/game-room',params:extra} as Href);return;}
  router.push({pathname:'/(main)/burrow-detail',params:{section,...extra}} as Href);
}
const iconFor=(item:MajorUpdateCatalogItem)=>({windows:'🪟',lamps:'💡',vases:'🌼',decor:'🪴',cushions:'🛏️',tables:'🪵',rugs:'🧶',cabinets:'🗄️',posters:'🍃',music_players:'📻',frames:'🖼️',couple_dolls:'🧸',outfits:'🧥',our_room:'💕',gifts:'🎁',rooms:'🏡',music:'🎵'}[item.category]??'✨');
function Action({label,onPress,disabled=false,secondary=false}:{label:string;onPress:()=>void;disabled?:boolean;secondary?:boolean}){
  return <Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} onPress={onPress}
    style={({pressed})=>[s.action,secondary&&s.secondary,(pressed||disabled)&&{opacity:.5}]}><Text style={[s.actionText,secondary&&{color:'#64402C'}]}>{label}</Text></Pressable>;
}
function Card({title,body,children}:{title:string;body?:string;children?:React.ReactNode}){
  return <View style={s.card}><Text style={s.cardTitle}>{title}</Text>{body&&<Text style={s.body}>{body}</Text>}{children}</View>;
}

export function BurrowScreen({section,roomType='home',initialCategory='windows',asTab=false}:{section:BurrowSection;roomType?:'home'|'our';initialCategory?:string;asTab?:boolean}){
  const {data,loading,error,busy,receivedAt}=useBurrow();
  const {attempt}=useHomeEntry();
  const insets=useSafeAreaInsets();
  const [clock,setClock]=useState(burrowClock());
  const [category,setCategory]=useState<string>(initialCategory);
  const [collectionTab,setCollectionTab]=useState('decor');
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
  const [pairPrompt,setPairPrompt]=useState<string|null>(null);
  const modalOpen=!!photoEditor||musicOpen||!!selected||inboxOpen||!!pairPrompt;
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
  const remaining=adventure?Math.max(0,new Date(adventure.ends_at).getTime()-now):0;
  const countdown=(ms:number)=>`${Math.floor(ms/3600000)}h ${Math.floor(ms%3600000/60000)}m ${Math.floor(ms%60000/1000)}s`;
  const cooldown=data?affectionCooldownRemainingMs(data.lastAffectionAt?new Date(data.lastAffectionAt).getTime():null,now,data.hasPlus):0;
  const owner=section==='partner_room'?data?.partner?.id:data?.profile.id;
  const sceneSlots=useMemo(()=>data?roomSlots(data,owner??data.profile.id,section==='our_room'||roomType==='our'):{},[data,owner,section,roomType]);
  const askToPair=(reason='Connect with your person to use this shared feature.')=>{setSelected(null);setPairPrompt(reason);};
  const act=(name:string,fn:(key:string)=>Promise<unknown>)=>{
    if(!data?.partner){askToPair();return;}
    void runBurrowAction(name,fn);
  };
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
    else if(id.includes('partner'))openBurrow('partner_room');
    else openBurrow('adventure');
  }
  function homeSlot(slot:string){
    if(!data?.partner){askToPair('Connect with your person to interact with the burrow.');return;}
    if(slot==='bunny'){
      if(adventureIsAway(adventure,now)){openBurrow('adventure');return;}
      if(roomNeedDisplay(data,false,now).food<100)act(`food:${data.profile.id}`,key=>refillRoomNeed(data.profile.id,'food',key));
      else Alert.alert('Your bunny is full','Come back when your bunny is hungry again.');
    }
    else if(slot==='vase')act(`water:${data.profile.id}`,key=>refillRoomNeed(data.profile.id,'water',key));
    else if(slot==='frame')setPhotoEditor('frame');
    else if(slot==='couple_doll')setPhotoEditor('doll');
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
          else if(slot==='couple_doll')setPhotoEditor('doll');
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
    if(section==='burrow')return <>
      <Text style={s.creamCopy}>Nine little rooms. One place for us.</Text>
      <View style={s.tunnel}/>{BURROW_ROOM_IDS.map((id,index)=>{
        const room=roomInfo[id];return <Pressable accessibilityRole="button" key={id} style={[s.roomDoor,{alignSelf:index%2?'flex-end':'flex-start'}]} onPress={()=>{
          if(id==='my_room')router.navigate('/(main)/(tabs)' as Href);
          else if(id==='rage_room')router.push('/(main)/tame-enemy' as Href);
          else openBurrow(id==='collection_room'?'collection':id as BurrowSection);
        }}><Text style={s.roomIcon}>{room.icon}</Text><Text style={s.cardTitle}>{room.title}{id==='friends_room'&&data.friendVisit&&!data.friendVisit.completed_at&&!data.friendVisit.declined_at?' 🔴':''}</Text><Text style={s.roomHint}>{room.subtitle}</Text></Pressable>;
      })}<Text style={s.creamCopy}>Unexplored areas · more stories to come</Text>
    </>;
    if(section==='quests')return <>
      <Text style={s.creamCopy}>Three little steps for {data.localDate}.</Text>
      {!data.partner&&<Card title="Daily Quests" body="Explore your quests now. Connect with your person when you want to start or collect rewards.">{['Record a little of your day','Send your person affection','Water your person’s flowers'].map(label=><Action key={label} secondary label={label} onPress={()=>askToPair('Connect with your person to start shared quests.')}/>)}</Card>}
      {data.quests.quests.map(q=><Card key={q.assignmentId} title={questNames[q.questId]??q.questId} body={`${Math.min(q.progress,q.target)} / ${q.target} · +10 carrots`}>
        <Action label={q.claimedAt?'Collected ✓':q.completedAt?'Collect reward':'Let’s go'} disabled={busy||!!q.claimedAt} onPress={()=>q.completedAt?act(`quest:${q.assignmentId}`,()=>claimDailyQuest(q.assignmentId)):questGo(q.questId)}/>
      </Card>)}
      <Text style={s.heading}>Special Quests</Text>
      {!data.partner&&<Card title="More to discover" body="Collect items, meet friends, and make memories together after connecting."><Action secondary label="See shared quests" onPress={()=>askToPair('Connect with your person to take on shared quests.')}/></Card>}
      {data.specialQuests.map(q=><Card key={q.questId} title={categoryName(q.questId)} body={`Stage ${q.stage} · ${q.progress} / ${q.target} · +15 carrots`}><Action label={q.progress>=q.target?'Collect reward':'Keep exploring'} disabled={busy||q.progress<q.target} onPress={()=>act(`special:${q.questId}:${q.stage}`,()=>claimSpecialQuest(q.questId,q.stage))}/></Card>)}
      <Text style={s.creamCopy}>Tasks refresh at your local midnight. A reward is collected only once.</Text>
    </>;
    if(section==='carrot_shop')return <><CarrotShop balance={data.wallet.balance}/><Action secondary label="Back" onPress={()=>router.back()}/></>;
    if(section==='shop'||section==='decorate'){
      const decorating=section==='decorate';
      const preview=draft??sceneSlots;
      const owned=(item:MajorUpdateCatalogItem)=>data.inventory.some(i=>i.item_id===item.stable_id&&(i.owner_id===data.profile.id||(roomType==='our'&&i.owner_id===data.partner?.id)));
      const unownedPreview=Object.values(preview).filter(item=>!owned(item));
      const categories=decorating&&roomType==='our'?['our_room']:SHOP_CATEGORIES;
      const effectiveCategory=decorating&&roomType==='our'?'our_room':category;
      const items=data.catalog.filter(item=>item.category===effectiveCategory&&(decorating||!!item.price));
      return <>
        {decorating&&<><RoomScene slots={roomType==='our'?{...preview,outfit:roomSlots(data,data.profile.id).outfit}:preview} shared={roomType==='our'}
          partnerOutfit={data.partner?roomSlots(data,data.partner.id).outfit:undefined}
          photos={roomType==='home'?data.roomPhotos?.filter(photo=>photo.ownerId===data.profile.id):[]}/><View style={s.row}>
          <Action secondary label="Cancel" disabled={busy} onPress={()=>router.back()}/>
          <Action label="Done" disabled={busy||unownedPreview.length>0||(roomType==='our'&&!!data.partner&&!data.hasPlus)} onPress={()=>{if(!data.partner){askToPair('Connect with your person to save your room design.');return;}void runBurrowAction(`loadout:${roomType}`,()=>saveRoomLoadout(roomType,Object.fromEntries(Object.entries(preview).map(([slot,item])=>[slot,item.stable_id])))).then(ok=>{if(ok)router.back();});}}/>
        </View><Action secondary label="Reset preview" onPress={()=>{
          const defaults:Record<string,MajorUpdateCatalogItem>={};data.catalog.filter(item=>item.metadata.starter&&item.metadata.slot&&(roomType==='our'?item.item_type==='our_room':['decor','outfit'].includes(item.item_type))).forEach(item=>{defaults[item.metadata.slot!]=item;});setDraft(defaults);
        }}/></>}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>{categories.map(cat=><Pressable accessibilityRole="button" key={cat} onPress={()=>setCategory(cat)} style={[s.chip,effectiveCategory===cat&&s.chipSelected]}><Text style={s.chipText}>{categoryName(cat)}</Text></Pressable>)}</ScrollView>
        <Text style={s.creamCopy}>{decorating?'Tap to preview. Your room changes only when you save.':'Little things to make your burrow feel like yours.'}</Text>
        {decorating&&unownedPreview.length>0&&<Card title="Just a preview" body="Own these items before saving. Cancel restores your saved room.">
          {unownedPreview.map(item=><Action key={item.stable_id} secondary label={item.title} onPress={()=>setSelected(item)}/>)}
        </Card>}
        <View style={s.grid}>{items.map(item=><Pressable key={item.stable_id} accessibilityRole="button" accessibilityLabel={item.title} style={[s.tile,preview[item.metadata.slot??'']?.stable_id===item.stable_id&&decorating&&s.selectedTile]} onPress={()=>{
          if(decorating&&item.metadata.slot){setDraft({...preview,[item.metadata.slot]:item});if(!owned(item))setSelected(item);}else setSelected(item);
        }}><Text style={s.itemIcon}>{iconFor(item)}</Text><Text style={s.tileTitle}>{item.title}</Text><Text style={s.price}>{owned(item)?'Owned ✓':item.plus_only&&!data.hasPlus?'PLUS':`🥕 ${item.price??'Adventure find'}`}</Text></Pressable>)}</View>
        {!items.length&&<Card title="More little things are on their way" body="This category has no published items yet."/>}
        {!decorating&&<><Action label="Decorate my burrow" onPress={()=>openBurrow('decorate')}/><Action secondary label="My collection" onPress={()=>openBurrow('collection')}/></>}
      </>;
    }
    if(section==='collection'||section==='friends_room'){
      const tab=section==='friends_room'?'friends':collectionTab;
      const whose=collectionOwner==='mine'?data.profile.id:data.partner?.id;
      const inventory=data.inventory.filter(i=>i.owner_id===whose);
      const list=data.catalog.filter(item=>inventory.some(i=>i.item_id===item.stable_id)&&(tab==='gifts'?item.item_type==='souvenir'||inventory.some(i=>i.item_id===item.stable_id&&['friend_visit','gift','adventure_gift'].includes(i.source)):tab==='outfits'?item.item_type==='outfit':tab==='our_room'?item.item_type==='our_room':item.item_type==='decor'));
      return <>
        {section==='friends_room'&&<FriendVisitCard data={data} busy={busy}/>}
        {section==='friends_room'&&!data.partner&&<Card title="Meet friends together" body="You can browse the friends here now. Connect with your person when you’re ready for visits and adventures."><Action label="Start a shared visit" onPress={()=>askToPair('Connect with your person to meet friends together.')}/></Card>}
        <View style={s.row}>{(['mine','partner'] as const).map(value=><Action key={value} secondary={collectionOwner!==value} label={value==='mine'?'Mine':'Partner’s'} onPress={()=>value==='partner'&&!data.partner?askToPair('Connect with your person to see their collection.'):setCollectionOwner(value)}/>)}</View>
        {section==='collection'&&<ScrollView horizontal contentContainerStyle={s.chips}>{['decor','outfits','our_room','gifts','friends'].map(value=><Pressable accessibilityRole="button" key={value} style={[s.chip,tab===value&&s.chipSelected]} onPress={()=>setCollectionTab(value)}><Text style={s.chipText}>{categoryName(value)}</Text></Pressable>)}</ScrollView>}
        {collectionOwner==='mine'&&data.affectionInbox.length>0&&<Card title="Your person thought of you" body={AFFECTION_TYPES.map(type=>{const count=data.affectionInbox.filter(e=>e.affection_type===type).length;return count?`${AFFECTION_COPY[type].symbol} ${count}`:'';}).filter(Boolean).join('   ')}><Action label="Love received" disabled={busy} onPress={()=>act('read-affection',()=>markAffectionRead(data.affectionInbox.map(e=>e.id)))}/></Card>}
        {collectionOwner==='mine'&&data.gifts.map(gift=><Card key={gift.id} title={data.catalog.find(i=>i.stable_id===gift.item_id)?.title??'A little gift'}><Action label="Open gift" disabled={busy} onPress={()=>act(`gift:${gift.id}`,()=>claimGift(gift.id))}/></Card>)}
        <View style={s.grid}>{tab==='friends'?data.friends.map(friend=>{
          const found=data.discoveries.some(d=>d.user_id===whose&&d.friend_id===friend.stable_id);return <View key={friend.stable_id} style={s.tile}><Text style={[s.itemIcon,!found&&{opacity:.2}]}>{friend.name==='Pip'?'🐸':friend.name==='Fenn'?'🦊':'🦫'}</Text><Text style={s.tileTitle}>{found?friend.name:'Undiscovered'}</Text><Text style={s.body}>{found?friend.subtitle:'Find friends on an adventure.'}</Text></View>;
        }):list.map(item=><Pressable key={item.stable_id} style={s.tile} accessibilityRole="button" onPress={()=>setSelected(item)}><Text style={s.itemIcon}>{iconFor(item)}</Text><Text style={s.tileTitle}>{item.title}</Text><Text style={s.price}>Collected ✓</Text></Pressable>)}</View>
        {tab!=='friends'&&!list.length&&<Card title="Your story is just beginning" body="Adventure finds and things you buy will appear here."/>}
        <Action label="Decorate my burrow" onPress={()=>openBurrow('decorate')}/>
      </>;
    }
    if(section==='moments')return data.partner?<BurrowHistory data={data} kind="moments" busy={busy}/>:<Card title="Our Moments" body="Your shared days will appear here when you connect with your person. You can explore the rest of the burrow first."><Action label="Share a moment together" onPress={()=>askToPair('Connect with your person to share moments.')}/></Card>;
    if(section==='affection')return <>
      <AffectionDelivery sender={data.profile} recipient={data.partner} sent={loveSent}/>
      {loveSent?<Card title="Love sent" body="A little warmth is waiting for your person."><Action label="Done" onPress={()=>router.back()}/></Card>:cooldown>0?<Card title="A little pause between gestures" body={`Your next free gesture is ready in ${countdown(cooldown)}.`}><Action label="Explore Plus · no gesture cooldown" onPress={()=>router.push('/(main)/(modals)/subscription-paywall' as Href)}/><Action secondary label="Back to my burrow" onPress={()=>router.back()}/></Card>:<>
        <View style={s.grid}>{AFFECTION_TYPES.map(type=><Pressable key={type} style={[s.tile,affection===type&&s.selectedTile]} accessibilityRole="button" onPress={()=>data.partner?setAffection(type):askToPair('Connect with your person to send them a little love.')}><Text style={s.itemIcon}>{AFFECTION_COPY[type].symbol}</Text><Text style={s.tileTitle}>{AFFECTION_COPY[type].label}</Text></Pressable>)}</View>
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
    return <Card title={section==='game_room'?'A little play, coming soon':'This room is being prepared'} body={section==='game_room'?'A place for playful questions and discovering each other. Game tasks stay hidden until games are ready.':'The room entry is ready. Its remaining interactions are tracked in the implementation checklist.'}><Action secondary label="Back to our burrows" onPress={()=>router.back()}/></Card>;
  }
  return <LinearGradient colors={section==='affection'?['#E88791','#EDABA2']:['#793D29','#B85B35','#D6834B']} style={s.root}>
    <View style={[s.frame,section==='home'?s.homeFrame:{paddingTop:insets.top}]}>
      {section==='home'?data?<View style={s.homeCanvas} onLayout={()=>markHomeEntryAsset('burrow-layout',attempt)}><HomeArtScene
        balance={data.wallet.balance} slots={sceneSlots} photos={data.roomPhotos} ownerId={data.profile.id}
        away={adventureIsAway(adventure,now)} busy={busy}
        onMenu={()=>router.push('/(main)/(modals)/me' as Href)} onCarrots={()=>openBurrow('carrot_shop')}
        onQuests={()=>openBurrow('quests')} onAdventure={()=>openBurrow('adventure')}
        onInbox={()=>data.partner?setInboxOpen(true):askToPair('Connect with your person to receive little notes and gifts.')}
        onBurrows={()=>openBurrow('burrow')}
        onDecorate={()=>openBurrow('decorate')} onSlot={homeSlot}/></View>
        :<View style={s.loading}>{loading?<ActivityIndicator color="#FFF1DB"/>:<Text style={s.creamCopy}>Your burrow could not load. Pull down on another tab to retry.</Text>}</View>
      :<><View style={s.header}>{!isTab&&<Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={()=>router.back()} style={s.back}><Text style={s.backText}>‹</Text></Pressable>}<Text style={s.heading}>{titles[section]}</Text>{data&&<Pressable accessibilityRole="button" accessibilityLabel={`Carrot Shop. Balance ${data.wallet.balance}`} onPress={()=>openBurrow('carrot_shop')} style={s.wallet}><Text style={s.walletText}>🥕 {data.wallet.balance.toLocaleString()} ＋</Text></Pressable>}</View>
      {!data?<View style={s.loading}>{loading?<ActivityIndicator color="#FFF1DB"/>:<Text style={s.creamCopy}>Your burrow needs a connection to load.</Text>}</View>:<ScrollView key={section} onLayout={()=>markHomeEntryAsset('burrow-layout',attempt)} contentContainerStyle={[s.content,{paddingBottom:isTab?24:insets.bottom+24}]} refreshControl={<RefreshControl refreshing={loading&&!busy} onRefresh={()=>void refreshBurrow()} tintColor="#FFF1DB"/>}>{content()}</ScrollView>}</>}
      {error&&<View style={[s.error,section==='home'&&s.homeError]} accessibilityRole="alert"><Text style={s.body}>{burrowErrorMessage(error)}</Text><Action secondary label={error==='not_paired'?'Connect with my person':'Refresh'} disabled={busy||loading} onPress={()=>error==='not_paired'?askToPair():void refreshBurrow()}/></View>}
      {busy&&<View style={s.busy} pointerEvents="none"><ActivityIndicator color="#FFF"/><Text style={s.creamCopy}>Saving your little moment…</Text></View>}
    </View>
    {photoEditor&&data&&owner&&<RoomPhotoEditor data={data} ownerId={owner} kind={photoEditor} onClose={()=>setPhotoEditor(null)}/>}
    {musicOpen&&data&&<BurrowMusicPicker data={data} onClose={()=>setMusicOpen(false)}/>}
    <Modal visible={inboxOpen&&!!data} transparent animationType="slide" onRequestClose={()=>setInboxOpen(false)}>
      <View style={s.scrim}><ScrollView style={s.sheet} contentContainerStyle={{gap:16,paddingBottom:35}}>{data&&<>
        <Text accessibilityRole="header" style={s.cardTitle}>A little love arrived</Text>
        {data.affectionInbox.length>0?<><Text style={s.body}>{AFFECTION_TYPES.map(type=>{const count=data.affectionInbox.filter(e=>e.affection_type===type).length;return count?`${AFFECTION_COPY[type].label}: ${count}`:'';}).filter(Boolean).join(' · ')}</Text><Action label="Love received" disabled={busy} onPress={()=>act('read-affection',()=>markAffectionRead(data.affectionInbox.map(e=>e.id)))}/></>:<Text style={s.body}>No unread gestures.</Text>}
        {data.gifts.map(gift=><Card key={gift.id} title={data.catalog.find(item=>item.stable_id===gift.item_id)?.title??'A little gift'}><Action label="Add to my collection" disabled={busy} onPress={()=>act(`gift:${gift.id}`,()=>claimGift(gift.id))}/></Card>)}
        {!data.gifts.length&&<Text style={s.body}>No unopened gifts.</Text>}
        <Action secondary label="Close inbox" onPress={()=>setInboxOpen(false)}/>
      </>}</ScrollView></View>
    </Modal>
    <Modal visible={!!selected} transparent animationType="slide" onRequestClose={()=>setSelected(null)}>
      <View style={s.scrim}><View style={s.sheet}>{selected&&data&&<>
        <Text style={s.itemIcon}>{iconFor(selected)}</Text><Text style={s.cardTitle}>{selected.title}</Text><Text style={s.body}>{selected.description}</Text>
        {selected.price!=null&&selected.price>0&&!data.inventory.some(i=>i.owner_id===data.profile.id&&i.item_id===selected.stable_id)&&<Action label={selected.plus_only&&!data.hasPlus?'Plus required':`Buy for 🥕 ${selected.price}`} disabled={busy} onPress={()=>buy(selected)}/>}
        {!!selected.price&&selected.tradable&&<Action secondary label={`Gift my partner · 🥕 ${selected.price}`} disabled={busy||!!data.partner&&data.inventory.some(i=>i.owner_id===data.partner?.id&&i.item_id===selected.stable_id)} onPress={()=>buy(selected,true)}/>}
        <Action secondary label="Close" disabled={busy} onPress={()=>setSelected(null)}/>
      </>}</View></View>
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
  root:{flex:1},frame:{flex:1,width:'100%',maxWidth:560,alignSelf:'center'},homeFrame:{maxWidth:undefined},homeCanvas:{flex:1},homeError:{position:'absolute',left:0,right:0,top:100},header:{paddingHorizontal:18,paddingVertical:15,flexDirection:'row',alignItems:'center',gap:10},heading:{color:'#FFF3E0',fontSize:25,fontWeight:'800',flex:1},wallet:{backgroundColor:'#FFF3DF',paddingHorizontal:12,paddingVertical:9,borderRadius:30},walletText:{color:'#563720',fontSize:16,fontWeight:'800'},back:{width:36,height:36,borderRadius:18,backgroundColor:'#FFF3DF',alignItems:'center'},backText:{fontSize:32,lineHeight:34,color:'#663B26'},content:{paddingHorizontal:18,gap:18},card:{backgroundColor:'#FFF4E1',borderRadius:25,padding:22,gap:14,shadowColor:'#4E281B',shadowOffset:{width:0,height:4},shadowOpacity:.13,shadowRadius:0,elevation:2},cardTitle:{color:'#553521',fontSize:22,fontWeight:'800'},body:{color:'#79563E',fontSize:15,lineHeight:23},creamCopy:{color:'#FFF0D7',fontSize:15,lineHeight:23,textAlign:'center'},row:{flexDirection:'row',gap:12},action:{flexGrow:1,flexShrink:1,backgroundColor:'#2F8D72',paddingHorizontal:14,paddingVertical:16,borderRadius:20,alignItems:'center',justifyContent:'center',minHeight:50},secondary:{backgroundColor:'#F9D9AA'},actionText:{color:'#FFF8EB',fontSize:16,fontWeight:'800',textAlign:'center'},grid:{flexDirection:'row',flexWrap:'wrap',gap:12},tile:{width:'48%',flexGrow:1,backgroundColor:'#FFF3DF',borderRadius:24,padding:18,alignItems:'center',gap:12,borderWidth:2,borderColor:'transparent'},selectedTile:{borderColor:'#EAA340',backgroundColor:'#FFE8BC'},itemIcon:{fontSize:53,textAlign:'center'},tileTitle:{color:'#563B27',fontSize:17,fontWeight:'700',textAlign:'center'},price:{color:'#2D775C',fontWeight:'700',fontSize:14},chips:{gap:8,paddingVertical:4},chip:{paddingHorizontal:17,paddingVertical:13,backgroundColor:'#F9DAB3',borderRadius:18},chipSelected:{backgroundColor:'#F3AF4D'},chipText:{color:'#633823',fontWeight:'700'},roomDoor:{width:'78%',backgroundColor:'#EBA35B',padding:25,borderRadius:75,borderWidth:9,borderColor:'#9C542E',alignItems:'center',gap:8},roomIcon:{fontSize:49},roomHint:{color:'#71472A',textAlign:'center',lineHeight:19,fontSize:13},tunnel:{position:'absolute',left:'49%',top:60,bottom:40,width:18,backgroundColor:'#C58247',borderRadius:30},heroEmoji:{fontSize:110,textAlign:'center',paddingVertical:42},progress:{height:13,borderRadius:10,overflow:'hidden',backgroundColor:'#E7D6BB'},progressFill:{height:13,backgroundColor:'#D88748'},scrim:{flex:1,backgroundColor:'#1E100DBB',justifyContent:'flex-end',alignItems:'center'},sheet:{width:'100%',maxWidth:560,padding:30,paddingBottom:50,gap:18,backgroundColor:'#FFF2DD',borderTopLeftRadius:32,borderTopRightRadius:32},error:{padding:16,gap:10,backgroundColor:'#FFE2CE',margin:16,borderRadius:18},loading:{flex:1,alignItems:'center',justifyContent:'center'},busy:{position:'absolute',bottom:24,alignSelf:'center',backgroundColor:'#523727EE',padding:15,borderRadius:20,gap:8},
});
