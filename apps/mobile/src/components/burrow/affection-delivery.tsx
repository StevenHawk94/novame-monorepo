import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, StyleSheet, Text, View } from 'react-native';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import { Image } from './burrow-image';
import Svg, { Line, Path } from 'react-native-svg';
import type { AffectionType } from '@novame/domain';
import {UserAvatar} from '@/components/ui/user-avatar';
import { AFFECTION_COPY } from './affection-gesture';

type Person = { id: string; display_name: string | null; avatar_url: string | null; is_default_avatar?:boolean|null };
export type DeliveryPhase = 'ready' | 'sending' | 'sent';
export const AFFECTION_TRANSIT_MS = 1850;
const transitClock=()=>typeof performance!=='undefined'?performance.now():Date.now();

function Avatar({ person, fallback, size,otherUserId }: { person: Person | null; fallback: string; size: number;otherUserId?:string }) {
  return <View style={[styles.person, { width: size + 13 }]}>
    <View style={[styles.avatarShell, { width: size, height: size, borderRadius: size / 2 }]}>
      <UserAvatar userId={person?.id} name={person?.display_name} avatarUrl={person?.avatar_url} isDefaultAvatar={person?.is_default_avatar} otherUserId={otherUserId} size={size-8}/>
    </View>
    <Text style={styles.name} numberOfLines={1}>{person?.display_name ?? fallback}</Text>
  </View>;
}

/** The path stays empty at rest; one heart exists only during delivery. */
export function AffectionDelivery({ sender, recipient, type, phase, deliveryId, onTransitEnd }: {
  sender: Person; recipient: Person | null; type: AffectionType; phase: DeliveryPhase;
  deliveryId?: string;
  onTransitEnd?: () => void;
}) {
  const { width } = useWindowDimensions();
  const avatarSize = Math.min(85, Math.max(59, width * .205));
  const [trailWidth, setTrailWidth] = useState(100);
  const [reduced, setReduced] = useState(false);
  const travel = useRef(new Animated.Value(0)).current;
  const ended = useRef(onTransitEnd); ended.current = onTransitEnd;
  const transit = useRef<{id:string;startedAt:number;ended:boolean}|null>(null);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (live) setReduced(value); });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { live = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    travel.stopAnimation(); travel.setValue(0);
    if (phase !== 'sending') { if(phase==='ready')transit.current=null; return; }
    const id=deliveryId??type;
    if(transit.current?.id!==id)transit.current={id,startedAt:transitClock(),ended:false};
    const current=transit.current;
    let live=true;
    const complete=()=>{
      if(!live||current.ended||transit.current!==current||AppState.currentState!=='active')return;
      current.ended=true;travel.stopAnimation();travel.setValue(1);ended.current?.();
    };
    if(current.ended){travel.setValue(1);return;}
    const remaining=Math.max(0,AFFECTION_TRANSIT_MS-(transitClock()-current.startedAt));
    if(reduced||remaining===0){complete();}
    else travel.setValue(1-remaining/AFFECTION_TRANSIT_MS);
    const animation = Animated.timing(travel, {
      toValue: 1, duration: remaining, easing: Easing.bezier(.34, .04, .57, 1), useNativeDriver: true,
    });
    if(!current.ended)animation.start(({ finished }) => { if (finished) complete(); });
    // An interrupted native animation must not strand the screen. This only
    // completes presentation; it never manufactures a server/coin receipt.
    const fallback=setTimeout(complete,remaining+200);
    const subscription=AppState.addEventListener('change',state=>{
      if(state==='active'&&(reduced||transitClock()-current.startedAt>=AFFECTION_TRANSIT_MS))complete();
    });
    return () => {live=false;clearTimeout(fallback);subscription.remove();animation.stop();};
  }, [phase, deliveryId, type, reduced, travel]);
  const status = phase === 'ready' ? 'Ready to send' : phase === 'sending'
    ? `Your ${AFFECTION_COPY[type].label} is on its way` : `${AFFECTION_COPY[type].label} sent`;
  return <View style={styles.panel}>
    <Text style={styles.caption}>Across the distance</Text>
    <View style={styles.row}>
      <Avatar person={sender} otherUserId={recipient?.id} fallback="You" size={avatarSize}/>
      <View style={styles.trail} onLayout={event => setTrailWidth(event.nativeEvent.layout.width)}
        accessible accessibilityLabel={phase === 'sending' ? 'Affection travelling to your person' : 'A path between you and your person'}>
        <Svg width="100%" height={70} viewBox={`0 0 ${trailWidth} 70`} pointerEvents="none">
          <Line x1={4} y1={35} x2={trailWidth - 14} y2={35} stroke="#FFF9F4" strokeWidth={6} strokeDasharray="1 13" strokeLinecap="round"/>
          <Line x1={trailWidth - 20} y1={35} x2={trailWidth - 12} y2={35} stroke="#FFF9F4" strokeWidth={3}/>
          <Path d={`M${trailWidth - 13} 25 L${trailWidth} 35 L${trailWidth - 13} 45 Z`} fill="#FFF9F4"/>
        </Svg>
        {phase === 'sending' && <Animated.Text style={[styles.travellingHeart, {
          opacity: travel.interpolate({ inputRange: [0, .08, .83, 1], outputRange: [0, 1, 1, 0] }),
          transform: [
            { translateX: travel.interpolate({ inputRange: [0, 1], outputRange: [-(avatarSize + 13) / 2 - 28, trailWidth + (avatarSize + 13) / 2 - 28] }) },
            { translateY: travel.interpolate({ inputRange: [0, .13, .44, .68, .87, 1], outputRange: [0, -21, -65, -54, -25, 0] }) },
            { scale: travel.interpolate({ inputRange: [0, .11, .32, .57, .78, .94, 1], outputRange: [.55, 1.27, 1.06, 1.19, 1.02, 1.16, .52] }) },
          ],
        }]}>♥</Animated.Text>}
      </View>
      <Avatar person={recipient} otherUserId={sender.id} fallback="Your person" size={avatarSize}/>
    </View>
    <View style={styles.statusPill}><Text style={styles.status}>{status}</Text></View>
  </View>;
}

const styles = StyleSheet.create({
  panel: { width: '100%', alignItems: 'center', gap: 12 },
  caption: { color: '#FFF8F5', fontSize: 17, fontWeight: '500' },
  row: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 },
  person: { alignItems: 'center', gap: 5 },
  avatarShell: { borderWidth: 4, borderColor: '#FFF9F4', overflow: 'hidden', justifyContent: 'center', alignItems: 'center', backgroundColor: '#E9ADA9' },
  avatar: { width: '100%', height: '100%' },
  name: { color: '#FFF9F4', fontSize: 14, fontWeight: '700', textAlign: 'center', maxWidth: '100%' },
  trail: { flex: 1, minWidth: 65, height: 70, justifyContent: 'center' },
  travellingHeart: { position: 'absolute', left: 0, top: -20, color: '#F95376', fontSize: 56, textShadowColor: '#E94A73', textShadowRadius: 10, textShadowOffset: { width: 0, height: 0 } },
  statusPill: { backgroundColor: '#FFF4F0', paddingHorizontal: 18, paddingVertical: 7, borderRadius: 24, maxWidth: '90%' },
  status: { color: '#A44854', fontSize: 15, fontWeight: '600', textAlign: 'center' },
});
