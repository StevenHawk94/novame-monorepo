import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { PLAN_DAYS } from '@novame/domain';

import { haptics } from '@/lib/haptics';
import { OffsetCard } from '@/components/ui/offset-card';
import { fetchQuestStatus, startPlan } from '@/lib/quests-api';

// Quests family theme (2026-07-23): dark-brown ground, white offset cards.
const BG = '#4C331B';
const OFFSET = '#33220F';
const CARD = '#FFFFFF';
const TEXT = '#4A3B2A';
const MUTED = '#9A8A76';
const CREAM = '#FFF6E8';
const CREAM_MUTED = 'rgba(255,246,232,0.75)';
const ORANGE = '#F2A03D';
const GREEN = '#7BB661';

const MAX_TASK = 120;

/**
 * Write Your Own — PRD §5.2: the user writes all seven tasks themselves, one
 * per day, then starts the 7-day plan directly (no candidate-picking step).
 * Empty rows just aren't filled yet; Start unlocks once every row has text.
 */
export default function QuestWriteOwnScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [tasks, setTasks] = useState<string[]>(() => Array(PLAN_DAYS).fill(''));
  const [submitting, setSubmitting] = useState(false);

  const filled = tasks.filter((t) => t.trim().length > 0).length;
  const ready = filled === PLAN_DAYS && !submitting;

  function setTask(i: number, text: string) {
    setTasks((cur) => cur.map((t, j) => (j === i ? text.slice(0, MAX_TASK) : t)));
  }

  async function onStart() {
    if (!ready) return;
    void haptics.medium();
    setSubmitting(true);
    const res = await startPlan('write_own', 'My Own Plan', tasks.map((t) => t.trim()));
    if (res.ok) {
      await fetchQuestStatus();
      router.back();
      return;
    }
    setSubmitting(false);
    if (res.error === 'already_active') {
      Alert.alert('You already have an active plan', 'Finish or wait for it to end before starting a new one.');
    } else {
      Alert.alert('Could not start', 'Please try again.');
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Write Your Own</Text>
          <Text style={styles.sub}>One task per day — all {PLAN_DAYS} are yours to write.</Text>
          <Text style={[styles.counter, { color: filled === PLAN_DAYS ? GREEN : CREAM_MUTED }]}>
            {filled} / {PLAN_DAYS} written
          </Text>
        </View>

        <ScrollView
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {tasks.map((t, i) => (
            <OffsetCard key={i} color={OFFSET} offset={4} radius={16} cardStyle={styles.row} style={styles.rowGap}>
              <View style={styles.dayChip}>
                <Text style={styles.dayChipText}>Day {i + 1}</Text>
              </View>
              <TextInput
                style={styles.rowInput}
                placeholder="Write a task you can finish that day…"
                placeholderTextColor={MUTED}
                value={t}
                onChangeText={(text) => setTask(i, text)}
              />
            </OffsetCard>
          ))}
          <View style={{ height: 12 }} />
        </ScrollView>

        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable onPress={() => router.back()} style={styles.closeX} hitSlop={10}>
            <MaterialIcons name="close" size={24} color={TEXT} />
          </Pressable>
          <Pressable
            onPress={onStart}
            disabled={!ready}
            style={[styles.startBtn, { backgroundColor: ready ? ORANGE : 'rgba(255,246,232,0.25)' }]}
          >
            {submitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.startText}>
                {filled === PLAN_DAYS ? 'Start 7-Day Plan' : `Write ${PLAN_DAYS - filled} more`}
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG, paddingHorizontal: 16 },
  header: { paddingHorizontal: 4, paddingBottom: 8 },
  title: { fontSize: 26, fontFamily: 'Inter_800ExtraBold', color: CREAM },
  sub: { fontSize: 14, fontFamily: 'Inter_500Medium', color: CREAM_MUTED, marginTop: 4 },
  counter: { fontSize: 13, fontFamily: 'Inter_700Bold', marginTop: 8 },

  list: { paddingTop: 8, paddingBottom: 8 },
  rowGap: { marginBottom: 8 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: CARD, paddingVertical: 10, paddingHorizontal: 12,
  },
  dayChip: { backgroundColor: '#F6E7D0', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  dayChipText: { fontSize: 12, fontFamily: 'Inter_800ExtraBold', color: '#8A5A2B' },
  rowInput: { flex: 1, fontSize: 15, fontFamily: 'Inter_500Medium', color: TEXT, paddingVertical: 6 },

  bottomBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 10 },
  closeX: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: CARD,
    alignItems: 'center', justifyContent: 'center',
  },
  startBtn: { flex: 1, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  startText: { fontSize: 16, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
});
