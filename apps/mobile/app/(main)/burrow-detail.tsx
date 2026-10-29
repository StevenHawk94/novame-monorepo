import { Redirect, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { BurrowScreen, type BurrowSection } from '@/components/burrow/burrow-screen';
import { GameRoomScreen } from '@/components/burrow/game-room-screen';
import { CoupleJournalScreen } from '@/components/burrow/couple-journal-screen';
import { useMajorUpdateEnabled } from '@/lib/use-major-update';
import { useCallback } from 'react';
import { useBurrowSelector } from '@/lib/burrow-store';
import { SHOP_CATEGORIES } from '@novame/domain';
import { dismissToRetainedTab } from '@/lib/retained-tab-navigation';

const allowed:BurrowSection[]=['burrow','shop','moments','collection','adventure','affection','decorate','partner_room','our_room','friends_room','game_room','memories_room','carrot_shop'];
function RetainedTabDestination({section}:{section:BurrowSection}) {
  useFocusEffect(useCallback(()=>{
    dismissToRetainedTab(`/(main)/(tabs)/${section==='moments'?'friends':section}`);
  },[section]));
  // Old notifications/deep links still reach this alias. The parent gives it
  // no native animation; paint cached content until the canonical tab owns it.
  return <BurrowScreen section={section} asTab/>;
}
export default function BurrowDetail(){
  const enabled=useMajorUpdateEnabled();
  const params=useLocalSearchParams<{section?:string;roomType?:string;category?:string;inbox?:string;ownedOnly?:string;itemId?:string;ownerId?:string;journalPage?:string;giftTo?:string;giftFrom?:string}>();
  const section=allowed.includes(params.section as BurrowSection)?params.section as BurrowSection:'collection';
  const scope=useBurrowSelector(snapshot=>`${snapshot.data?.profile.id??''}:${snapshot.data?.partner?.id??''}:${snapshot.data?.pairVersion??''}`);
  // The mounted completion owns its narrow lock and releases it before its
  // own final pop. This route must not add a second, server-busy-based lock.
  if(!enabled)return <Redirect href="/(main)/(tabs)"/>;
  if(params.section==='self_care_room')return <RetainedTabDestination section="burrow"/>;
  if(section==='burrow'||section==='moments'||section==='collection'||(section==='shop'&&!params.giftTo&&!params.itemId&&!params.category&&!params.ownedOnly))
    return <RetainedTabDestination section={section}/>;
  if(section==='carrot_shop')return <Redirect href="/(main)/coin-shop"/>;
  if(section==='our_room')return <Redirect href="/(main)/surprise-room"/>;
  if(section==='game_room')return <GameRoomScreen/>;
  if(section==='memories_room')return <CoupleJournalScreen key={scope} initialPageId={params.journalPage}/>;
  return <BurrowScreen key={scope} section={section} roomType={params.roomType==='our'?'our':'home'}
    initialCategory={SHOP_CATEGORIES.find(category=>category===params.category)??'cushions'} initialInbox={params.inbox==='1'}
    ownedOnly={params.ownedOnly==='1'} initialItemId={params.itemId} collectionOwnerId={params.ownerId}
    giftRecipientId={params.giftTo} giftActorId={params.giftFrom}/>;
}
