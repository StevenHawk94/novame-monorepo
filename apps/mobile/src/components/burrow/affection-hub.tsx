import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Path } from 'react-native-svg';
import { router, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AffectionType } from '@novame/domain';
import { affectionCooldownRemainingMs } from '@novame/engine';
import type { MajorUpdateBootstrap } from '@/lib/app-major-update-api';
import { markAffectionRead } from '@/lib/app-major-update-api';
import { BURROW_BACKGROUNDS } from '@/lib/burrow-art-assets';
import { burrowClock, receiveBurrowAffectionLocally, refreshBurrow, runBurrowAction, useBurrowSnapshot } from '@/lib/burrow-store';
import { BURROW_AFFECTION_ICONS } from '@/lib/burrow-ui-assets';
import { haptics } from '@/lib/haptics';
import { AFFECTION_COPY } from './affection-gesture';
import { BurrowBackButton } from './burrow-back-button';

type Message = MajorUpdateBootstrap['affectionInbox'][number];
const order: AffectionType[] = ['cuddle', 'kiss', 'miss_you', 'hug', 'spicy', 'gratitude'];
const burstHearts = [
  [-86, -76, 19], [-46, -103, 25], [3, -94, 18], [59, -86, 22], [90, -38, 20],
  [-103, -16, 22], [-70, 43, 20], [-24, 76, 26], [36, 80, 18], [82, 45, 24],
  [-28, -31, 17], [29, -35, 22], [0, 20, 24], [-52, 7, 15], [58, 5, 17],
] as const;

function MissYouIcon({ size }: { size: number }) {
  return <Svg width={size} height={size} viewBox="0 0 100 100" accessible={false}>
    <Path d="M20 14 C12 29 12 49 20 65 C32 88 61 91 80 73 C62 79 44 72 37 56 C29 39 36 23 51 15 C39 9 28 10 20 14Z" fill="#FFC74E"/>
    <Path d="M64 43 C58 34 46 39 47 49 C48 57 58 63 64 69 C70 63 80 57 81 49 C82 39 70 34 64 43Z" fill="#F55C62"/>
    <Path d="M83 13 L86 21 L94 24 L86 27 L83 35 L80 27 L72 24 L80 21Z M13 58 L15 64 L21 66 L15 68 L13 74 L11 68 L5 66 L11 64Z M86 69 L88 74 L93 76 L88 78 L86 83 L84 78 L79 76 L84 74Z" fill="#FFC247"/>
  </Svg>;
}

function ReceiveModal({ visible, messages, partnerName, onClose, onReceive }: {
  visible: boolean; messages: Message[]; partnerName: string;
  onClose: () => void; onReceive: (id: string) => void;
}) {
  const [queue, setQueue] = useState<Message[]>([]);
  const [receiving, setReceiving] = useState(false);
  const burst = useRef(new Animated.Value(0)).current;
  useEffect(() => { if (visible) { setQueue(messages); setReceiving(false); burst.setValue(0); } }, [visible]);
  const message = queue[0];
  function receive() {
    if (!message || receiving) return;
    setReceiving(true);
    void haptics.medium().catch(() => {});
    onReceive(message.id);
    burst.setValue(0);
    Animated.timing(burst, { toValue: 1, duration: 960, useNativeDriver: true }).start(({ finished }) => {
      if (!finished) return;
      if (queue.length <= 1) onClose();
      else { setQueue(previous => previous.slice(1)); setReceiving(false); burst.setValue(0); }
    });
  }
  if (!message) return null;
  const type = message.affection_type;
  return <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose} presentationStyle="overFullScreen">
    <View style={styles.scrim}>
      <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose}/>
      <View style={styles.receiveCard} accessibilityViewIsModal>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.close}><Text style={styles.closeText}>×</Text></Pressable>
        {type === 'miss_you' ? <View style={styles.receiveIcon}><MissYouIcon size={125}/></View>
          : <Image source={BURROW_AFFECTION_ICONS[type]} contentFit="contain" style={styles.receiveIcon}/>}
        <Text style={styles.receiveTitle}>{partnerName} sent you {type === 'miss_you' ? 'a Miss You' : type === 'spicy' ? 'some Spice' : type === 'gratitude' ? 'Gratitude' : `a ${AFFECTION_COPY[type].label}`}</Text>
        <Text style={styles.receiveSubtitle}>A little love, just for you.</Text>
        <Pressable accessibilityRole="button" disabled={receiving} onPress={receive} style={[styles.receiveButton, receiving && { opacity: .7 }]}><Text style={styles.receiveButtonText}>{receiving ? 'Receiving…' : 'Receive'}</Text></Pressable>
        {queue.length > 1 && <Text style={styles.queueCount}>{queue.length} little moments waiting</Text>}
      </View>
      {receiving && <View pointerEvents="none" style={styles.burstLayer}>
        {burstHearts.map(([x, y, size], index) => <Animated.Text key={index} style={{ position: 'absolute', left: '50%', top: '50%', color: '#F25D6F', fontSize: size,
          opacity: burst.interpolate({ inputRange: [0, .2, .75, 1], outputRange: [0, 1, 1, 0] }),
          transform: [
            { translateX: burst.interpolate({ inputRange: [0, 1], outputRange: [0, x] }) },
            { translateY: burst.interpolate({ inputRange: [0, 1], outputRange: [0, y] }) },
            { scale: burst.interpolate({ inputRange: [0, .5, 1], outputRange: [.35, 1.3, .75] }) },
          ],
        }}>♥</Animated.Text>)}
      </View>}
    </View>
  </Modal>;
}

export function AffectionHub({ data, loading, initialInbox = false }: {
  data: MajorUpdateBootstrap | null; loading: boolean; initialInbox?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { receivedAt } = useBurrowSnapshot();
  const [now, setNow] = useState(burrowClock());
  const [inbox, setInbox] = useState(false);
  const openedInitial = useRef(false);
  useEffect(() => {
    const interval = setInterval(() => setNow(burrowClock()), 1000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    if (!initialInbox || openedInitial.current || !data) return;
    openedInitial.current = true;
    if (data.affectionInbox.length) setInbox(true);
  }, [initialInbox, data]);
  const projectedNow = data ? Date.parse(data.serverNow) + Math.max(0, now - receivedAt) : now;
  const cooldown = data ? affectionCooldownRemainingMs(data.lastAffectionAt ? Date.parse(data.lastAffectionAt) : null, projectedNow, data.hasPlus) : 0;
  const tileWidth = Math.min(240, (width - 54) / 2);
  const tileHeight = Math.min(166, Math.max(120, tileWidth * .78));
  function choose(type: AffectionType) {
    if (!data?.partner) { Alert.alert('Connect first', 'Connect with your person to send them affection.'); return; }
    if (cooldown > 0) {
      Alert.alert('A little pause', `Your next free affection is ready in ${Math.ceil(cooldown / 60000)} minutes.`);
      return;
    }
    router.push({ pathname: '/(main)/affection-detail', params: { type } } as Href);
  }
  function receive(id: string) {
    receiveBurrowAffectionLocally(id);
    void runBurrowAction(`receive-affection:${id}`, () => markAffectionRead([id]), { silent: true }).then(ok => {
      if (!ok) {
        void refreshBurrow({ silent: true });
        Alert.alert('Could not receive yet', 'Your connection is having trouble. This affection will appear again so you can retry.');
      }
    });
  }
  return <View style={styles.root}>
    <Image source={BURROW_BACKGROUNDS.affectionSelect} contentFit="cover" contentPosition="top" style={StyleSheet.absoluteFillObject}/>
    <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 30 }]} showsVerticalScrollIndicator={false}>
      <View style={styles.top}><BurrowBackButton onPress={() => router.back()}/>
        {data && data.unread.affection > 0 && <Pressable accessibilityRole="button" accessibilityLabel={`${data.unread.affection} unread affection`} onPress={() => setInbox(true)} style={styles.inboxBadge}><Text style={styles.inboxBadgeText}>{data.unread.affection}</Text></Pressable>}
      </View>
      <Text style={styles.title}>Send a little love</Text>
      <Text style={styles.subtitle}>What do you want to send to {data?.partner?.display_name ?? 'your person'}?</Text>
      {!data ? <View style={styles.loading}>{loading ? <ActivityIndicator color="#FFF7F1"/> : <Pressable onPress={() => void refreshBurrow()}><Text style={styles.subtitle}>Your burrow could not load. Tap to retry.</Text></Pressable>}</View>
        : <View style={styles.grid}>{order.map(type => <Pressable key={type} accessibilityRole="button" accessibilityLabel={`Send ${AFFECTION_COPY[type].label}`} onPress={() => choose(type)}
          style={({ pressed }) => [styles.tile, { width: tileWidth, height: tileHeight }, pressed && { opacity: .76 }]}>
          {type === 'miss_you'
            ? <MissYouIcon size={tileHeight * .54}/>
            : <Image source={BURROW_AFFECTION_ICONS[type]} contentFit="contain" style={{ width: tileHeight * .54, height: tileHeight * .54 }}/>}
          <Text style={styles.tileLabel}>{AFFECTION_COPY[type].label}</Text>
        </Pressable>)}</View>}
      {cooldown > 0 && !!data?.partner && <Text style={styles.cooldown}>Next free affection in {Math.ceil(cooldown / 60000)} min · Plus has no wait</Text>}
    </ScrollView>
    {data && <ReceiveModal visible={inbox} messages={data.affectionInbox} partnerName={data.partner?.display_name ?? 'Your person'} onClose={() => setInbox(false)} onReceive={receive}/>}
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#7A4738' },
  scroll: { flex: 1 },
  content: { width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: 20, flexGrow: 1 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 50 },
  inboxBadge: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#E94754', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFF7F1' },
  inboxBadgeText: { color: '#FFF', fontWeight: '800', fontSize: 18 },
  title: { color: '#FFF8F1', fontSize: 29, fontWeight: '800', marginTop: 24 },
  subtitle: { color: '#FFF3E9', fontSize: 18, lineHeight: 25, marginTop: 9, marginBottom: 22 },
  loading: { minHeight: 250, justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, justifyContent: 'space-between' },
  tile: { backgroundColor: '#FFF8F0', borderRadius: 18, alignItems: 'center', justifyContent: 'center', gap: 8 },
  tileLabel: { color: '#4F3327', fontSize: 18, fontWeight: '800' },
  cooldown: { color: '#FFF5EF', textAlign: 'center', fontSize: 14, marginTop: 18 },
  scrim: { flex: 1, backgroundColor: '#2516129C', justifyContent: 'center', paddingHorizontal: 24 },
  receiveCard: { backgroundColor: '#FFF9F3', borderRadius: 25, paddingHorizontal: 24, paddingTop: 28, paddingBottom: 25, alignItems: 'center', gap: 14 },
  close: { position: 'absolute', right: 14, top: 9, width: 34, height: 34, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  closeText: { color: '#4C2B22', fontSize: 34, lineHeight: 36 },
  receiveIcon: { width: 125, height: 125 },
  receiveTitle: { color: '#201310', fontSize: 23, lineHeight: 30, fontWeight: '800', textAlign: 'center' },
  receiveSubtitle: { color: '#4C2B22', fontSize: 17, textAlign: 'center' },
  receiveButton: { width: '100%', minHeight: 55, backgroundColor: '#633B32', borderRadius: 27, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  receiveButtonText: { color: '#FFF9F3', fontSize: 20, fontWeight: '800' },
  queueCount: { color: '#9F756C', fontSize: 13 },
  burstLayer: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
});
