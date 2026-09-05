import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { ScreenOverlay as Modal } from '@/components/ui/screen-overlay';
import { AndroidCompactText as Text, AndroidCompactTextInput as TextInput } from '@/components/ui/android-compact-typography';
import { MaterialIcons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { router } from 'expo-router';
import { useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { appAlert } from '@/components/ui/app-dialog';
import { CloverBurst } from '@/components/main/clover-burst';
import { ItemSprite } from '@/components/ui/item-sprite';
import { OffsetCard } from '@/components/ui/offset-card';
import { SpringPop } from '@/components/ui/spring-pop';
import { haptics } from '@/lib/haptics';
import { ICONS } from '@/lib/icons';
import {
  enrichReflectDraft,
  finalizeReflect,
  type MatchedItem,
  type PreparedReflect,
  type ReflectMemoryDraft,
  type ReflectSnapshot,
} from '@/lib/reflect-api';
import { emitOfficialRatingRequest, recordReflectClaimForRating } from '@/lib/official-rating-prompt';
import { recordReflectionPaywallClaim } from '@/lib/reflection-paywall-count';
import { markNavigationTransitionPending } from '@/lib/rating-navigation';
import { useSubscriptionTier } from '@/lib/use-subscription-tier';
import { useMemoryEditorKeyboard } from '@/lib/use-memory-editor-keyboard';
import { useReflectExitGuard } from '@/lib/use-reflect-exit-guard';
import {
  holdReflectSettlement, releaseReflectSettlement, readSettlementCheckpoint,
  writeSettlementCheckpoint, flushSettlementCheckpoint,
} from '@/lib/reflect-settlement-outbox';

import { RC } from './reflect-shared';
import { logFirstReflectCompleted } from '@/lib/meta-analytics';

const INVALID_AI_MEMORY = [
  /\bno (?:specific )?memor(?:y|ies)\b/i,
  /\b(?:journal|reflection|entry) (?:does not|doesn't|did not|didn't) (?:mention|include|record|describe)\b/i,
  /\b(?:was|were|is|are) not (?:mentioned|included|recorded|described|provided)\b/i,
  /\b(?:not enough|insufficient|no) (?:specific )?(?:context|detail|information)\b/i,
  /\bnothing (?:specific )?(?:was )?(?:mentioned|included|recorded|described|provided)\b/i,
];

function usableAiMemory(value: string | undefined): string {
  const clean = value?.trim() || '';
  return clean && !INVALID_AI_MEMORY.some((pattern) => pattern.test(clean)) ? clean : '';
}

export function MatchedItemsReviewSheet({
  items,
  onRemove,
  onDone,
}: {
  items: MatchedItem[];
  onRemove: (itemId: string) => void;
  onDone: () => void;
}) {
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  return (
    <View style={styles.overlay}>
      <View style={styles.modalCard}>
        <Text style={styles.reviewTitle}>See an Item that doesn’t fit?{`\n`}Tap to remove it.</Text>
        <ScrollView keyboardShouldPersistTaps="always" contentContainerStyle={styles.itemGrid} showsVerticalScrollIndicator={false}>
          {items.filter(item => !removed.has(item.itemId)).map((item) => (
            <Pressable
              key={item.itemId}
              onPress={() => { void haptics.light(); setRemoved(old => new Set(old).add(item.itemId)); }}
              style={({ pressed }) => [styles.reviewItem, pressed && { opacity: 0.55 }]}
            >
              <ItemSprite itemId={item.itemId} size={58} radius={14} />
              <MaterialIcons name="close" size={15} color="#FFFFFF" style={styles.removeBadge} />
            </Pressable>
          ))}
        </ScrollView>
        <OffsetCard
          color="#CBBDAA"
          offset={4}
          radius={22}
          onPress={() => { removed.forEach(onRemove); onDone(); }}
          style={styles.brownButtonWrap}
          cardStyle={styles.brownButton}
        >
          <Text style={styles.brownButtonText}>Confirm</Text>
        </OffsetCard>
      </View>
    </View>
  );
}

export function MemoryEditorSheet({
  items,
  memories,
  isPaid,
  shared,
  allowUseMyWords = true,
  onChange,
  onDone,
  saving = false,
}: {
  items: MatchedItem[];
  memories: ReflectMemoryDraft[];
  isPaid: boolean;
  shared: boolean;
  allowUseMyWords?: boolean;
  onChange: (memories: ReflectMemoryDraft[]) => void;
  onDone: () => void;
  saving?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const editorKeyboard = useMemoryEditorKeyboard();
  const closeEditor = () => { Keyboard.dismiss(); onDone(); };
  const byId = useMemo(() => new Map(memories.map((memory) => [memory.itemId, memory])), [memories]);
  const update = (itemId: string, patch: Partial<ReflectMemoryDraft>) => {
    onChange(memories.map((memory) => memory.itemId === itemId ? { ...memory, ...patch } : memory));
  };
  const useWords = () => {
    void haptics.medium();
    onChange(memories.map((memory) => {
      if (memory.text.trim()) return memory;
      const source = items.find((item) => item.itemId === memory.itemId)?.sourceExcerpt?.trim() || '';
      return source ? { ...memory, text: source, source: 'use_my_words' } : memory;
    }));
  };

  return (
    <Modal
      transparent
      animationType="fade"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={closeEditor}
    >
      <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View
          style={[
            styles.fullScreenOverlay,
            { paddingTop: Math.max(insets.top, 8) + 8, paddingBottom: Math.max(insets.bottom, 8) + 8 },
          ]}
        >
          <View style={styles.editorFrame}>
            <View style={styles.editorCard}>
              <View style={styles.editorHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.editorTitle}>{items.length} {items.length === 1 ? 'Item' : 'Items'}</Text>
                  <Text style={styles.editorSub}>
                    Items with memories will be saved to your hub. Tap to edit.
                  </Text>
                </View>
                {allowUseMyWords && !isPaid && memories.some((memory) => !memory.text.trim()) && items.some((item) => item.sourceExcerpt?.trim()) && (
                  <Pressable onPress={useWords} style={styles.useWordsButton}>
                    <Text style={styles.useWordsText}>Use My Words</Text>
                  </Pressable>
                )}
              </View>
              <View ref={editorKeyboard.viewportRef} collapsable={false} style={styles.editorScroll}
                onLayout={editorKeyboard.onViewportLayout}>
              <ScrollView
                ref={editorKeyboard.scrollRef}
                style={styles.editorScroll}
                contentContainerStyle={styles.editorRows}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                nestedScrollEnabled
                onScrollBeginDrag={Keyboard.dismiss}
                onScroll={editorKeyboard.onScroll}
                scrollEventThrottle={16}
                onContentSizeChange={editorKeyboard.onContentSizeChange}
                showsVerticalScrollIndicator={false}
              >
                {items.map((item) => {
                  const memory = byId.get(item.itemId)!;
                  return (
                    <View key={item.itemId} style={styles.editorRow}>
                      <ItemSprite itemId={item.itemId} size={54} radius={13} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.editorName}>{item.displayName}</Text>
                        <TextInput
                          ref={(node) => editorKeyboard.setInputRef(item.itemId, node)}
                          value={memory.text}
                          placeholder="Type here"
                          placeholderTextColor="#B7AEA6"
                          multiline
                          textAlignVertical="top"
                          style={[styles.editorInput, { maxHeight: editorKeyboard.inputMaxHeight }]}
                          onFocus={() => editorKeyboard.onFocus(item.itemId)}
                          onBlur={() => editorKeyboard.onBlur(item.itemId)}
                          onLayout={editorKeyboard.revealFocused}
                          onContentSizeChange={editorKeyboard.revealFocused}
                          onChangeText={(text) => update(item.itemId, { text: text.slice(0, 500), source: 'manual' })}
                        />
                      </View>
                      {!shared && (
                        <Pressable
                          onPress={() => { void haptics.light(); update(item.itemId, { visible: !memory.visible }); }}
                          style={[styles.toggle, memory.visible ? styles.toggleOn : styles.toggleOff]}
                        >
                          <Text style={styles.toggleText}>{memory.visible ? 'ON' : 'OFF'}</Text>
                          <View style={styles.toggleKnob} />
                        </Pressable>
                      )}
                    </View>
                  );
                })}
              </ScrollView>
              </View>
              <OffsetCard
                color={RC.yellowDrop}
                offset={4}
                radius={22}
                onPress={closeEditor}
                disabled={saving}
                cardStyle={styles.doneButton}
              >
                {saving ? <ActivityIndicator color="#633A21" /> : <Text style={styles.doneText}>Done</Text>}
              </OffsetCard>
              {!shared && <Text style={styles.editorFoot}>Turn off the toggle if you don’t want the memory seen by your paired.</Text>}
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ShareItemsSheet({
  items,
  memories,
  onChange,
  onDone,
}: {
  items: MatchedItem[];
  memories: ReflectMemoryDraft[];
  onChange: (memories: ReflectMemoryDraft[]) => void;
  onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  const hidden = new Set(memories.filter((memory) => !memory.visible).map((memory) => memory.itemId));
  const toggle = (itemId: string) => {
    void haptics.light();
    onChange(memories.map((memory) => memory.itemId === itemId
      ? { ...memory, visible: !memory.visible }
      : memory));
  };
  return (
    <Modal
      transparent
      animationType="fade"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onDone}
    >
      <View style={styles.modalRoot}>
        <View
          style={[
            styles.fullScreenOverlay,
            { paddingTop: Math.max(insets.top, 8) + 8, paddingBottom: Math.max(insets.bottom, 8) + 8 },
          ]}
        >
          <View style={styles.shareModalCard}>
            <Text style={styles.shareReviewTitle}>Click to select the items you don’t{`\n`}want your person to see.</Text>
            <ScrollView
              style={styles.shareItemsScroll}
              contentContainerStyle={styles.shareItemGrid}
              showsVerticalScrollIndicator={false}
            >
              {items.map((item) => (
                <Pressable
                  key={item.itemId}
                  onPress={() => toggle(item.itemId)}
                  style={[styles.shareReviewItem, hidden.has(item.itemId) && styles.hiddenItem]}
                >
                  <ItemSprite itemId={item.itemId} size={52} radius={13} />
                  {hidden.has(item.itemId) && (
                    <MaterialIcons name="visibility-off" size={17} color="#FFFFFF" style={styles.removeBadge} />
                  )}
                </Pressable>
              ))}
            </ScrollView>
            <Pressable
              onPress={() => onChange(memories.map((memory) => ({
                ...memory,
                visible: hidden.size === items.length,
              })))}
              style={styles.selectAllRow}
            >
              <MaterialIcons name={hidden.size === items.length ? 'check-box' : 'check-box-outline-blank'} size={25} color="#5A351B" />
              <Text style={styles.selectAllText}>{hidden.size === items.length ? 'Show All' : 'Hide All'}</Text>
            </Pressable>
            <OffsetCard
              color="#CBBDAA"
              offset={4}
              radius={20}
              onPress={onDone}
              style={styles.brownButtonWrap}
              cardStyle={styles.brownButton}
            >
              <Text style={styles.brownButtonText}>Confirm</Text>
            </OffsetCard>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function ReflectSettlementView({
  draft,
  itemWord,
  shared = false,
  onPresented,
  onFinalized,
}: {
  draft: PreparedReflect;
  itemWord: 'Matched' | 'Selected';
  shared?: boolean;
  onPresented: (draftId: string) => void;
  onFinalized: (snapshot: ReflectSnapshot) => void;
}) {
  const insets = useSafeAreaInsets();
  const tier = useSubscriptionTier();
  const isPaid = tier !== 'free';
  const presented = useRef<string | null>(null);
  // Prepare normally supplies Plus copy. Still run one blank-only enrichment
  // pass so an AI timeout, a concurrent idempotent retry, or an in-page
  // purchase can recover without replacing anything the user typed.
  const enriched = useRef(false);
  const [memories, setMemories] = useState<ReflectMemoryDraft[]>(() =>
    (draft.userId ? readSettlementCheckpoint(draft.userId, draft.draftId)?.memories : null)
    ?? draft.memories ?? draft.matchedItems.map((item) => {
    const aiText = usableAiMemory(draft.aiMemories[item.itemId]);
    return {
      itemId: item.itemId,
      text: aiText,
      source: aiText ? 'ai' : 'manual',
      visible: true,
      edited: false,
    };
  }));
  const memoriesRef = useRef(memories);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishLock = useRef(false);
  const [completed, setCompleted] = useState<ReflectSnapshot | null>(null);
  const delivered = useRef(false);
  const route = useRoute();
  useReflectExitGuard(!completed);
  // Navigation happens only after the guard has been lifted by a committed render.
  useEffect(() => {
    if (!completed || delivered.current) return;
    delivered.current = true;
    releaseReflectSettlement(draft.draftId);
    if (Platform.OS !== 'web') markNavigationTransitionPending(route.key);
    recordReflectionPaywallClaim(!isPaid);
    if (!shared) logFirstReflectCompleted(draft.userId);
    onFinalized(completed);
    if (recordReflectClaimForRating()) emitOfficialRatingRequest();
  }, [completed, draft.draftId, isPaid, onFinalized, route.key, shared]);

  function persistMemories(next: ReflectMemoryDraft[]) {
    memoriesRef.current = next;
    const checkpoint = writeSettlementCheckpoint(draft, next);
    setMemories(next);
    if (flushTimer.current) clearTimeout(flushTimer.current);
    if (checkpoint) flushTimer.current = setTimeout(() => { void flushSettlementCheckpoint(checkpoint); }, 600);
  }
  function editMemories(next: ReflectMemoryDraft[]) {
    if (finishLock.current) return;
    persistMemories(next.map((memory) => {
      const previous = memoriesRef.current.find((old) => old.itemId === memory.itemId);
      return previous?.text !== memory.text || previous?.source !== memory.source
        ? { ...memory, edited: true } : memory;
    }));
  }
  useEffect(() => {
    holdReflectSettlement(draft.draftId);
    writeSettlementCheckpoint(draft, memoriesRef.current);
    const flush = () => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
      const checkpoint = draft.userId && readSettlementCheckpoint(draft.userId, draft.draftId);
      if (checkpoint) void flushSettlementCheckpoint(checkpoint);
    };
    const listener = AppState.addEventListener('change', (state) => { if (state !== 'active') flush(); });
    return () => { listener.remove(); flush(); releaseReflectSettlement(draft.draftId); };
  }, [draft]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [rewardToast, setRewardToast] = useState(true);
  const handleRewardDone = useCallback(() => setRewardToast(false), []);

  useEffect(() => { Keyboard.dismiss(); }, []);

  useEffect(() => {
    if (!isPaid || !draft.hasContext || enriched.current) return;
    enriched.current = true;
    const empty = memories.filter((memory) => !memory.text.trim()).map((memory) => memory.itemId);
    if (empty.length === 0) return;
    setEnriching(true);
    void enrichReflectDraft(draft.draftId, empty).then((result) => {
      if (result.ok && !finishLock.current) {
        persistMemories(memoriesRef.current.map((memory) => {
          if (memory.edited || memory.text.trim()) return memory;
          const text = usableAiMemory(result.aiMemories[memory.itemId]);
          return text ? { ...memory, text, source: 'ai' } : memory;
        }));
      }
      setEnriching(false);
    });
  }, [draft.draftId, draft.hasContext, isPaid]);

  const savedCount = memories.filter((memory) => memory.text.trim()).length;
  const hiddenCount = shared ? 0 : memories.filter((memory) => !memory.visible).length;
  const allCreated = savedCount === memories.length && memories.length > 0;

  async function finish() {
    if (finishLock.current) return;
    finishLock.current = true;
    void haptics.medium();
    setSaving(true);
    if (flushTimer.current) clearTimeout(flushTimer.current);
    const result = await finalizeReflect(draft, memoriesRef.current);
    setSaving(false);
    if (!result.ok) {
      finishLock.current = false;
      appAlert(
        result.error === 'daily_limit'
          ? 'That’s three for today'
          : result.error === 'plus_required'
            ? 'Burrow Plus required'
            : 'Could not save that',
        result.error === 'daily_limit'
          ? "You've reflected 3 times today. Rest up — come back tomorrow."
          : result.error === 'plus_required'
            ? 'Restore or renew Plus to finish this Shared Memory.'
            : 'Please check your connection and try again.',
      );
      return;
    }
    void haptics.success();
    setCompleted(result.snapshot);
  }

  return (
    <View style={styles.settlement} onLayout={(event) => {
      if (event.nativeEvent.layout.height <= 0 || event.nativeEvent.layout.width <= 0
        || presented.current === draft.draftId) return;
      presented.current = draft.draftId;
      // The flow preloads audio while writing. Start on the first visible layout,
      // not in a late effect or after AI/reward/finalize requests.
      onPresented(draft.draftId);
    }}>
      <ScrollView
        style={styles.settlementViewport}
        contentContainerStyle={[
          styles.settlementScroll,
          { paddingBottom: insets.bottom + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {isPaid && (
          <View style={styles.plusBadge}>
            <ExpoImage source={ICONS.Plus} style={styles.plusBadgeIcon} contentFit="contain" />
            <Text style={styles.plusBadgeText}>Burrow Plus</Text>
          </View>
        )}
        <View pointerEvents="none" style={styles.rewardSlot}>
          {rewardToast && (
            <CloverBurst amount={30} durationMs={2000} riseDistance={4} onDone={handleRewardDone} />
          )}
        </View>
        <Text style={styles.celebration}>🎉</Text>
        <Text style={styles.savedTitle}>REFLECTION SAVED</Text>
        <Text style={styles.savedSub}>Your full reflection is private in My Logs.</Text>

        <View style={styles.summaryRegion}>
        <SpringPop boundedBounce>
          <Pressable onPress={() => { void haptics.pageOpen(); setEditorOpen(true); }} style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>{draft.matchedItems.length} Items {itemWord}</Text>
            <Text style={styles.summarySub}>
              {enriching
                ? 'Creating memories…'
                : isPaid && allCreated
                  ? 'All memories are created. Click here to edit.'
                  : savedCount > 0
                    ? `${savedCount} will be saved to your memories hub. Click here to edit.`
                    : 'Click here to add memories.'}
            </Text>
            <View style={styles.summaryItems}>
              {draft.matchedItems.map((item) => (
                <ItemSprite key={item.itemId} itemId={item.itemId} size={58} radius={14} />
              ))}
            </View>
          </Pressable>
        </SpringPop>
        </View>

        {!shared && (
          <Pressable onPress={() => { void haptics.pageOpen(); setShareOpen(true); }} style={styles.shareCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.shareTitle}>Any items you don’t want to share? Edit here.</Text>
              {hiddenCount > 0 && <Text style={styles.shareStatus}>{hiddenCount} items will not be seen by your paired</Text>}
            </View>
            <View style={styles.editCircle}><MaterialIcons name="edit" size={20} color="#5A351B" /></View>
          </Pressable>
        )}

        <View style={[styles.settlementFooter, shared && styles.sharedSettlementFooter]}>
          {!isPaid && (
            <View style={styles.upgradeActions}>
              <Text style={styles.joinCopy}>You can join Plus to turn reflections into memories automatically.</Text>
              <OffsetCard
                color={RC.yellowDrop}
                offset={4}
                radius={24}
                onPress={() => {
                  router.push('/(main)/(modals)/subscription-paywall?phase=plans&continueReflect=1' as never);
                }}
                cardStyle={styles.joinButton}
              >
                <Text style={styles.joinText}>Join Burrow Plus</Text>
              </OffsetCard>
            </View>
          )}
          <OffsetCard color="#D96B3F" offset={4} radius={24} onPress={() => void finish()} disabled={saving} cardStyle={styles.finishButton}>
            {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.finishText}>Done</Text>}
          </OffsetCard>
        </View>
      </ScrollView>

      {editorOpen && (
        <MemoryEditorSheet
          items={draft.matchedItems}
          memories={memories}
          isPaid={isPaid}
          shared={shared}
          allowUseMyWords={draft.mode === 'typing'}
          onChange={editMemories}
          onDone={() => { void haptics.pageClose(); setEditorOpen(false); }}
        />
      )}
      {shareOpen && (
        <ShareItemsSheet
          items={draft.matchedItems}
          memories={memories}
          onChange={editMemories}
          onDone={() => { void haptics.pageClose(); setShareOpen(false); }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject, zIndex: 40, backgroundColor: 'rgba(25,18,16,0.58)',
    alignItems: 'center', justifyContent: 'center', padding: 18,
  },
  modalRoot: { flex: 1 },
  fullScreenOverlay: {
    flex: 1,
    backgroundColor: 'rgba(25,18,16,0.64)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  modalCard: { width: '100%', maxHeight: '82%', backgroundColor: '#FFF7E7', borderRadius: 30, padding: 22 },
  reviewTitle: { fontSize: 24, lineHeight: 32, fontFamily: 'Inter_800ExtraBold', textAlign: 'center', color: '#161311', marginVertical: 22 },
  itemGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12, paddingVertical: 16 },
  reviewItem: { position: 'relative', borderRadius: 16, backgroundColor: '#B27A4C', padding: 5 },
  hiddenItem: { backgroundColor: '#7B4B37', opacity: 0.72 },
  removeBadge: { position: 'absolute', right: 2, top: 2, borderRadius: 10, backgroundColor: '#8B3D2E', padding: 2 },
  brownButtonWrap: { marginTop: 16 },
  brownButton: { backgroundColor: '#84503E', alignItems: 'center', paddingVertical: 15 },
  brownButtonText: { color: '#FFFFFF', fontSize: 17, fontFamily: 'Inter_800ExtraBold' },
  selectAllRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7, marginTop: 13 },
  selectAllText: { fontSize: 16, fontFamily: 'Inter_800ExtraBold', color: '#1E1712' },
  shareModalCard: { width: '100%', maxWidth: 500, maxHeight: '88%', backgroundColor: '#FFF7E7', borderRadius: 28, padding: 20 },
  shareReviewTitle: { fontSize: 20, lineHeight: 27, fontFamily: 'Inter_800ExtraBold', textAlign: 'center', color: '#161311', marginTop: 6, marginBottom: 14 },
  shareItemsScroll: { flexShrink: 1 },
  shareItemGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, paddingVertical: 12 },
  shareReviewItem: { position: 'relative', borderRadius: 15, backgroundColor: '#B27A4C', padding: 4 },
  editorFrame: { backgroundColor: RC.yellow, borderRadius: 30, padding: 9, width: '100%', maxWidth: 520, flex: 1, minHeight: 0 },
  editorCard: { backgroundColor: '#FDF9F1', borderRadius: 22, padding: 15, flex: 1, minHeight: 0 },
  editorHeader: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginBottom: 14 },
  editorTitle: { fontSize: 25, fontFamily: 'Inter_800ExtraBold', color: '#161311' },
  editorSub: { fontSize: 13, lineHeight: 18, fontFamily: 'Inter_500Medium', color: '#3A2E1A', marginTop: 3 },
  useWordsButton: { backgroundColor: '#54351E', borderRadius: 17, paddingHorizontal: 12, paddingVertical: 10 },
  useWordsText: { color: '#FFFFFF', fontSize: 12, fontFamily: 'Inter_800ExtraBold' },
  editorScroll: { flex: 1, minHeight: 0 },
  editorRows: { gap: 10, paddingBottom: 12 },
  editorRow: { flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1.5, borderColor: '#D8BCA8', borderRadius: 18, padding: 10, backgroundColor: '#FFFFFF' },
  editorName: { fontSize: 15, fontFamily: 'Inter_800ExtraBold', color: '#161311' },
  editorInput: { minHeight: 34, fontSize: 14, lineHeight: 19, fontFamily: 'Inter_500Medium', color: '#2A2118', padding: 0, paddingTop: 4 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 18, padding: 5 },
  toggleOn: { backgroundColor: '#FF8A47' },
  toggleOff: { backgroundColor: '#8C7A68', flexDirection: 'row-reverse' },
  toggleText: { color: '#FFFFFF', fontSize: 11, fontFamily: 'Inter_800ExtraBold' },
  toggleKnob: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#FFFFFF' },
  doneButton: { backgroundColor: RC.yellow, alignItems: 'center', paddingVertical: 15 },
  doneText: { color: '#5A4419', fontSize: 18, fontFamily: 'Inter_800ExtraBold' },
  editorFoot: { marginTop: 10, textAlign: 'center', color: '#2A2118', fontSize: 12, fontFamily: 'Inter_700Bold' },
  settlement: { flex: 1 },
  settlementViewport: { flex: 1 },
  // Only the scroll canvas fills the viewport. Its sections stay at intrinsic
  // height: extra screen space belongs below Done, never around the Items card.
  settlementScroll: { flexGrow: 1, justifyContent: 'flex-start', paddingTop: 8 },
  plusBadge: { alignSelf: 'flex-start', backgroundColor: '#54351E', borderRadius: 16, paddingHorizontal: 15, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8 },
  plusBadgeIcon: { width: 20, height: 20 },
  plusBadgeText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter_800ExtraBold' },
  // Keep exactly 48pt after the reward fades. The settlement-only 4pt drift
  // fits this compact slot and the scroll canvas's 8pt top shadow allowance.
  rewardSlot: { height: 48, alignItems: 'center', justifyContent: 'center' },
  celebration: { fontSize: 42, textAlign: 'center' },
  savedTitle: { color: '#FFFFFF', textAlign: 'center', fontSize: 25, fontFamily: 'Inter_800ExtraBold', marginTop: 12 },
  savedSub: { color: '#FFFFFF', textAlign: 'center', fontSize: 16, fontFamily: 'Inter_700Bold', marginTop: 8 },
  summaryRegion: { marginTop: 24 },
  summaryCard: { backgroundColor: '#FFFFFF', borderRadius: 25, padding: 18, alignItems: 'center' },
  summaryTitle: { color: '#12100E', fontSize: 23, fontFamily: 'Inter_800ExtraBold', textAlign: 'center' },
  summarySub: { color: '#2A2118', fontSize: 15, lineHeight: 21, fontFamily: 'Inter_500Medium', textAlign: 'center', marginTop: 8 },
  summaryItems: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 9, marginTop: 14 },
  shareCard: { backgroundColor: '#54351E', borderRadius: 18, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  shareTitle: { color: '#FFFFFF', fontSize: 15, lineHeight: 20, fontFamily: 'Inter_800ExtraBold' },
  shareStatus: { color: '#FF7A2F', fontSize: 13, fontFamily: 'Inter_800ExtraBold', marginTop: 5 },
  editCircle: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  settlementFooter: { gap: 12, marginTop: 36 },
  sharedSettlementFooter: { marginTop: 24 },
  upgradeActions: { gap: 16 },
  joinCopy: { color: '#FFFFFF', textAlign: 'center', fontSize: 14, lineHeight: 19, fontFamily: 'Inter_700Bold', paddingHorizontal: 20 },
  joinButton: { backgroundColor: RC.yellow, alignItems: 'center', paddingVertical: 16 },
  joinText: { color: '#633A21', fontSize: 19, fontFamily: 'Inter_800ExtraBold' },
  finishButton: { backgroundColor: '#FF8A47', alignItems: 'center', paddingVertical: 16 },
  finishText: { color: '#FFFFFF', fontSize: 19, fontFamily: 'Inter_800ExtraBold' },
});
