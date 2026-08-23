import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { appAlert } from '@/components/ui/app-dialog';
import { Image as ExpoImage } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { itemDisplayName } from '../../src/lib/remote-items';

import {
  getReflectStateToday,
  prepareReflect,
  type PreparedReflect,
  type ReflectError,
} from '../../src/lib/reflect-api';
import { fetchReflectFeed } from '../../src/lib/reflect-feed-api';
import { cacheReflectItems, fetchBags, getCachedBags } from '../../src/lib/bags-api';
import { useSubscriptionTier } from '../../src/lib/use-subscription-tier';
import { haptics } from '../../src/lib/haptics';
import { BACKGROUNDS } from '../../src/lib/icons';
import {
  GUIDED_MAX,
  GUIDED_MIN,
  availableGuidedCategories,
  getGuidedFavoriteItems,
  itemsForGuidedCategory,
  getGuidedSelection,
  guidedCategoryFor,
  MAX_ITEMS_PER_REFLECT_CATEGORY,
  reflectCategoryForItem,
  rememberGuidedFavoriteItems,
  setGuidedSelection,
  subcategoriesForGuidedCategory,
} from '../../src/lib/guided-prompts';
import { OffsetCard } from '../../src/components/ui/offset-card';
import { ItemSprite } from '../../src/components/ui/item-sprite';
import {
  RC,
  ReflectTopBar,
  SelectableItemGrid,
} from '../../src/components/main/reflect-shared';
import { ReflectSettlementView } from '../../src/components/main/reflect-settlement';

const MAX_CHARS = 5000;
const FAVORITE_TAB = 'favorite';
const FAVORITE_THRESHOLD = 30;

/**
 * 流程2 — Guided Prompts (2026-07-24 v2): the FIRST run opens the category
 * chooser ("What do you want to reflect on?", pick 3-20 of the taxonomy);
 * afterwards the flow jumps straight into one prompt page PER chosen
 * category (each skippable), then the optional note page. The prompt pages'
 * Edit button reopens the chooser any time. Selection persists per user;
 * questions live in lib/guided-prompts.ts (data-driven — the list follows
 * whatever taxonomy the dictionary currently holds).
 */
type Phase = 'choose' | 'steps' | 'note' | 'result';

export default function ReflectGuidedScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const initial = useMemo(() => getReflectStateToday(), []);
  const all = useMemo(() => availableGuidedCategories(), []);
  const stored = useMemo(() => getGuidedSelection(), []);

  const [phase, setPhase] = useState<Phase>(stored.length >= GUIDED_MIN ? 'steps' : 'choose');
  const [chosen, setChosen] = useState<string[]>(stored);
  // Chooser working copy (so Edit can cancel without touching the real picks).
  const [draft, setDraft] = useState<Set<string>>(new Set(stored));
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ReflectError | null>(null);
  const [preparedDraft, setPreparedDraft] = useState<PreparedReflect | null>(null);
  const [remaining, setRemaining] = useState(initial.reflectsRemaining);
  // Freeze Favorite eligibility and contents when this Guided flow opens.
  // Selections made during this run are persisted on submit, but become
  // visible only the next time the user opens Guided Prompt.
  const favoriteItemsAtOpen = useMemo(() => {
    const explicitHistory = getGuidedFavoriteItems();
    const hasExplicitHistory = Object.values(explicitHistory).some((ids) => ids.length > 0);
    // Existing installs predate explicit selection history. Seed them once
    // from Mine so familiar items do not disappear immediately after upgrade.
    if (hasExplicitHistory) return explicitHistory;
    return getCachedBags().reduce<Record<string, string[]>>((grouped, item) => {
      const category = reflectCategoryForItem(item.itemId);
      if (category) (grouped[category] ??= []).push(item.itemId);
      return grouped;
    }, {});
  }, []);
  const [activeSubcategory, setActiveSubcategory] = useState<string | null>(null);
  const isPaid = useSubscriptionTier() !== 'free';

  const phaseRef = useRef(phase);
  const subcategoryScrollRef = useRef<ScrollView>(null);
  phaseRef.current = phase;
  useFocusEffect(
    useCallback(() => {
      if (phaseRef.current !== 'result') setRemaining(getReflectStateToday().reflectsRemaining);
    }, []),
  );

  const stepDef = guidedCategoryFor(chosen[step] ?? '');
  const stepSubcategories = useMemo(
    () => (chosen[step] ? subcategoriesForGuidedCategory(chosen[step]) : []),
    [chosen, step],
  );
  const favoriteIds = useMemo(
    () => [...new Set(favoriteItemsAtOpen[chosen[step] ?? ''] ?? [])],
    [chosen, favoriteItemsAtOpen, step],
  );
  const showFavorite = favoriteIds.length > FAVORITE_THRESHOLD;

  useEffect(() => {
    setActiveSubcategory(showFavorite ? FAVORITE_TAB : stepSubcategories[0]?.key ?? null);
    const frame = requestAnimationFrame(() => {
      subcategoryScrollRef.current?.scrollTo({ x: 0, animated: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [chosen, step, showFavorite, stepSubcategories]);

  const gridIds = useMemo(
    () => {
      if (!chosen[step]) return [];
      if (activeSubcategory === FAVORITE_TAB && showFavorite) return favoriteIds;
      if (activeSubcategory) {
        return stepSubcategories.find((subcategory) => subcategory.key === activeSubcategory)?.itemIds
          ?? itemsForGuidedCategory(chosen[step]);
      }
      return itemsForGuidedCategory(chosen[step]);
    },
    [activeSubcategory, chosen, favoriteIds, showFavorite, step, stepSubcategories],
  );
  const selectedList = useMemo(
    () =>
      [...selected].map((id) => ({
        itemId: id,
        displayName: itemDisplayName(id),
      })),
    [selected],
  );

  const toggle = useCallback((id: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) {
        next.delete(id);
      } else {
        const category = reflectCategoryForItem(id) ?? chosen[step];
        const count = [...next].filter((itemId) => reflectCategoryForItem(itemId) === category).length;
        if (count >= MAX_ITEMS_PER_REFLECT_CATEGORY) {
          appAlert('8 items max', 'You can select up to 8 items in each category.');
          return cur;
        }
        next.add(id);
      }
      return next;
    });
  }, [chosen, step]);

  function toggleDraft(key: string) {
    void haptics.light();
    setDraft((cur) => {
      const next = new Set(cur);
      if (next.has(key)) {
        next.delete(key);
      } else if (next.size >= GUIDED_MAX) {
        appAlert(`Up to ${GUIDED_MAX}`, `You can pick at most ${GUIDED_MAX} themes.`);
        return cur;
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function onConfirmChoose() {
    if (draft.size < GUIDED_MIN) return;
    void haptics.medium();
    // Persist in the chooser's canonical order so prompt pages are stable.
    const ordered = all.filter((c) => draft.has(c.key)).map((c) => c.key);
    setGuidedSelection(ordered);
    setChosen(ordered);
    setStep(0);
    setPhase('steps');
  }

  function openEdit() {
    void haptics.light();
    setDraft(new Set(chosen));
    setPhase('choose');
  }

  function onNext() {
    void haptics.light();
    if (step < chosen.length - 1) {
      setStep(step + 1);
    } else {
      setPhase('note');
    }
  }

  async function onSubmit() {
    if (submitting || selected.size === 0) return;
    setSubmitting(true);
    setError(null);
    const res = await prepareReflect({
      promptId: 9,
      body: note,
      mode: 'prompt',
      selectedItems: [...selected].map((itemId) => ({ itemId })),
    });
    setSubmitting(false);
    if (res.ok) {
      setPreparedDraft(res.draft);
      setPhase('result');
    } else {
      setError(res.error);
      if (res.error === 'daily_limit') setRemaining(0);
    }
  }

  function onBack() {
    if (phase === 'choose') {
      // Editing an existing selection cancels back to the pages; the first
      // run has nothing to fall back to and leaves the flow.
      if (chosen.length >= GUIDED_MIN) setPhase('steps');
      else router.back();
    } else if (phase === 'note') {
      setPhase('steps');
    } else if (phase === 'steps' && step > 0) {
      setStep(step - 1);
    } else {
      router.back();
    }
  }

  const atLimit = remaining <= 0;

  return (
    <View style={{ flex: 1, backgroundColor: '#5A2E2A' }}>
      <ExpoImage source={BACKGROUNDS.reflect} style={StyleSheet.absoluteFill} contentFit="cover" />
      <View pointerEvents="none" style={styles.scrim} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={[styles.root, { paddingTop: insets.top + 10 }]}>
          {phase !== 'result' && (
            <View style={styles.topRow}>
              <ReflectTopBar remaining={phase === 'steps' ? undefined : remaining} onBack={onBack} />
              {phase === 'steps' && (
                <Pressable onPress={openEdit} style={styles.editPill} hitSlop={8}>
                  <MaterialIcons name="edit" size={18} color="#FFFFFF" />
                  <Text style={styles.editPillText}>Edit</Text>
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
          ) : phase === 'choose' ? (
            <View style={{ flex: 1 }}>
              <Text style={styles.chooseTitle}>What do you want to reflect on?</Text>
              <Text style={styles.chooseSub}>Select the activities you engage in.</Text>
              <View style={styles.choosePanel}>
                <Text style={styles.chooseHint}>Select at least {GUIDED_MIN}</Text>
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
                  <View style={styles.pillGrid}>
                    {all.map((c) => {
                      const on = draft.has(c.key);
                      return (
                        <Pressable
                          key={c.key}
                          onPress={() => toggleDraft(c.key)}
                          style={[styles.pill, on && styles.pillOn]}
                        >
                          <Text style={styles.pillEmoji}>{c.emoji}</Text>
                          <Text style={[styles.pillText, on && styles.pillTextOn]}>
                            {c.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </ScrollView>
              </View>
              <OffsetCard
                color={RC.yellowDrop}
                offset={4}
                radius={24}
                onPress={onConfirmChoose}
                disabled={draft.size < GUIDED_MIN}
                style={{ marginTop: 14, opacity: draft.size < GUIDED_MIN ? 0.55 : 1 }}
                cardStyle={styles.yellowBtn}
              >
                <Text style={styles.yellowBtnText}>Confirm</Text>
              </OffsetCard>
              <Text style={[styles.chooseFootnote, { marginBottom: insets.bottom + 10 }]}>
                You can edit anytime by clicking “edit” on page
              </Text>
            </View>
          ) : phase === 'steps' ? (
            <View style={{ flex: 1 }}>
              <Text style={styles.stepTitle}>{stepDef.question}</Text>
              {(showFavorite || stepSubcategories.length > 0) && (
                <ScrollView
                  ref={subcategoryScrollRef}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.subcategoryScroller}
                  contentContainerStyle={styles.subcategoryRow}
                >
                  {showFavorite && (
                    <Pressable
                      onPress={() => { void haptics.light(); setActiveSubcategory(FAVORITE_TAB); }}
                      style={[styles.subcategoryTab, activeSubcategory === FAVORITE_TAB && styles.subcategoryTabOn]}
                    >
                      <Text style={[styles.subcategoryText, activeSubcategory === FAVORITE_TAB && styles.subcategoryTextOn]}>Favorite</Text>
                    </Pressable>
                  )}
                  {stepSubcategories.map((subcategory) => {
                    const active = activeSubcategory === subcategory.key;
                    return (
                      <Pressable
                        key={subcategory.key}
                        onPress={() => { void haptics.light(); setActiveSubcategory(subcategory.key); }}
                        style={[styles.subcategoryTab, active && styles.subcategoryTabOn]}
                      >
                        <Text style={[styles.subcategoryText, active && styles.subcategoryTextOn]}>{subcategory.label}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}
              <View style={styles.gridCard}>
                <SelectableItemGrid
                  key={`${chosen[step] ?? 'none'}:${activeSubcategory ?? 'all'}`}
                  itemIds={gridIds}
                  selected={selected}
                  onToggle={toggle}
                />
              </View>
              <Text style={styles.categoryCount}>
                {[...selected].filter((id) => reflectCategoryForItem(id) === chosen[step]).length} / {MAX_ITEMS_PER_REFLECT_CATEGORY} selected
              </Text>
              <Text style={styles.passHint}>You can pass if nothing you want to select here</Text>
              <OffsetCard
                color={RC.yellowDrop}
                offset={4}
                radius={24}
                onPress={onNext}
                cardStyle={styles.yellowBtn}
                style={{ marginBottom: insets.bottom + 12 }}
              >
                <Text style={styles.yellowBtnText}>Next</Text>
              </OffsetCard>
            </View>
          ) : phase === 'note' ? (
            <View style={{ flex: 1 }}>
              <Text style={styles.stepTitleLeft}>Want to add a little context?</Text>
              <TextInput
                style={styles.input}
                placeholder={isPaid ? 'Add a note & save your items in memories' : 'Type here'}
                placeholderTextColor="#B7AEA6"
                value={note}
                onChangeText={(t) => setNote(t.slice(0, MAX_CHARS))}
                multiline
                textAlignVertical="top"
              />
              <View style={styles.countRow}>
                {error ? (
                  <Text style={styles.errorText}>Couldn’t save that. Try again.</Text>
                ) : <View />}
                <Text style={styles.count}>{note.length} / {MAX_CHARS}</Text>
              </View>

              <Text style={styles.matchLabel}>Items You Selected</Text>
              <View style={styles.matchBar}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.matchRow}>
                  {selectedList.map((m) => (
                    <ItemSprite key={m.itemId} itemId={m.itemId} size={44} radius={12} />
                  ))}
                </ScrollView>
              </View>

              <OffsetCard
                color={RC.yellowDrop}
                offset={4}
                radius={24}
                onPress={() => void onSubmit()}
                disabled={submitting || selected.size === 0}
                style={{ marginTop: 16, marginBottom: insets.bottom + 12, opacity: submitting || selected.size === 0 ? 0.55 : 1 }}
                cardStyle={styles.yellowBtn}
              >
                {submitting ? <ActivityIndicator color={RC.ink} /> : (
                  <Text style={styles.yellowBtnText}>Save Reflection</Text>
                )}
              </OffsetCard>
            </View>
          ) : (
            preparedDraft && (
              <View style={{ flex: 1, paddingBottom: insets.bottom + 12 }}>
                <ReflectSettlementView
                  draft={preparedDraft}
                  itemWord="Selected"
                  onFinalized={(snapshot) => {
                    cacheReflectItems(snapshot);
                    rememberGuidedFavoriteItems([
                      ...Object.values(favoriteItemsAtOpen).flat(),
                      ...selected,
                    ]);
                    setRemaining(snapshot.reflectsRemaining);
                    void fetchReflectFeed({ force: true });
                    void fetchBags('mine');
                    router.back();
                  }}
                />
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
  editPill: {
    position: 'absolute', right: 0, top: 4,
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  editPillText: { fontSize: 17, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF' },

  chooseTitle: { fontSize: 25, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF', textAlign: 'center' },
  chooseSub: { fontSize: 15, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.95)', textAlign: 'center', marginTop: 4, marginBottom: 14 },
  choosePanel: { flex: 1, backgroundColor: '#FFF8E3', borderRadius: 26, padding: 14 },
  chooseHint: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#2A2118', marginBottom: 10, paddingHorizontal: 2 },
  pillGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between' },
  pill: {
    width: '48%', flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FFFFFF', borderRadius: 26, paddingVertical: 14, paddingHorizontal: 10,
  },
  pillOn: { backgroundColor: '#8A5F3F' },
  pillEmoji: { fontSize: 18 },
  pillText: {
    flex: 1, flexShrink: 1, fontSize: 14, lineHeight: 19,
    fontFamily: 'Inter_700Bold', color: '#161311',
  },
  pillTextOn: { color: '#FFFFFF' },
  chooseFootnote: {
    fontSize: 13.5, fontFamily: 'Inter_600SemiBold', color: 'rgba(255,255,255,0.95)',
    textAlign: 'center', marginTop: 10,
  },

  stepTitle: { fontSize: 24, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF', textAlign: 'center', marginBottom: 14 },
  subcategoryScroller: { flexGrow: 0, marginHorizontal: -18, marginBottom: 14 },
  subcategoryRow: { paddingHorizontal: 18, gap: 12 },
  subcategoryTab: {
    minHeight: 48, minWidth: 116, paddingHorizontal: 20, paddingVertical: 13,
    borderRadius: 19, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
  },
  subcategoryTabOn: { backgroundColor: '#53351D' },
  subcategoryText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#161311' },
  subcategoryTextOn: { color: '#FFFFFF' },
  stepTitleLeft: { fontSize: 19, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF', marginBottom: 12 },
  gridCard: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 26 },
  categoryCount: {
    fontSize: 13, fontFamily: 'Inter_700Bold', color: '#FFF6DE',
    textAlign: 'center', marginTop: 9,
  },
  passHint: {
    fontSize: 14, fontFamily: 'Inter_600SemiBold', color: 'rgba(255,255,255,0.95)',
    textAlign: 'center', marginTop: 12, marginBottom: 10,
  },

  input: {
    flex: 1, minHeight: 80, backgroundColor: '#FFFFFF', borderRadius: 24, padding: 18,
    fontSize: 16, fontFamily: 'Inter_400Regular', lineHeight: 24, color: '#2A2118',
  },
  countRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  count: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  errorText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#FFD9D9', flex: 1, marginRight: 8 },

  matchLabel: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF', textAlign: 'center', marginTop: 12, marginBottom: 8 },
  matchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8, height: 72,
    backgroundColor: '#FFFFFF', borderRadius: 22, paddingVertical: 10, paddingLeft: 12, paddingRight: 10,
  },
  matchRow: { gap: 8, alignItems: 'center', flexGrow: 1, justifyContent: 'center' },
  pencilBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#43301F',
    alignItems: 'center', justifyContent: 'center',
  },

  yellowBtn: { backgroundColor: RC.yellow, alignItems: 'center', paddingVertical: 17 },
  yellowBtnText: { fontSize: 19, fontFamily: 'Inter_800ExtraBold', color: '#5A4419' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 24 },
  restTitle: { fontSize: 24, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
  restBody: { fontSize: 16, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.95)', textAlign: 'center', lineHeight: 24 },
});
