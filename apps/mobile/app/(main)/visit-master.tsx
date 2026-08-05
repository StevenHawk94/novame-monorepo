import { useCallback, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, Keyboard, KeyboardAvoidingView, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { haptics } from '../../src/lib/haptics';
import { BACKGROUNDS, ICONS } from '../../src/lib/icons';
import {
  fetchMasterStatus, getCachedMasterStatus, askMaster, fetchMasterVisit, cooldownLabel,
  type MasterStatus, type MasterResponse, type MasterVisit,
} from '../../src/lib/master-api';

type Phase = 'ask' | 'waiting' | 'reply' | 'history' | 'detail';

/**
 * Visit Master (Kit 5, Plus-only) — 2026-08-05 mocks. One full-bleed scene
 * (visit-master.webp: the meditating master): speech bubble up top, the ask
 * pill at the bottom (send.png), history scroll at top-right. Free users see
 * "Join Plus to access this feature." in the pill and tap into the paywall.
 * Reply / History / Detail render as cream cards over the same scene with a
 * round close button. 48h cooldown text lives in the bubble.
 */
export default function VisitMasterScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('ask');
  const [status, setStatus] = useState<MasterStatus>(() => getCachedMasterStatus());
  const [question, setQuestion] = useState('');
  const [reply, setReply] = useState<MasterResponse | null>(null);
  const [detail, setDetail] = useState<{ question: string; response: MasterResponse } | null>(null);

  const load = useCallback(() => {
    void fetchMasterStatus().then(setStatus);
  }, []);
  useFocusEffect(load);

  async function onAsk() {
    const q = question.trim();
    if (q.length === 0) return;
    Keyboard.dismiss();
    void haptics.medium();
    setPhase('waiting');
    const res = await askMaster(q);
    if (res.ok) {
      setReply(res.response);
      setPhase('reply');
      void fetchMasterStatus().then(setStatus);
    } else {
      const msg =
        res.error === 'on_cooldown' ? cooldownLabel(res.nextAvailableAt ?? null)
        : res.error === 'not_paid' ? 'Visiting the Master is part of Plus.'
        : res.error === 'ai_unavailable' ? 'The Master is deep in thought. Try again shortly.'
        : 'Something went wrong. Try again.';
      Alert.alert('The Master', msg);
      setPhase('ask');
    }
  }

  async function openDetail(v: MasterVisit) {
    void haptics.light();
    const full = await fetchMasterVisit(v.id);
    if (full) {
      setDetail({ question: full.question, response: full.response });
      setPhase('detail');
    }
  }

  const bubbleText = !status.isPaid
    ? 'Ask me any question that has been troubling you the most, I will give you some wisdom that can rewire your mind.'
    : !status.available
      ? `${cooldownLabel(status.nextAvailableAt)} — the Master is away travelling. Come back when he returns.`
      : 'Ask me any question that has been troubling you the most, I will give you some wisdom that can rewire your mind.';

  const canAsk = status.isPaid && status.available;

  // ── ASK (the scene) ──
  if (phase === 'ask' || phase === 'waiting') {
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.root}>
          <ExpoImage
          source={BACKGROUNDS.visitMaster}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          contentPosition="top"
        />

          {/* top bar: close + history */}
          <View style={[styles.topBar, { top: insets.top + 8 }]}>
            <Pressable
              onPress={() => { void haptics.light(); router.back(); }}
              style={styles.closeCircle}
              hitSlop={10}
            >
              <MaterialIcons name="close" size={26} color="#3A2E1A" />
            </Pressable>
            <Pressable
              onPress={() => { void haptics.light(); setPhase('history'); }}
              hitSlop={10}
            >
              <Image source={ICONS.visitMasterHistory} style={styles.historyIcon} resizeMode="contain" />
            </Pressable>
          </View>

          {/* speech bubble */}
          <View style={[styles.bubble, { marginTop: insets.top + 78 }]}>
            <Text style={styles.bubbleText}>{bubbleText}</Text>
            <View style={styles.bubbleTail} />
          </View>

          <View style={{ flex: 1 }} />

          {/* waiting spinner floats above the pill while the Master thinks */}
          {phase === 'waiting' && (
            <View style={styles.waitingWrap}>
              <ActivityIndicator color="#FFF6E8" />
              <Text style={styles.waitingText}>The Master is looking at this from a few angles…</Text>
            </View>
          )}

          {/* ask pill */}
          {!status.isPaid ? (
            <Pressable
              onPress={() => { void haptics.warning(); router.push('/(main)/(modals)/subscription-paywall'); }}
              style={[styles.askPill, { marginBottom: insets.bottom + 18 }]}
            >
              <Text style={styles.lockedText}>Join Plus to access this feature.</Text>
              <MaterialIcons name="lock" size={22} color="#8A7A63" />
            </Pressable>
          ) : (
            <View style={[styles.askPill, { marginBottom: insets.bottom + 18 }]}>
              <TextInput
                value={question}
                onChangeText={setQuestion}
                placeholder="What's been on your mind?"
                placeholderTextColor="#8A7A63"
                editable={canAsk && phase === 'ask'}
                multiline
                maxLength={1000}
                style={styles.askInput}
              />
              <Pressable
                onPress={onAsk}
                disabled={!canAsk || phase !== 'ask' || question.trim().length === 0}
                hitSlop={8}
                style={{ opacity: !canAsk || question.trim().length === 0 ? 0.45 : 1 }}
              >
                <Image source={ICONS.send} style={styles.sendIcon} resizeMode="contain" />
              </Pressable>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ── REPLY / DETAIL (cream card over the scene) ──
  if ((phase === 'reply' && reply) || (phase === 'detail' && detail)) {
    const isDetail = phase === 'detail';
    const body = isDetail ? detail!.response : reply!;
    const onClose = () => {
      if (isDetail) {
        setDetail(null);
        setPhase('history');
      } else {
        setReply(null);
        setQuestion('');
        router.back();
      }
    };
    return (
      <View style={styles.root}>
        <ExpoImage
          source={BACKGROUNDS.visitMaster}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          contentPosition="top"
        />
        <View style={[styles.cardWrap, { paddingTop: insets.top + 34, paddingBottom: insets.bottom + 40 }]}>
          <View style={styles.card}>
            <Image source={ICONS.VisitMaster} style={styles.cardMasterIcon} resizeMode="contain" />
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.cardScroll}>
              {isDetail && <Text style={styles.detailQ}>"{detail!.question}"</Text>}
              <ReplyBody reply={body} />
            </ScrollView>
          </View>
          <Pressable onPress={() => { void haptics.light(); onClose(); }} style={styles.cardClose} hitSlop={10}>
            <MaterialIcons name="close" size={26} color="#2B2B2B" />
          </Pressable>
        </View>
      </View>
    );
  }

  // ── HISTORY ──
  if (phase === 'history') {
    return (
      <View style={styles.root}>
        <ExpoImage
          source={BACKGROUNDS.visitMaster}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          contentPosition="top"
        />
        <View style={[styles.cardWrap, { paddingTop: insets.top + 34, paddingBottom: insets.bottom + 40 }]}>
          <View style={styles.card}>
            <View style={styles.historyTitleRow}>
              <Image source={ICONS.visitMasterHistory} style={styles.historyTitleIcon} resizeMode="contain" />
              <Text style={styles.historyTitle}>History Visit</Text>
            </View>
            {status.history.length === 0 ? (
              <Text style={styles.historyEmpty}>
                Nothing here yet — your first conversation with the Master will show up here.
              </Text>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.historyScroll}>
                {status.history.map((v) => (
                  <Pressable key={v.id} onPress={() => void openDetail(v)} style={styles.historyRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.historyDate}>{formatDate(v.createdAt)}</Text>
                      <Text style={styles.historyQ} numberOfLines={2}>{v.question}</Text>
                    </View>
                    <MaterialIcons name="chevron-right" size={26} color="#2B2B2B" />
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
          <Pressable onPress={() => { void haptics.light(); setPhase('ask'); }} style={styles.cardClose} hitSlop={10}>
            <MaterialIcons name="close" size={26} color="#2B2B2B" />
          </Pressable>
        </View>
      </View>
    );
  }

  return null;
}

function ReplyBody({ reply }: { reply: MasterResponse }) {
  return (
    <View style={{ gap: 18 }}>
      {!!reply.quote_short && <Text style={styles.quote}>{reply.quote_short}</Text>}
      {!!reply.insight_full && <Text style={styles.insight}>{reply.insight_full}</Text>}
      {!!reply.flipped_lens && (
        <>
          <Text style={styles.sectionTitle}>Another angle</Text>
          <Text style={styles.insight}>{reply.flipped_lens}</Text>
        </>
      )}
      {!!reply.micro_task && (
        <>
          <Text style={styles.sectionTitle}>One small step</Text>
          <Text style={styles.insight}>{reply.micro_task}</Text>
        </>
      )}
      {!!reply.reflective_question && <Text style={styles.reflectQ}>{reply.reflective_question}</Text>}
    </View>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return iso; }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#3E5C43' },

  topBar: {
    position: 'absolute', left: 16, right: 16, zIndex: 2,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  closeCircle: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
  },
  historyIcon: { width: 46, height: 46 },

  bubble: {
    marginHorizontal: 24, backgroundColor: '#FBF3DF', borderRadius: 24,
    paddingHorizontal: 22, paddingVertical: 18,
  },
  bubbleText: {
    fontSize: 16.5, fontFamily: 'Inter_700Bold', color: '#2B2B2B',
    textAlign: 'center', lineHeight: 25,
  },
  bubbleTail: {
    position: 'absolute', bottom: -13, alignSelf: 'center',
    width: 0, height: 0, borderLeftWidth: 13, borderRightWidth: 13, borderTopWidth: 14,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#FBF3DF',
  },

  waitingWrap: { alignItems: 'center', gap: 8, marginBottom: 14, paddingHorizontal: 32 },
  waitingText: {
    fontSize: 13.5, fontFamily: 'Inter_600SemiBold', color: '#FFF6E8', textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.45)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 },
  },

  askPill: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 20, backgroundColor: '#FBF6EA', borderRadius: 26,
    borderWidth: 2.5, borderColor: '#2B2B2B',
    paddingHorizontal: 18, paddingVertical: 12, minHeight: 62,
  },
  askInput: {
    flex: 1, fontSize: 17, fontFamily: 'Inter_700Bold', color: '#2B2B2B',
    maxHeight: 110, paddingVertical: 4,
  },
  lockedText: { flex: 1, fontSize: 16.5, fontFamily: 'Inter_700Bold', color: '#8A7A63' },
  sendIcon: { width: 36, height: 36 },

  cardWrap: { flex: 1, paddingHorizontal: 16 },
  card: {
    flex: 1, backgroundColor: '#FBF3DF', borderRadius: 30,
    borderWidth: 2.5, borderColor: '#2B2B2B', overflow: 'hidden',
  },
  cardMasterIcon: { width: 64, height: 64, alignSelf: 'center', marginTop: -6 },
  cardScroll: { paddingHorizontal: 22, paddingTop: 10, paddingBottom: 28 },
  cardClose: {
    position: 'absolute', bottom: 8, alignSelf: 'center',
    width: 56, height: 56, borderRadius: 28, backgroundColor: '#FFFFFF',
    borderWidth: 2.5, borderColor: '#2B2B2B', alignItems: 'center', justifyContent: 'center',
  },

  quote: { fontSize: 19, fontFamily: 'Inter_800ExtraBold', color: '#2B2B2B', lineHeight: 27 },
  insight: { fontSize: 15.5, fontFamily: 'Inter_500Medium', color: '#2A2118', lineHeight: 24 },
  sectionTitle: { fontSize: 17, fontFamily: 'Inter_800ExtraBold', color: '#2B2B2B', marginBottom: -8 },
  reflectQ: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#2B2B2B', lineHeight: 24, fontStyle: 'italic' },
  detailQ: { fontSize: 15, fontFamily: 'Inter_500Medium', fontStyle: 'italic', color: '#6B5A45', lineHeight: 22, marginBottom: 16 },

  historyTitleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    paddingTop: 20, paddingBottom: 14,
  },
  historyTitleIcon: { width: 40, height: 40 },
  historyTitle: { fontSize: 24, fontFamily: 'Inter_800ExtraBold', color: '#2B2B2B' },
  historyEmpty: {
    fontSize: 14, fontFamily: 'Inter_500Medium', color: '#8A7A63',
    textAlign: 'center', lineHeight: 21, paddingHorizontal: 28, paddingTop: 30,
  },
  historyScroll: { paddingHorizontal: 16, paddingBottom: 80, gap: 14 },
  historyRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFFFFF', borderRadius: 22, borderWidth: 2.5, borderColor: '#2B2B2B',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  historyDate: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#8A7A63', marginBottom: 4 },
  historyQ: { fontSize: 15.5, fontFamily: 'Inter_700Bold', color: '#2B2B2B', lineHeight: 22 },
});
