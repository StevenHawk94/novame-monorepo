import { Redirect, useLocalSearchParams } from 'expo-router';
import { BurrowScreen, type BurrowSection } from '@/components/burrow/burrow-screen';
import { GameRoomScreen } from '@/components/burrow/game-room-screen';
import { useMajorUpdateEnabled } from '@/lib/use-major-update';
import { useCallback } from 'react';
import { usePreventRemove } from '@react-navigation/native';
import { Alert } from 'react-native';
import { useBurrowSnapshot } from '@/lib/burrow-store';
import { adventureNeedsCompletion } from '@/lib/burrow-presentation';
import { SHOP_CATEGORIES } from '@novame/domain';

const allowed:BurrowSection[]=['collection','adventure','affection','decorate','partner_room','our_room','friends_room','game_room','memories_room','self_care_room','carrot_shop'];
export default function BurrowDetail(){
  const enabled=useMajorUpdateEnabled();
  const params=useLocalSearchParams<{section?:string;roomType?:string;category?:string}>();
  const {data,busy,error}=useBurrowSnapshot();
  const section=allowed.includes(params.section as BurrowSection)?params.section as BurrowSection:'collection';
  const blocked=enabled&&section==='adventure'&&!['not_paired','feature_disabled'].includes(error??'')
    &&(busy||adventureNeedsCompletion(data?.activeAdventure));
  // Prevent pop/back/swipe, not pushes: a matching Rage battle can cover this
  // route and return to it without discarding the required interaction.
  usePreventRemove(blocked,useCallback(()=>{
    Alert.alert('Finish your adventure','Claim your treasure and finish your friend’s story first. You can choose Not now when a friend asks for help.');
  },[]));
  if(!enabled)return <Redirect href="/(main)/(tabs)"/>;
  if(section==='game_room')return <GameRoomScreen/>;
  return <BurrowScreen section={section} roomType={params.roomType==='our'?'our':'home'}
    initialCategory={SHOP_CATEGORIES.find(category=>category===params.category)??'windows'}/>;
}
