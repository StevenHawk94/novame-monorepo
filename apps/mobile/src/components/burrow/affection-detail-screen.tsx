import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from './burrow-image';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import type { AffectionType } from '@novame/domain';
import { completeAffection } from '@/lib/app-major-update-api';
import { BURROW_BACKGROUNDS } from '@/lib/burrow-art-assets';
import { burrowErrorMessage, getBurrowSnapshot, runBurrowAction, useBurrow } from '@/lib/burrow-store';
import { AffectionDelivery, type DeliveryPhase } from './affection-delivery';
import { AFFECTION_COPY, AffectionGesture } from './affection-gesture';
import { BurrowBackButton } from './burrow-back-button';

export function AffectionDetailScreen({ type }: { type: AffectionType }) {
  const { data } = useBurrow();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [phase, setPhase] = useState<DeliveryPhase>('ready');
  const [server, setServer] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [transitEnded, setTransitEnded] = useState(false);
  const [help, setHelp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const metrics = useRef<Record<string, number> | null>(null);
  const operation = useRef(`affection:${type}:${Date.now()}`);
  const attempt = useRef(false);
  const compact = height < 740;
  const cardHeight = Math.max(350, Math.min(520, height * (compact ? .51 : .48)));
  const ready = !!data?.partner;

  useEffect(() => {
    if (server === 'success' && transitEnded) setPhase('sent');
    if (server === 'error' && transitEnded) setPhase('ready');
  }, [server, transitEnded]);
  async function send(value: Record<string, number>) {
    if (!data?.partner) { Alert.alert('Connect first', 'Connect with your person to send affection.'); return; }
    if (attempt.current) return;
    attempt.current = true;
    metrics.current = value;
    setError(null); setServer('pending'); setTransitEnded(false); setPhase('sending');
    const succeeded = await runBurrowAction(operation.current, key => completeAffection(type, value, key), { silent: true });
    if (succeeded) { setServer('success'); return; }
    attempt.current = false;
    setError(burrowErrorMessage(getBurrowSnapshot().error ?? 'network_error'));
    setServer('error');
  }
  function retry() {
    if (!metrics.current || attempt.current) return;
    void send(metrics.current);
  }
  return <View style={styles.root}>
    <Image source={BURROW_BACKGROUNDS.affectionSend} contentFit="cover" contentPosition="top" style={StyleSheet.absoluteFillObject}/>
    <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
      <BurrowBackButton onPress={() => router.back()}/>
      <Text style={styles.pageTitle} numberOfLines={1} adjustsFontSizeToFit>{AFFECTION_COPY[type].pageTitle}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="How to send this affection" onPress={() => setHelp(true)} style={styles.helpButton}><Text style={styles.helpText}>?</Text></Pressable>
    </View>
    <View style={styles.deliveryArea}>
      {data ? <AffectionDelivery sender={data.profile} recipient={data.partner} type={type} phase={phase}
        onTransitEnd={() => setTransitEnded(true)}/>
        : <ActivityIndicator color="#FFF8F4"/>}
    </View>
    <View style={[styles.lower, { height: cardHeight, marginBottom: insets.bottom + 8 }]}>
      {server === 'error' ? <View style={styles.errorCard}>
          <Text style={styles.sentTitle}>Not sent yet</Text>
          <Text style={styles.sentBody}>{error ?? 'Please try again.'}</Text>
          <Pressable accessibilityRole="button" onPress={retry} style={styles.doneButton}><Text style={styles.doneText}>Try sending again</Text></Pressable>
        </View>
          : ready ? <AffectionGesture key={type} type={type} status={phase} disabled={phase !== 'ready'}
              recipientName={data.partner?.display_name?.trim() || 'your person'}
              onComplete={value => { void send(value); }} onDone={() => router.back()}/>
              : <View style={styles.errorCard}><Text style={styles.sentTitle}>Connect first</Text>
                <Text style={styles.sentBody}>Choose your person before sending affection.</Text>
                <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.doneButton}><Text style={styles.doneText}>Back</Text></Pressable>
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
