import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import type { AffectionType } from '@novame/domain';
import { getProfileDefaultAvatar, isDefaultAvatarId } from '@/lib/avatar';
import { AFFECTION_COPY } from './affection-gesture';

type Person = { id: string; display_name: string | null; avatar_url: string | null };
export type DeliveryPhase = 'ready' | 'sending' | 'sent';

function Avatar({ person, fallback, size }: { person: Person | null; fallback: string; size: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [person?.avatar_url]);
  return <View style={[styles.person, { width: size + 13 }]}>
    <View style={[styles.avatarShell, { width: size, height: size, borderRadius: size / 2 }]}>
      <Image
        source={person?.avatar_url && !isDefaultAvatarId(person.avatar_url) && !failed
          ? { uri: person.avatar_url }
          : getProfileDefaultAvatar(person?.avatar_url, person?.id)}
        contentFit="cover"
        style={styles.avatar}
        onError={() => setFailed(true)}
      />
    </View>
    <Text style={styles.name} numberOfLines={1}>{person?.display_name ?? fallback}</Text>
  </View>;
}

/** The path stays empty at rest; one heart exists only during delivery. */
export function AffectionDelivery({ sender, recipient, type, phase, onTransitEnd }: {
  sender: Person; recipient: Person | null; type: AffectionType; phase: DeliveryPhase;
  onTransitEnd?: () => void;
}) {
  const { width } = useWindowDimensions();
  const avatarSize = Math.min(85, Math.max(59, width * .205));
  const [trailWidth, setTrailWidth] = useState(100);
  const [reduced, setReduced] = useState(false);
  const travel = useRef(new Animated.Value(0)).current;
  const ended = useRef(onTransitEnd); ended.current = onTransitEnd;
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (live) setReduced(value); });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { live = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    travel.stopAnimation(); travel.setValue(0);
    if (phase !== 'sending') return;
    if (reduced) { ended.current?.(); return; }
    const animation = Animated.timing(travel, { toValue: 1, duration: 980, useNativeDriver: true });
    animation.start(({ finished }) => { if (finished) ended.current?.(); });
    return () => animation.stop();
  }, [phase, reduced, travel]);
  const status = phase === 'ready' ? 'Ready to send' : phase === 'sending'
    ? `Your ${AFFECTION_COPY[type].label} is on its way` : `${AFFECTION_COPY[type].label} sent`;
  return <View style={styles.panel}>
    <Text style={styles.caption}>Across the distance</Text>
    <View style={styles.row}>
      <Avatar person={sender} fallback="You" size={avatarSize}/>
      <View style={styles.trail} onLayout={event => setTrailWidth(event.nativeEvent.layout.width)}
        accessible accessibilityLabel={phase === 'sending' ? 'Affection travelling to your person' : 'A path between you and your person'}>
        <View style={styles.dots}><Text numberOfLines={1} adjustsFontSizeToFit style={styles.dotsText}>•  •  •  •  •  •</Text><Text style={styles.arrow}>▶</Text></View>
        {phase === 'sending' && <Animated.Text style={[styles.travellingHeart, {
          opacity: travel.interpolate({ inputRange: [0, .76, 1], outputRange: [1, 1, 0] }),
          transform: [
            { translateX: travel.interpolate({ inputRange: [0, 1], outputRange: [0, Math.max(0, trailWidth - 31)] }) },
            { scale: travel.interpolate({ inputRange: [0, .65, 1], outputRange: [.8, 1.15, .35] }) },
          ],
        }]}>♥</Animated.Text>}
      </View>
      <Avatar person={recipient} fallback="Your person" size={avatarSize}/>
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
  dots: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' },
  dotsText: { flex: 1, color: '#FFF9F4', fontSize: 16, letterSpacing: -1, textAlign: 'center' },
  arrow: { color: '#FFF9F4', fontSize: 19, marginLeft: 2 },
  travellingHeart: { position: 'absolute', left: 0, top: 14, color: '#F95369', fontSize: 35, textShadowColor: '#FFF9F4', textShadowRadius: 12, textShadowOffset: { width: 0, height: 0 } },
  statusPill: { backgroundColor: '#FFF4F0', paddingHorizontal: 18, paddingVertical: 7, borderRadius: 24, maxWidth: '90%' },
  status: { color: '#A44854', fontSize: 15, fontWeight: '600', textAlign: 'center' },
});
