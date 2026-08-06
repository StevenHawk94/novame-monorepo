import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { appAlert } from '@/components/ui/app-dialog';
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
  // Selection is tracked by stable id ('m<i>' manual / 'p<i>' preset) so
  // manually added rows never shift what's already picked.
  const [manualTasks, setManualTasks] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const items = useMemo(
    () => [
      ...manualTasks.map((text, i) => ({ id: `m${i}`, text, manual: true })),
      ...candidates.map((text, i) => ({ id: `p${i}`, text, manual: false })),
    ],
    [manualTasks, candidates],
  );

  const count = selected.length;
  const ready = count === TASKS_TO_PICK;

  function toggle(id: string) {
    setSelected((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= TASKS_TO_PICK) return cur;
      return [...cur, id];
    });
  }

  function onAddManual() {
    const text = draft.trim();
    if (!text) return;
    setManualTasks((cur) => [...cur, text]);
    // Auto-select the new task if there's room.
    setSelected((cur) =>
      cur.length < TASKS_TO_PICK ? [...cur, `m${manualTasks.length}`] : cur,
    );
    setDraft('');
    setAdding(false);
  }

  function removeManual(id: string) {
    const idx = Number(id.slice(1));
    setManualTasks((cur) => cur.filter((_, i) => i !== idx));
    // Re-key: drop the removed id and shift later manual ids down by one.
    setSelected((cur) =>
      cur
        .filter((x) => x !== id)
        .map((x) => {
          if (!x.startsWith('m')) return x;
          const n = Number(x.slice(1));
          return n > idx ? `m${n - 1}` : x;
        }),
    );
  }

  async function onStart() {
    if (!ready || submitting || (!theme && !customTasks)) return;
    setSubmitting(true);
    const byId = new Map(items.map((it) => [it.id, it.text]));
    const picked = selected.map((id) => byId.get(id)).filter((t): t is string => !!t);
    const res = await startPlan(themeKey ?? 'custom', planTitle, picked);
    if (res.ok) {
      await fetchQuestStatus();
      router.back();
      return;
    }
    setSubmitting(false);
    if (res.error === 'already_active') {
      appAlert('You already have an active plan', 'Finish or wait for it to end before starting a new one.');
    } else {
      appAlert('Could not start', 'Please try again.');
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

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Add Manually (top of the list): tap → inline input, confirm appends
            a task row and auto-selects it. */}
        {adding ? (
          <OffsetCard color={OFFSET} offset={4} radius={16} cardStyle={styles.taskRow} style={styles.rowGap}>
            <TextInput
              style={styles.addInput}
              placeholder="Write your own task…"
              placeholderTextColor={MUTED}
              value={draft}
              onChangeText={setDraft}
              autoFocus
              maxLength={80}
              onSubmitEditing={onAddManual}
              returnKeyType="done"
            />
            <Pressable onPress={onAddManual} hitSlop={8} style={[styles.addConfirm, !draft.trim() && { opacity: 0.4 }]}>
              <MaterialIcons name="check" size={20} color="#FFFFFF" />
            </Pressable>
            <Pressable onPress={() => { setAdding(false); setDraft(''); }} hitSlop={8}>
              <MaterialIcons name="close" size={22} color={MUTED} />
            </Pressable>
          </OffsetCard>
        ) : (
          <OffsetCard
            color={OFFSET}
            offset={4}
            radius={16}
            onPress={() => setAdding(true)}
            cardStyle={styles.taskRow}
            style={styles.rowGap}
          >
            <View style={styles.addPlus}>
              <MaterialIcons name="add" size={18} color="#FFFFFF" />
            </View>
            <Text style={styles.addText}>Add Manually</Text>
          </OffsetCard>
        )}

        {items.map((it) => {
          const on = selected.includes(it.id);
          const full = !on && count >= TASKS_TO_PICK;
          return (
            <OffsetCard
              key={it.id}
              color={OFFSET}
              offset={4}
              radius={16}
              onPress={() => toggle(it.id)}
              cardStyle={[styles.taskRow, on && styles.taskRowOn]}
              style={[styles.rowGap, full && styles.taskRowDim]}
            >
              <View style={[styles.checkbox, on && styles.checkboxOn]}>
                {on && <MaterialIcons name="check" size={16} color="#FFFFFF" />}
              </View>
              <Text style={[styles.taskText, on && styles.taskTextOn]}>{it.text}</Text>
              {it.manual && (
                <Pressable onPress={() => removeManual(it.id)} hitSlop={8}>
                  <MaterialIcons name="close" size={18} color={MUTED} />
                </Pressable>
              )}
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
  addPlus: { width: 24, height: 24, borderRadius: 8, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center' },
  addText: { flex: 1, fontSize: 15, fontFamily: 'Inter_700Bold', color: TEXT },
  addInput: { flex: 1, fontSize: 15, fontFamily: 'Inter_500Medium', color: TEXT, paddingVertical: 0 },
  addConfirm: { width: 28, height: 28, borderRadius: 14, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center' },
  taskTextOn: { fontFamily: 'Inter_700Bold' },

  bottomBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 10 },
  closeX: { width: 48, height: 48, borderRadius: 24, backgroundColor: CARD, alignItems: 'center', justifyContent: 'center' },
  startBtn: { flex: 1, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  startText: { fontSize: 16, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },

  linkBtn: { marginTop: 16, alignSelf: 'flex-start' },
  linkText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: ORANGE },
});
