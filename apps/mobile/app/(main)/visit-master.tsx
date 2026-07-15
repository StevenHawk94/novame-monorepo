import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableWithoutFeedback, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { useTheme } from '../../src/theme/use-theme';
import { WaveBackground, WAVE_PALETTES } from '../../src/components/main/wave-background';
import { haptics } from '../../src/lib/haptics';
import {
  fetchMasterStatus, getCachedMasterStatus, askMaster, fetchMasterVisit, cooldownLabel,
  type MasterStatus, type MasterResponse, type MasterVisit,
} from '../../src/lib/master-api';

type Phase = 'entry' | 'forest' | 'waiting' | 'reply' | 'history' | 'detail';

const KIT = {
  text: '#3A2E1A', textSub: '#6B5A45', textMuted: '#9A8770',
  card: '#FFFFFF', border: 'rgba(58,46,26,0.12)',
  accent: '#D9A441', inputBg: 'rgba(255,255,255,0.7)',
};

/**
 * Visit Master (Kit 5, paid-only). A deliberate consultation: the user asks,
 * the Master answers with a six-module reading. Paid gate + 48h cooldown ("the
 * Master is away travelling"). Produces no skill / xp / items -- consulting a
 * sage, isolated from the Skills system. Phases: entry (paywall for free),
 * forest (ask), waiting (narrative loader), reply (the answer), history (+ detail).
 */
export default function VisitMasterScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { theme } = useTheme();
  const c = theme.colors;
  const kit = KIT;
  void c;

  const [phase, setPhase] = useState<Phase>('entry');
  const [status, setStatus] = useState<MasterStatus>(() => getCachedMasterStatus());
  const [question, setQuestion] = useState('');
  const [reply, setReply] = useState<MasterResponse | null>(null);
  const [detail, setDetail] = useState<{ question: string; response: MasterResponse } | null>(null);

  const load = useCallback(() => {
    void fetchMasterStatus().then((s) => {
      setStatus(s);
      // Entry decides the first meaningful screen once we know paid + cooldown.
      setPhase((prev) => (prev === 'entry' ? 'entry' : prev));
    });
  }, []);
  useFocusEffect(load);

  function enterForest() {
    if (!status.isPaid) return; // paywall stays
    void haptics.medium();
    setPhase('forest');
  }

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
      setPhase('forest');
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

  // ── ENTRY ──
  if (phase === 'entry') {
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top + 8 }]}>
        <WaveBackground palette={WAVE_PALETTES.visitMaster} />
        <Pressable onPress={() => router.back()} style={[styles.back, styles.backAbs]} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={24} color={kit.textSub} />
        </Pressable>
        <Text style={styles.masterEmoji}>{'\u{1F9D9}'}</Text>
        <Text style={[styles.title, { color: kit.text }]}>Visit the Master</Text>
        {status.isPaid ? (
          !status.available ? (
            <>
              <Text style={[styles.body, { color: kit.textSub }]}>{cooldownLabel(status.nextAvailableAt)}</Text>
              <Text style={[styles.bodyMuted, { color: kit.textMuted }]}>The Master is away travelling. Come back when he returns.</Text>
              {status.history.length > 0 && (
                <Pressable onPress={() => setPhase('history')} style={styles.linkBtn}>
                  <Text style={[styles.linkText, { color: kit.accent }]}>Past visits</Text>
                </Pressable>
              )}
            </>
          ) : (
            <>
              <Text style={[styles.body, { color: kit.textSub }]}>
                Bring what's been weighing on you. The Master offers a deeper reading -- once every couple of days.
              </Text>
              <Pressable onPress={enterForest} style={[styles.primaryBtn, { backgroundColor: kit.accent, marginBottom: insets.bottom }]}>
                <Text style={styles.primaryText}>Enter the forest</Text>
              </Pressable>
              {status.history.length > 0 && (
                <Pressable onPress={() => setPhase('history')} style={styles.linkBtn}>
                  <Text style={[styles.linkText, { color: kit.accent }]}>Past visits</Text>
                </Pressable>
              )}
            </>
          )
        ) : (
          <>
            <Text style={[styles.body, { color: kit.textSub }]}>
              The Master offers a deep, considered reading of whatever's on your mind -- a kind of counsel you can't get from a quick note. It's part of Plus.
            </Text>
            <Pressable onPress={() => router.push('/(main)/(modals)/subscription-paywall')} style={[styles.primaryBtn, { backgroundColor: kit.accent, marginBottom: insets.bottom }]}>
              <Text style={styles.primaryText}>Unlock with Plus</Text>
            </Pressable>
          </>
        )}
      </View>
    );
  }

  // ── FOREST (ask) ──
  if (phase === 'forest') {
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <WaveBackground palette={WAVE_PALETTES.visitMaster} />
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
            <View style={styles.forestHeader}>
              <Pressable onPress={() => setPhase('entry')} style={styles.back} hitSlop={12}>
                <MaterialIcons name="arrow-back" size={24} color={kit.textSub} />
              </Pressable>
              <Pressable onPress={() => setPhase('history')} hitSlop={12}>
                <MaterialIcons name="history-edu" size={24} color={kit.textSub} />
              </Pressable>
            </View>
            <Text style={styles.masterEmojiSmall}>{'\u{1F9D9}'}</Text>
            <Text style={[styles.forestPrompt, { color: kit.text }]}>What's been on your mind?</Text>
            <TextInput
              value={question}
              onChangeText={setQuestion}
              placeholder="Tell the Master..."
              placeholderTextColor={kit.textMuted}
              multiline
              maxLength={1000}
              style={[styles.input, { backgroundColor: kit.inputBg, color: kit.text, borderColor: kit.border }]}
            />
            <Pressable
              onPress={onAsk}
              disabled={question.trim().length === 0}
              style={[styles.primaryBtn, { backgroundColor: kit.accent, opacity: question.trim().length === 0 ? 0.5 : 1, marginBottom: insets.bottom + 12 }]}
            >
              <Text style={styles.primaryText}>Ask the Master</Text>
            </Pressable>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    );
  }

  // ── WAITING ──
  if (phase === 'waiting') {
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top + 8 }]}>
        <WaveBackground palette={WAVE_PALETTES.visitMaster} />
        <Text style={styles.masterEmoji}>{'\u{1F9D9}'}</Text>
        <ActivityIndicator color={kit.accent} style={{ marginVertical: 16 }} />
        <Text style={[styles.body, { color: kit.textSub, textAlign: 'center' }]}>
          The Master is looking at this from a few angles.
        </Text>
      </View>
    );
  }

  // ── REPLY ──
  if (phase === 'reply' && reply) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
        <WaveBackground palette={WAVE_PALETTES.visitMaster} />
        <Pressable onPress={() => { setReply(null); setQuestion(''); router.back(); }} style={styles.back} hitSlop={12}>
          <MaterialIcons name="close" size={24} color={kit.textSub} />
        </Pressable>
        <ScrollView contentContainerStyle={styles.replyScroll} showsVerticalScrollIndicator={false}>
          <ReplyBody reply={reply} c={KIT} />
          <Pressable onPress={() => { setReply(null); setQuestion(''); router.back(); }} style={[styles.primaryBtn, { backgroundColor: kit.accent, marginTop: 24, marginBottom: insets.bottom + 12 }]}>
            <Text style={styles.primaryText}>Save & Close</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // ── HISTORY ──
  if (phase === 'history') {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
        <WaveBackground palette={WAVE_PALETTES.visitMaster} />
        <Pressable onPress={() => setPhase('entry')} style={styles.back} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={24} color={kit.textSub} />
        </Pressable>
        <Text style={[styles.title, { color: kit.text, marginBottom: 16 }]}>Past visits</Text>
        {status.history.length === 0 ? (
          <Text style={[styles.bodyMuted, { color: kit.textMuted }]}>
            Nothing here yet -- your first conversation with the Master will show up here.
          </Text>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32, gap: 10 }}>
            {status.history.map((v) => (
              <Pressable key={v.id} onPress={() => openDetail(v)} style={[styles.historyRow, { backgroundColor: kit.card, borderColor: kit.border }]}>
                <Text style={[styles.historyDate, { color: kit.textMuted }]}>{formatDate(v.createdAt)}</Text>
                <Text style={[styles.historyQ, { color: kit.text }]} numberOfLines={2}>{v.question}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>
    );
  }

  // ── DETAIL ──
  if (phase === 'detail' && detail) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
        <WaveBackground palette={WAVE_PALETTES.visitMaster} />
        <Pressable onPress={() => setPhase('history')} style={styles.back} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={24} color={kit.textSub} />
        </Pressable>
        <ScrollView contentContainerStyle={styles.replyScroll} showsVerticalScrollIndicator={false}>
          <Text style={[styles.detailQ, { color: kit.textSub }]}>"{detail.question}"</Text>
          <ReplyBody reply={detail.response} c={KIT} />
        </ScrollView>
      </View>
    );
  }

  return null;
}

function ReplyBody({ reply, c }: { reply: MasterResponse; c: any }) {
  return (
    <View style={{ gap: 20 }}>
      {!!reply.quote_short && <Text style={[styles.quote, { color: c.accent }]}>{reply.quote_short}</Text>}
      {!!reply.insight_full && <Text style={[styles.insight, { color: c.text }]}>{reply.insight_full}</Text>}
      {!!reply.flipped_lens && (
        <View style={[styles.moduleCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.moduleLabel, { color: c.textMuted }]}>Another angle</Text>
          <Text style={[styles.moduleText, { color: c.textSub }]}>{reply.flipped_lens}</Text>
        </View>
      )}
      {!!reply.micro_task && (
        <View style={[styles.moduleCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.moduleLabel, { color: c.textMuted }]}>One small step</Text>
          <Text style={[styles.moduleText, { color: c.textSub }]}>{reply.micro_task}</Text>
        </View>
      )}
      {!!reply.reflective_question && <Text style={[styles.reflectQ, { color: c.text }]}>{reply.reflective_question}</Text>}
    </View>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return iso; }
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16 },
  back: { alignSelf: 'flex-start', paddingVertical: 8 },
  backAbs: { position: 'absolute', top: 8, left: 20 },
  masterEmoji: { fontSize: 88 },
  masterEmojiSmall: { fontSize: 56, textAlign: 'center', marginBottom: 8 },
  title: { fontSize: 27, fontFamily: 'Inter_800ExtraBold', textAlign: 'center' },
  body: { fontSize: 15, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 22, paddingHorizontal: 12 },
  bodyMuted: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 19 },
  primaryBtn: { paddingHorizontal: 40, paddingVertical: 17, borderRadius: 18, alignItems: 'center', alignSelf: 'stretch', marginHorizontal: 12, shadowColor: '#5A4A2B', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  primaryText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  linkBtn: { paddingVertical: 8 },
  linkText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },

  forestHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  forestPrompt: { fontSize: 25, fontFamily: 'Inter_800ExtraBold', textAlign: 'center', marginBottom: 20 },
  input: { borderWidth: 0, borderRadius: 18, padding: 18, fontSize: 16, fontFamily: 'Inter_400Regular', minHeight: 140, textAlignVertical: 'top', marginBottom: 16, shadowColor: '#5A4A2B', shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },

  replyScroll: { paddingBottom: 40, paddingTop: 8 },
  quote: { fontSize: 20, fontFamily: 'Inter_700Bold', lineHeight: 28 },
  insight: { fontSize: 16, fontFamily: 'Inter_400Regular', lineHeight: 25 },
  moduleCard: { borderRadius: 18, padding: 18, shadowColor: '#5A4A2B', shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  moduleLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 },
  moduleText: { fontSize: 15, fontFamily: 'Inter_400Regular', lineHeight: 22 },
  reflectQ: { fontSize: 17, fontFamily: 'Inter_600SemiBold', lineHeight: 25, fontStyle: 'italic' },

  historyRow: { borderRadius: 18, padding: 16, shadowColor: '#5A4A2B', shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  historyDate: { fontSize: 12, fontFamily: 'Inter_500Medium', marginBottom: 4 },
  historyQ: { fontSize: 15, fontFamily: 'Inter_500Medium', lineHeight: 21 },
  detailQ: { fontSize: 16, fontFamily: 'Inter_500Medium', fontStyle: 'italic', lineHeight: 23, marginBottom: 20 },
});
