import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import {AppModal as Modal} from '@/components/layout/app-modal';
import { Image } from './burrow-image';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { randomUUID } from 'expo-crypto';
import type { AffectionType } from '@novame/domain';
import type { MajorUpdateBootstrap } from '@/lib/app-major-update-api';
import { BURROW_BACKGROUNDS } from '@/lib/burrow-art-assets';
import { burrowClock, burrowErrorMessage, enqueueBurrowAffection, getBurrowSnapshot, useBurrow } from '@/lib/burrow-store';
import { coinOperations } from '@/lib/coin-command-outbox';
import { questScope } from '@/lib/quest-progress-model';
import { freeAffectionUsedToday } from '@/lib/burrow-daily-entry';
import { AffectionLimitScreen } from './affection-limit-screen';
import { AffectionDelivery, type DeliveryPhase } from './affection-delivery';
import { AFFECTION_COPY, AffectionGesture } from './affection-gesture';
import { BurrowBackButton } from './burrow-back-button';
import { releaseCoinReward } from '@/lib/coin-reward-store';
import { usePageBackGesture } from '@/lib/use-page-back-gesture';
import { recordRatingMilestone, registerInlineAffectionRating } from '@/lib/official-rating-milestones';
import { registerOverlay } from '@/lib/overlay-presence';

function sendErrorMessage(error:unknown){
  const failure=error as {message?:string;body?:{error?:string}};
  const code=failure?.body?.error??failure?.message??'network_error';
  if(code==='daily_limit_reached')return 'You’ve reached today’s affection limit. Come back after your local midnight.';
  if(code==='intent_not_saved')return 'Your send could not be saved on this device. Please try again.';
  return burrowErrorMessage(code);
}

export function AffectionDetailScreen({ type }: { type: AffectionType }) {
  const { data, receivedAt } = useBurrow(false,'affection');
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [phase, setPhase] = useState<DeliveryPhase>('ready');
  const [server, setServer] = useState<'idle' | 'queued' | 'success' | 'error'>('idle');
  const [transitEnded, setTransitEnded] = useState(false);
  const [help, setHelp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const metrics = useRef<Record<string, number> | null>(null);
  const operation = useRef<string | null>(null);
  const sendScope = useRef<MajorUpdateBootstrap | null>(null);
  const attempt = useRef(false);
  const rewardDelivery = useRef<string | null>(null);
  const ratingReceipt = useRef<string | null>(null);
  const closing = useRef(false);
  const compact = height < 740;
  const cardHeight = Math.max(350, Math.min(520, height * (compact ? .51 : .48)));
  const ready = !!data?.partner;
  const dailyUsed = freeAffectionUsedToday(data, data ? Date.parse(data.serverNow) + Math.max(0, burrowClock() - receivedAt) : 0);
  usePageBackGesture(phase !== 'sending');

  useEffect(() => {
    if ((server === 'queued' || server === 'success') && transitEnded) {
      setPhase('sent');
      if (rewardDelivery.current) releaseCoinReward(rewardDelivery.current);
    }
    if (server === 'error') setPhase('ready');
  }, [server, transitEnded]);
  useEffect(() => {
    if (phase === 'sent' && server === 'success' && data && ratingReceipt.current) {
      const release=registerInlineAffectionRating(data.profile.id, ratingReceipt.current);
      recordRatingMilestone(data.profile.id, 'affection', ratingReceipt.current);
      return release;
    }
  }, [phase, server, data?.profile.id]);
  useEffect(() => coinOperations.subscribeSettled(event => {
    const current=getBurrowSnapshot().data, scope=sendScope.current;
    if(!scope||!current||event.operation.id!==rewardDelivery.current||event.operation.owner!==scope.profile.id
      ||questScope(current).scope!==questScope(scope).scope||closing.current)return;
    if(event.error){
      attempt.current=false;
      setError(sendErrorMessage(event.error));setServer('error');
    } else {
      ratingReceipt.current=operation.current;setServer('success');
    }
  }), []);
  useEffect(() => {
    if(sendScope.current&&data&&questScope(data).scope!==questScope(sendScope.current).scope){
      attempt.current=false;metrics.current=null;
      setError('Your connection has changed. Please return and try again.');setServer('error');
    }
  }, [data?.profile.id,data?.partner?.id,data?.pairVersion]);
  useEffect(() => { if (help) return registerOverlay({}); }, [help]);
  useEffect(() => () => { if (rewardDelivery.current) releaseCoinReward(rewardDelivery.current); }, []);
  function send(value: Record<string, number>) {
    if (!data?.partner) { Alert.alert('Connect first', 'Connect with your person to send affection.'); return; }
    if (attempt.current) return;
    const latest = getBurrowSnapshot();
    if (freeAffectionUsedToday(latest.data, latest.data ? Date.parse(latest.data.serverNow) + Math.max(0, burrowClock() - latest.receivedAt) : 0)) {
      setError('You’ve reached today’s affection limit. Come back after your local midnight.');setServer('error');return;
    }
    attempt.current = true;
    metrics.current = value;
    operation.current ??= randomUUID();
    sendScope.current ??= data;
    try {
      rewardDelivery.current=enqueueBurrowAffection(type,value,operation.current,sendScope.current);
      setError(null);setServer('queued');setTransitEnded(false);setPhase('sending');
    } catch(error) {
      attempt.current=false;
      setError(sendErrorMessage(error));setServer('error');
    }
  }
  function retry() {
    if (!metrics.current || attempt.current) return;
    send(metrics.current);
  }
  function close(){
    if(closing.current)return;closing.current=true;setHelp(false);
    // A direct link/restored route may not have a native screen to pop.
    if(router.canGoBack())router.back();else router.replace('/(main)/(tabs)/love');
  }
  // A deep link or stale retained selection must not bypass today's entry.
  // Keep the successful delivery's own Sent screen intact until Done.
  if (dailyUsed && phase === 'ready') return <AffectionLimitScreen hasPlus={data?.hasPlus}/>;
  return <View style={styles.root}>
    <Image source={BURROW_BACKGROUNDS.affectionSend} contentFit="cover" contentPosition="top" style={StyleSheet.absoluteFillObject}/>
    <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
      <BurrowBackButton onPress={close}/>
      <Text style={styles.pageTitle} numberOfLines={1} adjustsFontSizeToFit>{AFFECTION_COPY[type].pageTitle}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="How to send this affection" onPress={() => setHelp(true)} style={styles.helpButton}><Text style={styles.helpText}>?</Text></Pressable>
    </View>
    <View style={styles.deliveryArea}>
      {data ? <AffectionDelivery sender={data.profile} recipient={data.partner} type={type} phase={phase}
        deliveryId={operation.current??undefined}
        onTransitEnd={() => setTransitEnded(true)}/>
        : <ActivityIndicator color="#FFF8F4"/>}
    </View>
    <View style={[styles.lower, { height: cardHeight, marginBottom: insets.bottom + 8 }]}>
      {server === 'error' ? <View style={styles.errorCard}>
          <Text style={styles.sentTitle}>Not sent yet</Text>
          <Text style={styles.sentBody}>{error ?? 'Please try again.'}</Text>
          <Pressable accessibilityRole="button" onPress={metrics.current?retry:close} style={styles.doneButton}><Text style={styles.doneText}>{metrics.current?'Try sending again':'Back'}</Text></Pressable>
        </View>
          : ready ? <AffectionGesture key={type} type={type} status={phase} disabled={phase !== 'ready'}
              recipientName={data.partner?.display_name?.trim() || 'your person'}
              onComplete={value => { void send(value); }} onDone={close}/>
              : <View style={styles.errorCard}><Text style={styles.sentTitle}>Connect first</Text>
                <Text style={styles.sentBody}>Choose your person before sending affection.</Text>
                <Pressable accessibilityRole="button" onPress={close} style={styles.doneButton}><Text style={styles.doneText}>Back</Text></Pressable>
              </View>}
    </View>
    <Modal transparent visible={help} animationType="fade" onRequestClose={() => setHelp(false)}>
      <View style={styles.scrim}><Pressable onPress={() => setHelp(false)} style={StyleSheet.absoluteFillObject}/>
        <View style={styles.helpCard}>
          <Feather name="help-circle" size={32} color="#A84852"/>
          <Text style={styles.helpTitle}>{AFFECTION_COPY[type].heading}</Text>
          <Text style={styles.helpBody}>{AFFECTION_COPY[type].instruction}. Follow the gesture to send your affection.</Text>
          <Text style={styles.helpBody}>If you use a screen reader, activate the gesture area for an accessible three-second send.</Text>
          <Pressable accessibilityRole="button" onPress={() => setHelp(false)} style={styles.doneButton}><Text style={styles.doneText}>Got it</Text></Pressable>
        </View>
      </View>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#ED8390' },
  header: { paddingHorizontal: 20, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 5 },
  pageTitle: { flex: 1, color: '#FFF9F5', fontSize: 27, fontWeight: '800', textAlign: 'center' },
  helpButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFF6F0', alignItems: 'center', justifyContent: 'center' },
  helpText: { color: '#A34752', fontSize: 30, lineHeight: 36, fontWeight: '700' },
  deliveryArea: { flex: 1, justifyContent: 'center', paddingHorizontal: 12 },
  lower: { marginHorizontal: 9 },
  sentTitle: { color: '#4D271D', fontSize: 31, lineHeight: 37, fontWeight: '800', textAlign: 'center' },
  sentBody: { color: '#5A332C', fontSize: 18, lineHeight: 26, textAlign: 'center' },
  doneButton: { minHeight: 61, width: '100%', backgroundColor: '#633B32', borderRadius: 25, alignItems: 'center', justifyContent: 'center', shadowColor: '#DE9C74', shadowOpacity: .8, shadowOffset: { width: 0, height: 7 }, shadowRadius: 0 },
  doneText: { color: '#FFF9F5', fontSize: 20, fontWeight: '800' },
  errorCard: { flex: 1, alignItems: 'center', justifyContent: 'space-around', backgroundColor: '#FFF4F0', borderRadius: 35, padding: 24 },
  scrim: { flex: 1, backgroundColor: '#391C1DB5', justifyContent: 'center', padding: 22 },
  helpCard: { backgroundColor: '#FFF8F3', borderRadius: 27, padding: 25, alignItems: 'center', gap: 17 },
  helpTitle: { color: '#793337', fontSize: 23, fontWeight: '800', textAlign: 'center' },
  helpBody: { color: '#A84953', fontSize: 16, lineHeight: 23, textAlign: 'center' },
});
