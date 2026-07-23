import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { QUEST_THEME_BY_KEY, TASKS_TO_PICK } from '@novame/domain';

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

/**
 * Quest task picker -- full-screen. Shows ~20 candidate tasks; the user
 * selects exactly TASKS_TO_PICK (7), then Start commits a 7-day plan
 * (/api/quests/start) and returns to the Quests tab (now the checklist). A
 * bottom X closes without starting.
 *
 * Two sources of candidates:
 *   - themeKey → the theme's preset list from @novame/domain
 *   - tasksJson (+ title) → an AI-generated list handed over by quest-custom;
 *     themeKey stays 'custom' so the plan records its origin.
 */
export default function QuestPickScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { themeKey, tasksJson, title: titleParam } = useLocalSearchParams<{
    themeKey: string;
    tasksJson?: string;
    title?: string;
  }>();
  const theme = themeKey ? QUEST_THEME_BY_KEY[themeKey] : undefined;

  const customTasks = useMemo(() => {
    if (typeof tasksJson !== 'string' || !tasksJson) return null;
    try {
      const arr = JSON.parse(tasksJson) as unknown;
      if (Array.isArray(arr) && arr.every((t) => typeof t === 'string')) return arr as string[];
    } catch {
      // fall through — a broken param behaves like a missing theme
    }
    return null;
  }, [tasksJson]);

  const candidates = useMemo(
    () => customTasks ?? theme?.tasks ?? [],
    [customTasks, theme],
  );
  const planTitle =
    (typeof titleParam === 'string' && titleParam) || theme?.title || 'My Plan';
  const [selected, setSelected] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const count = selected.length;
  const ready = count === TASKS_TO_PICK;

  function toggle(i: number) {
    setSelected((cur) => {
      if (cur.includes(i)) return cur.filter((x) => x !== i);
      if (cur.length >= TASKS_TO_PICK) return cur;
      return [...cur, i];
    });
  }

  async function onStart() {
    if (!ready || submitting || (!theme && !customTasks)) return;
    setSubmitting(true);
    const picked = selected.map((i) => candidates[i]);
    const res = await startPlan(themeKey ?? 'custom', planTitle, picked);
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

  if (!theme && !customTasks) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>Theme not found</Text>
        <Pressable onPress={() => router.back()} style={styles.linkBtn}>
          <Text style={styles.linkText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <Text style={styles.title}>{planTitle}</Text>
        <Text style={styles.sub}>Pick {TASKS_TO_PICK} for the next {TASKS_TO_PICK} days</Text>
        <Text style={[styles.counter, { color: ready ? GREEN : CREAM_MUTED }]}>{count} / {TASKS_TO_PICK} selected</Text>
      </View>

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {candidates.map((task, i) => {
          const on = selected.includes(i);
          const full = !on && count >= TASKS_TO_PICK;
          return (
            <OffsetCard
              key={i}
              color={OFFSET}
              offset={4}
              radius={16}
              onPress={() => toggle(i)}
              cardStyle={[styles.taskRow, on && styles.taskRowOn]}
              style={[styles.rowGap, full && styles.taskRowDim]}
            >
              <View style={[styles.checkbox, on && styles.checkboxOn]}>
                {on && <MaterialIcons name="check" size={16} color="#FFFFFF" />}
              </View>
              <Text style={[styles.taskText, on && styles.taskTextOn]}>{task}</Text>
            </OffsetCard>
          );
        })}
        <View style={{ height: 12 }} />
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.closeX} hitSlop={10}>
          <MaterialIcons name="close" size={24} color={TEXT} />
        </Pressable>
        <Pressable onPress={onStart} disabled={!ready || submitting} style={[styles.startBtn, { backgroundColor: ready ? ORANGE : 'rgba(255,246,232,0.25)' }]}>
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.startText}>{ready ? 'Start 7-Day Plan' : `Pick ${TASKS_TO_PICK - count} more`}</Text>
          )}
        </Pressable>
      </View>
    </View>
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
  taskRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: CARD,
    paddingVertical: 14, paddingHorizontal: 14, borderWidth: 1.5, borderColor: 'transparent',
  },
  taskRowOn: { borderColor: ORANGE },
  // Dim face + drop together (OffsetCard rule: opacity lives on the wrapper).
  taskRowDim: { opacity: 0.45 },
  checkbox: { width: 24, height: 24, borderRadius: 8, borderWidth: 2, borderColor: '#D8C9B2', alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: ORANGE, borderColor: ORANGE },
  taskText: { flex: 1, fontSize: 15, fontFamily: 'Inter_500Medium', color: TEXT },
  taskTextOn: { fontFamily: 'Inter_700Bold' },

  bottomBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 10 },
  closeX: { width: 48, height: 48, borderRadius: 24, backgroundColor: CARD, alignItems: 'center', justifyContent: 'center' },
  startBtn: { flex: 1, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  startText: { fontSize: 16, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },

  linkBtn: { marginTop: 16, alignSelf: 'flex-start' },
  linkText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: ORANGE },
});
