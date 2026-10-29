import { useCallback, useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBurrow } from '@/lib/burrow-store';
import { adventureIsAway, roomSlots } from '@/lib/burrow-presentation';
import { HomeArtScene } from './home-art-scene';
import { BurrowBackButton } from './burrow-back-button';
import { careCoolingDown, careCooldownMessage } from '@/lib/burrow-care-cooldown';
import { showBurrowToast } from '@/lib/burrow-toast';
import { showPartnerPairing } from '@/lib/partner-pairing';
import { openPreparedBurrow } from '@/lib/burrow-page-entry';
import {touchSnapshot} from '@/lib/plushie-touch-store';
import {PlushieTouchBadge} from './plushie-touch-badge';

export function PartnerRoomScreen() {
  const { data, loading, busy } = useBurrow(false,'partner_room');
  const insets = useSafeAreaInsets();
  const opening=useRef(false);
  const scope = `${data?.profile.id ?? ''}:${data?.partner?.id ?? ''}:${data?.pairVersion ?? ''}`;
  const slots = data?.partner ? roomSlots(data, data.partner.id) : {};
  const toyId = slots.couple_doll?.stable_id;
  useEffect(() => {opening.current=false;}, [scope,toyId]);
  useFocusEffect(useCallback(()=>{opening.current=false;},[scope]));
  if (!data?.partner) return <View style={[styles.empty,{paddingTop:insets.top+12}]}>
    <BurrowBackButton onPress={() => router.back()}/>
    <View style={styles.message}>{loading&&!data ? <ActivityIndicator color="#63321C"/> : <>
      <Text style={styles.copy}>Connect with your person to visit their room.</Text>
      <Pressable accessibilityRole="button" onPress={showPartnerPairing}><Text style={styles.link}>Connect with your person</Text></Pressable>
    </>}</View>
  </View>;
  const partner = data.partner;
  const openCare = (kind: 'food' | 'water') => {
    if(opening.current)return;
    if (careCoolingDown(data, kind, Date.now(), partner.id)) { showBurrowToast(careCooldownMessage(kind,partner.display_name?.trim()||'Your person')); return; }
    opening.current=true;
    router.push({pathname:'/(main)/room-interaction', params:{kind,ownerId:partner.id,actorId:data.profile.id,pairVersion:data.pairVersion}} as Href);
  };
  const showPhoto = () => {
    if(!toyId||opening.current)return;
    opening.current=true;
    const touches=touchSnapshot();
    const unread=touches.scope===`${data.profile.id}:${partner.id}:${data.pairVersion}`?touches.meta?.items.find(m=>m.recipient_id===data.profile.id&&!m.read_at&&!touches.seen.includes(m.id)&&touches.ready.includes(m.id)):undefined;
    if(unread){router.push({pathname:'/(main)/plushie-touch',params:{mode:'inbox',pairVersion:data.pairVersion,messageId:unread.id}});return;}
    router.push({pathname:'/(main)/room-interaction',params:{kind:'toy',ownerId:partner.id,actorId:data.profile.id,pairVersion:data.pairVersion}} as Href);
  };
  const noop = () => {};
  return <View style={styles.root}>
    <HomeArtScene timeZone={data.profile.timezone_name} balance={data.wallet.balance} slots={slots} photos={data.roomPhotos} ownerId={partner.id}
      away={adventureIsAway(data.partnerAdventure,Date.now())} busy={busy}
      partnerRoom={{name:partner.display_name?.trim()||'Your person',onBack:()=>router.back(),
        touchIndicator:<PlushieTouchBadge/>,
        onGift:()=>openPreparedBurrow({pathname:'/(main)/burrow-detail',params:{section:'shop',giftTo:partner.id,giftFrom:data.profile.id}} as Href),
        onSurprise:()=>openPreparedBurrow('/(main)/surprise-room')}}
      onToyInteract={showPhoto} onToyPhoto={showPhoto} onSlot={slot=>{
        if(slot==='bunny')openCare('food');
        else if(slot==='vase')openCare('water');
      }}
      onMenu={noop} onCarrots={noop} onAffection={noop} onAdventure={noop} onLetter={noop} onBurrows={noop} onDecorate={noop}/>
  </View>;
}
const styles=StyleSheet.create({root:{flex:1},empty:{flex:1,backgroundColor:'#FFF9EF',paddingHorizontal:20},
  message:{flex:1,alignItems:'center',justifyContent:'center',gap:18},copy:{fontSize:17,color:'#63321C',textAlign:'center'},
  link:{fontSize:16,color:'#8E4829',fontWeight:'700'}});
