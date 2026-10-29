import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BackHandler, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import { Image } from 'expo-image';
import { useNavigation, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useIsFocused, usePreventRemove } from '@react-navigation/native';
import { presentAdventureJournalReward, requestAdventureJournalStart, retryAdventureJournalJob, useAdventureJournalJob } from '@/lib/adventure-journal-jobs';
import { ADVENTURE_LOG_BACKGROUND } from '@/lib/burrow-surface';
import { useBunnyVariant } from '@/lib/bunny-identity';
import { ReflectCelebration } from '@/components/main/reflect-celebration';
import { AdventureReveal } from './adventure-reveal';
import { openStartedAdventure } from '@/lib/adventure-navigation';
import { HORIZONTAL_EDGE_BACK_OPTIONS } from '@/lib/page-edge-gesture';
const PINKY_READY = require('../../../assets/burrow-webp/adventure-page/pinky.webp');
const BISCUIT_READY = require('../../../assets/burrow-webp/adventure-page/biscuit.webp');

export function AdventureReady({ onStart, onLoggedVisible, disabled = false, allowNavigation = false }: { onStart: () => void; onLoggedVisible?:()=>void; disabled?: boolean; allowNavigation?: boolean }) {
  const navigation = useNavigation();
  const focused = useIsFocused();
  const variant = useBunnyVariant();
  // This committed record must continue into Adventure, including restored
  // ready records. Do not carry the restriction into the ongoing page.
  usePreventRemove(focused && !allowNavigation, () => {});
  useLayoutEffect(() => {
    if (!focused) return;
    navigation.setOptions({ ...HORIZONTAL_EDGE_BACK_OPTIONS, gestureEnabled: false });
    return () => navigation.setOptions(HORIZONTAL_EDGE_BACK_OPTIONS);
  }, [navigation, focused]);
  useFocusEffect(useCallback(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => !allowNavigation);
    return () => back.remove();
  }, [allowNavigation]));
  return <View style={s.ready}>
    <View style={s.message}>
    <Image source={variant==='pinky'?PINKY_READY:BISCUIT_READY} contentFit="contain" style={s.bunny} />
    <AdventureReveal onVisible={onLoggedVisible}><Text accessibilityRole="header" style={s.title}>Your day has been logged!</Text></AdventureReveal>
    <AdventureReveal delay={180}><Text style={s.description}>Your bunny has picked up the trail of your day and is ready for an adventure.</Text></AdventureReveal>
    </View>
    <AdventureReveal delay={300} style={{alignSelf:"stretch"}}><Pressable accessibilityRole="button" disabled={disabled} onPress={onStart} style={({pressed})=>[s.start,pressed&&!disabled&&{transform:[{translateY:4}],shadowOpacity:0,opacity:.9}]}>
      <Text style={s.startText}>Start Adventure</Text>
    </Pressable></AdventureReveal>
  </View>;
}

/** The local journal receipt owns this screen. Upload completion never navigates. */
export function AdventureRecordCompletion({ jobId }: { jobId: string }) {
  const router = useRouter(), navigation = useNavigation(), insets = useSafeAreaInsets();
  const job = useAdventureJournalJob(jobId);
  const startLock = useRef(false);
  const navigationSent = useRef(false);
  const [starting, setStarting] = useState(false);
  const [localError, setLocalError] = useState(false);
  // Commit the removal-guard change before replace/dismiss, otherwise native
  // navigation would also block the one permitted Start Adventure action.
  useEffect(() => {
    if (!starting || navigationSent.current) return;
    navigationSent.current = true;
    openStartedAdventure(router, navigation.getState());
  }, [starting, router, navigation]);
  function start() {
    if (startLock.current) return;
    try { if (!requestAdventureJournalStart(jobId)) { setLocalError(true); return; } }
    catch { setLocalError(true); return; }
    startLock.current = true;
    setStarting(true);
  }
  return <View style={s.root}>
    <ScrollView contentContainerStyle={[s.scroll, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 30 }]}>
      <AdventureReady onStart={start} onLoggedVisible={()=>presentAdventureJournalReward(jobId)} disabled={starting} allowNavigation={starting} />
      {localError&&<Text accessibilityRole="alert" style={s.description}>Couldn’t save the start on this device. Please try again.</Text>}
      {job?.blocked && <Pressable accessibilityRole="button" onPress={() => retryAdventureJournalJob(jobId)}>
        <Text accessibilityRole="alert" style={s.description}>Your day is saved on this device. Tap to retry syncing.</Text>
      </Pressable>}
    </ScrollView>
    <ReflectCelebration active />
  </View>;
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: ADVENTURE_LOG_BACKGROUND }, scroll: { flexGrow: 1, padding: 20 },
  ready: { flex: 1, minHeight: 500, alignItems: 'center', backgroundColor:ADVENTURE_LOG_BACKGROUND },
  message: {flex:1,alignSelf:'stretch',alignItems:'center',justifyContent:'center',gap:20,paddingVertical:30},
  title: { color: '#FFF9EF', fontSize: 26, lineHeight: 34, fontWeight: '800', textAlign: 'center' },
  description: { color: '#FFF9EF', fontSize: 18, lineHeight: 27, textAlign: 'center', maxWidth: 430 },
  bunny: { width: '34%', maxWidth: 160, aspectRatio:5/6 },
  start: { alignSelf: 'stretch', backgroundColor: '#FFC746', padding: 20, borderRadius: 25, alignItems: 'center', marginTop: 18,
    shadowColor: '#E7843C', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 1, shadowRadius: 0, elevation: 3 },
  startText: { color: '#74421C', fontSize: 22, fontWeight: '800' },
});
