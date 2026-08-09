import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { ITEM_DICTIONARY } from '@novame/engine';

import {
  getReflectStateToday,
  submitReflect,
  type ReflectError,
  type ReflectSnapshot,
} from '../../src/lib/reflect-api';
import { fetchReflectFeed } from '../../src/lib/reflect-feed-api';
import { fetchBags } from '../../src/lib/bags-api';
import { haptics } from '../../src/lib/haptics';
import { BACKGROUNDS } from '../../src/lib/icons';
import { OffsetCard } from '../../src/components/ui/offset-card';
import { ItemSprite } from '../../src/components/ui/item-sprite';
import {
  RC,
  ReflectResultView,
  ReflectTopBar,
  SelectableItemGrid,
} from '../../src/components/main/reflect-shared';

const MAX_CHARS = 5000;

// v3 (2026-07-30): the library picker groups by the 11 prompt-reflection
// categories (curated, ranked). 'all' = their union in sheet order.
import { availableGuidedCategories, itemsForGuidedCategory } from '../../src/lib/guided-prompts';

const PICKER_CATEGORIES = availableGuidedCategories();
const ALL_IDS: string[] = (() => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of PICKER_CATEGORIES) {
    for (const id of itemsForGuidedCategory(c.key)) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  return out;
})();

/**
 * 流程3 — Object Reflect: pick items from the whole library (category chips +
 * name search), then write the memory to attach (REQUIRED — this flow's text
 * is the anchor; per-item edit doesn't exist here). Server: mode 'items'.
 */
type Phase = 'pick' | 'write' | 'result';

export default function ReflectItemsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const initial = useMemo(() => getReflectStateToday(), []);
  const [phase, setPhase] = useState<Phase>('pick');
  const [category, setCategory] = useState('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ReflectError | null>(null);
  const [result, setResult] = useState<ReflectSnapshot | null>(null);
  const [remaining, setRemaining] = useState(initial.reflectsRemaining);

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  useFocusEffect(
    useCallback(() => {
      if (phaseRef.current !== 'result') setRemaining(getReflectStateToday().reflectsRemaining);
    }, []),
  );

  const gridIds = useMemo(() => {
    const base = category === 'all' ? ALL_IDS : itemsForGuidedCategory(category);
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((id) =>
      (ITEM_DICTIONARY.items[id]?.displayName ?? '').toLowerCase().includes(q),
    );
  }, [category, query]);

  const selectedList = useMemo(() => [...selected], [selected]);

  const toggle = useCallback((id: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  async function onSubmit() {
    if (submitting || selected.size === 0 || body.trim().length === 0) return;
    setSubmitting(true);
    setError(null);
    const res = await submitReflect({
      promptId: 9,
      body,
      mode: 'items',
      selectedItems: selectedList.map((id) => ({ itemId: id })),
    });
    setSubmitting(false);
    if (res.ok) {
      setResult(res.snapshot);
      setRemaining(res.snapshot.reflectsRemaining);
      void fetchReflectFeed();
      void fetchBags();
      void haptics.success();
      setPhase('result');
    } else {
      setError(res.error);
      if (res.error === 'daily_limit') setRemaining(0);
    }
  }

  const atLimit = remaining <= 0;

  return (
    <View style={{ flex: 1, backgroundColor: '#5A2E2A' }}>
      <ExpoImage source={BACKGROUNDS.reflect} style={StyleSheet.absoluteFill} contentFit="cover" />
      <View style={styles.scrim} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={[styles.root, { paddingTop: insets.top + 10 }]}>
          {phase !== 'result' && (
            <View style={styles.topRow}>
              <ReflectTopBar
                remaining={phase === 'write' ? remaining : undefined}
                onBack={() => (phase === 'write' ? setPhase('pick') : router.back())}
              />
              {phase === 'pick' && (
                <Pressable
                  onPress={() => { void haptics.light(); setSearchOpen((v) => !v); if (searchOpen) setQuery(''); }}
                  style={styles.searchPill}
                  hitSlop={8}
                >
                  <MaterialIcons name="search" size={18} color="#FFFFFF" />
                  <Text style={styles.searchPillText}>Search</Text>
                </Pressable>
              )}
            </View>
          )}

          {atLimit && phase !== 'result' ? (
            <View style={styles.center}>
              <Text style={styles.restTitle}>That’s three for today</Text>
              <Text style={styles.restBody}>
                You&apos;ve reflected 3 times today. Rest up — come back tomorrow.
              </Text>
            </View>
          ) : phase === 'pick' ? (
            <View style={{ flex: 1 }}>
              <Text style={styles.stepTitle}>What items do you want to create memory on?</Text>
              {searchOpen && (
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search items…"
                  placeholderTextColor="#B7AEA6"
                  value={query}
                  onChangeText={setQuery}
                  autoFocus
                />
              )}
              {/* Category strip: "all" + the 11 prompt themes (emoji chips) */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.catStripScroll}
                contentContainerStyle={styles.catStrip}
              >
                {['all', ...PICKER_CATEGORIES.map((c) => c.key)].map((key) => {
                  const active = key === category;
                  const def = PICKER_CATEGORIES.find((c) => c.key === key);
                  return (
                    <Pressable
                      key={key}
                      onPress={() => { void haptics.light(); setCategory(key); }}
                      style={[styles.catChip, active && styles.catChipActive]}
                    >
                      {key === 'all' ? (
                        <MaterialIcons name="apps" size={22} color={active ? '#FFF6DE' : '#B99C6B'} />
                      ) : (
                        <Text style={styles.catEmoji}>{def?.emoji ?? '✨'}</Text>
                      )}
                    </Pressable>
                  );
                })}
              </ScrollView>
              <View style={styles.gridCard}>
                <SelectableItemGrid itemIds={gridIds} selected={selected} onToggle={toggle} />
              </View>
              <OffsetCard
                color={RC.yellowDrop}
                offset={4}
                radius={24}
                onPress={() => { void haptics.light(); setPhase('write'); }}
                disabled={selected.size === 0}
                style={{ marginTop: 14, marginBottom: insets.bottom + 12, opacity: selected.size === 0 ? 0.55 : 1 }}
                cardStyle={styles.yellowBtn}
              >
                <Text style={styles.yellowBtnText}>Next</Text>
              </OffsetCard>
            </View>
          ) : phase === 'write' ? (
            <View style={{ flex: 1 }}>
              <Text style={styles.stepTitleLeft}>Write down the memories you want to attach</Text>
              <TextInput
                style={styles.input}
                placeholder="Start here…"
                placeholderTextColor="#B7AEA6"
                value={body}
                onChangeText={(t) => setBody(t.slice(0, MAX_CHARS))}
                multiline
                autoFocus
                textAlignVertical="top"
              />
              <View style={styles.countRow}>
                {error ? <Text style={styles.errorText}>Couldn’t save that. Try again.</Text> : <View />}
                <Text style={styles.count}>{body.length} / {MAX_CHARS}</Text>
              </View>

              <Text style={styles.matchLabel}>Selected Item</Text>
              <View style={styles.selectedCard}>
                <ScrollView contentContainerStyle={styles.selectedWrap} showsVerticalScrollIndicator={false}>
                  {selectedList.map((id) => (
                    <ItemSprite key={id} itemId={id} size={44} radius={12} />
                  ))}
                </ScrollView>
              </View>

              <OffsetCard
                color={RC.yellowDrop}
                offset={4}
                radius={24}
                onPress={() => void onSubmit()}
                disabled={submitting || body.trim().length === 0}
                style={{ marginTop: 16, marginBottom: insets.bottom + 12, opacity: submitting || body.trim().length === 0 ? 0.55 : 1 }}
                cardStyle={styles.yellowBtn}
              >
                {submitting ? <ActivityIndicator color={RC.ink} /> : (
                  <Text style={styles.yellowBtnText}>Save Reflection</Text>
                )}
              </OffsetCard>
            </View>
          ) : (
            result && (
              <View style={{ flex: 1, paddingBottom: insets.bottom + 12 }}>
                <ReflectResultView result={result} onFinished={() => router.back()} />
              </View>
            )
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 18 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: RC.scrim },
  topRow: { position: 'relative' },
  searchPill: {
    position: 'absolute', right: 0, top: 0,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#43301F', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 12,
  },
  searchPillText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },

  stepTitle: { fontSize: 21, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF', textAlign: 'center', marginBottom: 12 },
  stepTitleLeft: { fontSize: 19, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF', marginBottom: 12 },
  searchInput: {
    backgroundColor: '#FFFFFF', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15, fontFamily: 'Inter_500Medium', color: '#2A2118', marginBottom: 10,
  },
  // Capsule on the ScrollView, not the content container — a border on the
  // content scrolls with it on small screens (same fix as the Bags strip).
  catStrip: {
    flexGrow: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 6,
  },
  catStripScroll: {
    flexGrow: 0,
    backgroundColor: '#FFF8E3', borderRadius: 26, borderWidth: 1.5, borderColor: '#3E2C1A',
    marginBottom: 12, overflow: 'hidden',
  },
  catEmoji: { fontSize: 20 },
  catChip: { width: 42, height: 42, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  catChipActive: { backgroundColor: '#4A3423', width: 56 },
  catPlaceholder: { width: 26, height: 26, borderRadius: 9, backgroundColor: 'rgba(74,52,35,0.06)' },

  gridCard: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 26 },

  input: {
    flex: 1, backgroundColor: '#FFFFFF', borderRadius: 24, padding: 18,
    fontSize: 16, fontFamily: 'Inter_400Regular', lineHeight: 24, color: '#2A2118',
  },
  countRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  count: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  errorText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#FFD9D9', flex: 1, marginRight: 8 },

  matchLabel: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF', textAlign: 'center', marginTop: 12, marginBottom: 8 },
  selectedCard: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 12, maxHeight: 150 },
  selectedWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },

  yellowBtn: { backgroundColor: RC.yellow, alignItems: 'center', paddingVertical: 17 },
  yellowBtnText: { fontSize: 19, fontFamily: 'Inter_800ExtraBold', color: '#5A4419' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 24 },
  restTitle: { fontSize: 24, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
  restBody: { fontSize: 16, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.95)', textAlign: 'center', lineHeight: 24 },
});
