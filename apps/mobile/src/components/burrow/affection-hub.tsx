import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import {AppModal as Modal} from '@/components/layout/app-modal';
import { useIsFocused } from '@react-navigation/native';
import { Image } from './burrow-image';
import { router, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AffectionType } from '@novame/domain';
import { freeAffectionUsedToday } from '@/lib/burrow-daily-entry';
import type { MajorUpdateBootstrap } from '@/lib/app-major-update-api';
import { markAffectionRead } from '@/lib/app-major-update-api';
import { BURROW_BACKGROUNDS } from '@/lib/burrow-art-assets';
import { burrowClock, receiveBurrowAffectionLocally, confirmReceivedAffections, refreshBurrow, runBurrowAction } from '@/lib/burrow-store';
import { BURROW_AFFECTION_ICONS } from '@/lib/burrow-ui-assets';
import { haptics } from '@/lib/haptics';
import { AFFECTION_COPY } from './affection-gesture';
import { BurrowBackButton } from './burrow-back-button';
import { AffectionLimitScreen } from './affection-limit-screen';
import { AffectionHeartBurst, AFFECTION_BURST_DURATION } from './affection-heart-burst';
import { requirePartner } from '@/lib/partner-pairing';
import { useBurrowAttention } from '@/lib/burrow-attention';
import {groupAffectionInbox,affectionReceivedCopy,type AffectionGroup} from '@/lib/affection-inbox';

const order: AffectionType[] = ['cuddle', 'kiss', 'miss_you', 'hug', 'spicy', 'gratitude'];

export function ReceiveModal({ visible, messages, partnerName, onClose, onReceive }: {
  visible: boolean; messages: AffectionGroup[]; partnerName: string;
  onClose: () => void; onReceive: (ids: string[]) => void;
}) {
  const [selected,setSelected]=useState<AffectionType|undefined>(()=>messages[0]?.affection_type);
  const [frozen,setFrozen]=useState<AffectionGroup|null>(null);
  const accepted=useRef(new Set<string>()),locked=useRef(false);
  const generation=useRef(0);
  const live=useRef(messages);live.current=messages;
  const [receiving, setReceiving] = useState(false);
  const burst = useRef(new Animated.Value(0)).current;
  useLayoutEffect(() => {generation.current++;
    if (visible) {accepted.current.clear();setSelected(messages[0]?.affection_type);setFrozen(null);locked.current=false;setReceiving(false);burst.setValue(0);}
    return()=>{generation.current++;burst.stopAnimation();};
  }, [visible]);
  const queue=messages.map(g=>({...g,ids:g.ids.filter(id=>!accepted.current.has(id))})).filter(g=>g.ids.length);
  const message = frozen??queue.find(g=>g.affection_type===selected)??queue[0];
  function receive() {
    if (!message || locked.current) return;
    locked.current=true;
    const version=generation.current;
    const batch={...message,ids:[...message.ids]};setFrozen(batch);
    batch.ids.forEach(id=>accepted.current.add(id));
    setReceiving(true);
    void haptics.medium().catch(() => {});
    onReceive(batch.ids);
    burst.setValue(0);
    Animated.timing(burst, { toValue: 1, duration: AFFECTION_BURST_DURATION, useNativeDriver: true }).start(({ finished }) => {
      if (!finished||version!==generation.current) return;
      const next=live.current.find(g=>g.ids.some(id=>!accepted.current.has(id)));
      setFrozen(null);setSelected(next?.affection_type);locked.current=false;setReceiving(false);burst.setValue(0);
      if(!next)onClose();
    });
  }
  if (!message) return null;
  const type = message.affection_type;
  const copy=affectionReceivedCopy(type,partnerName,message.ids.length);
  return <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose} presentationStyle="overFullScreen">
    <View style={styles.scrim}>
      <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose}/>
      <View style={styles.receiveCard} accessibilityViewIsModal>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.close}><Text style={styles.closeText}>×</Text></Pressable>
        <Image source={BURROW_AFFECTION_ICONS[type]} contentFit="contain" style={styles.receiveIcon}/>
        <Text style={styles.receiveTitle}>{copy.title}</Text>
        <Text style={styles.receiveSubtitle}>{copy.body}</Text>
        <Pressable accessibilityRole="button" disabled={receiving} onPress={receive} style={[styles.receiveButton, receiving && { opacity: .7 }]}><Text style={styles.receiveButtonText}>{receiving ? 'Receiving…' : 'Receive'}</Text></Pressable>
        {queue.length > 1 && <Text style={styles.queueCount}>{queue.length} little moments waiting</Text>}
      </View>
      {receiving && <View pointerEvents="none" style={styles.burstLayer}>
        <AffectionHeartBurst progress={burst}/>
      </View>}
    </View>
  </Modal>;
}

export const AffectionHub=memo(function AffectionHub({ data, loading, initialInbox = false,receivedAt:received }: {
  data: MajorUpdateBootstrap | null; loading: boolean; initialInbox?: boolean;receivedAt?:number;
}) {
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const { width } = useWindowDimensions();
  const firstClock=useRef(burrowClock()),receivedAt=received??firstClock.current;
  const [now, setNow] = useState(burrowClock());
  const updates=useBurrowAttention(data,undefined,'affection');
  const [inbox, setInbox] = useState(()=>initialInbox&&!!data?.affectionInbox.length);
  const openedInitial = useRef(initialInbox&&!!data?.affectionInbox.length);
  useEffect(() => {
    if (!focused) return;
    const tick = () => { if (AppState.currentState === 'active') setNow(burrowClock()); };
    tick();
    const interval = setInterval(tick, 1000);
    const sub = AppState.addEventListener('change', tick);
    return () => { clearInterval(interval); sub.remove(); };
  }, [focused]);
  useLayoutEffect(() => {
    if (!initialInbox || openedInitial.current || !data?.affectionInbox.length) return;
    openedInitial.current = true;
    if (data.affectionInbox.length) setInbox(true);
  }, [initialInbox, data]);
  const projectedNow = data ? Date.parse(data.serverNow) + Math.max(0, now - receivedAt) : now;
  const dailyUsed = freeAffectionUsedToday(data, projectedNow);
  const tileWidth = Math.min(240, (width - 54) / 2);
  const tileHeight = Math.min(166, Math.max(120, tileWidth * .78));
  function choose(type: AffectionType) {
    if (requirePartner(data)) return;
    if (dailyUsed) return;
    router.push({ pathname: '/(main)/affection-detail', params: { type } } as Href);
  }
  function receive(ids: string[]) {
    receiveBurrowAffectionLocally(ids);
    void runBurrowAction(`receive-affection:${ids.join(',')}`, async() => {
      // Exact membership freezes at the tap. Transport chunks are not a
      // user allowance and cannot acknowledge a later arriving affection.
      for(let i=0;i<ids.length;i+=100)await markAffectionRead(ids.slice(i,i+100));
    }, { silent: true }).then(ok => {
      confirmReceivedAffections(ids,ok);
      if (!ok) {
        void refreshBurrow({ silent: true });
        Alert.alert('Could not receive yet', 'Your connection is having trouble. This affection will appear again so you can retry.');
      }
    });
  }
  if(dailyUsed) return <View style={styles.root}>
    <AffectionLimitScreen hasPlus={data?.hasPlus} unreadCount={updates.affection} onInbox={()=>setInbox(true)}/>
    {data && <ReceiveModal visible={focused&&inbox} messages={groupAffectionInbox(data)} partnerName={data.partner?.display_name ?? 'Your person'}
      onClose={()=>setInbox(false)} onReceive={receive}/>}
  </View>;
  return <View style={styles.root}>
    <Image source={BURROW_BACKGROUNDS.affectionSend} contentFit="cover" contentPosition="top" style={StyleSheet.absoluteFillObject}/>
    <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 30 }]} showsVerticalScrollIndicator={false}>
      <View style={styles.top}><BurrowBackButton onPress={() => router.back()}/>
        {data && updates.affection > 0 && <Pressable accessibilityRole="button" accessibilityLabel={`${updates.affection} unread affection`} onPress={() => setInbox(true)} style={styles.inboxBadge}><Text style={styles.inboxBadgeText}>{updates.affection}</Text></Pressable>}
      </View>
      <Text style={styles.title}>Send a little love</Text>
      <Text style={styles.subtitle}>What do you want to send to {data?.partner?.display_name ?? 'your person'}?</Text>
      {!data ? <View style={styles.loading}>{loading ? <ActivityIndicator color="#FFF7F1"/> : <Pressable onPress={() => void refreshBurrow()}><Text style={styles.subtitle}>Your burrow could not load. Tap to retry.</Text></Pressable>}</View>
        : <View style={styles.grid}>{order.map(type => <Pressable key={type} accessibilityRole="button" accessibilityLabel={`Send ${AFFECTION_COPY[type].label}`} onPress={() => choose(type)}
          style={({ pressed }) => [styles.tile, { width: tileWidth, height: tileHeight }, pressed && { opacity: .76 }]}>
          <Image source={BURROW_AFFECTION_ICONS[type]} contentFit="contain" style={{ width: tileHeight * .54, height: tileHeight * .54 }}/>
          <Text style={styles.tileLabel}>{AFFECTION_COPY[type].label}</Text>
        </Pressable>)}</View>}
    </ScrollView>
    {data && <ReceiveModal visible={focused&&inbox} messages={groupAffectionInbox(data)} partnerName={data.partner?.display_name ?? 'Your person'} onClose={() => setInbox(false)} onReceive={receive}/>}
  </View>;
});

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
