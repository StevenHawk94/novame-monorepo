import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { appAlert } from '@/components/ui/app-dialog';
import { ItemSprite } from '@/components/ui/item-sprite';
import { KeyboardDismissView } from '@/components/ui/keyboard-dismiss-view';
import { OffsetCard } from '@/components/ui/offset-card';
import { haptics } from '@/lib/haptics';
import {
  enrichReflectDraft,
  finalizeReflect,
  type MatchedItem,
  type PreparedReflect,
  type ReflectMemoryDraft,
  type ReflectSnapshot,
} from '@/lib/reflect-api';
import { emitOfficialRatingRequest, recordReflectClaimForRating } from '@/lib/official-rating-prompt';
import { useSubscriptionTier } from '@/lib/use-subscription-tier';

import { RC } from './reflect-shared';

export function MatchedItemsReviewSheet({
  items,
  onRemove,
  onDone,
}: {
  items: MatchedItem[];
  onRemove: (itemId: string) => void;
  onDone: () => void;
}) {
  return (
    <View style={styles.overlay}>
      <View style={styles.modalCard}>
        <Text style={styles.reviewTitle}>See an Item that doesn’t fit?{`\n`}Tap to remove it.</Text>
        <ScrollView contentContainerStyle={styles.itemGrid} showsVerticalScrollIndicator={false}>
          {items.map((item) => (
            <Pressable
              key={item.itemId}
              onPress={() => { void haptics.light(); onRemove(item.itemId); }}
              style={({ pressed }) => [styles.reviewItem, pressed && { opacity: 0.55 }]}
            >
              <ItemSprite itemId={item.itemId} size={58} radius={14} />
              <MaterialIcons name="close" size={15} color="#FFFFFF" style={styles.removeBadge} />
            </Pressable>
          ))}
        </ScrollView>
        <OffsetCard color="#CBBDAA" offset={4} radius={22} onPress={onDone} cardStyle={styles.brownButton}>
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
  onChange,
  onDone,
}: {
  items: MatchedItem[];
  memories: ReflectMemoryDraft[];
  isPaid: boolean;
  shared: boolean;
  onChange: (memories: ReflectMemoryDraft[]) => void;
  onDone: () => void;
}) {
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
    <KeyboardDismissView style={styles.overlay}>
      <View style={styles.editorFrame}>
        <View style={styles.editorCard}>
          <View style={styles.editorHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.editorTitle}>{items.length} {items.length === 1 ? 'Item' : 'Items'}</Text>
              <Text style={styles.editorSub}>
                Items with memories will be saved to your hub. Tap to edit.
              </Text>
            </View>
            {!isPaid && memories.some((memory) => !memory.text.trim()) && items.some((item) => item.sourceExcerpt?.trim()) && (
              <Pressable onPress={useWords} style={styles.useWordsButton}>
                <Text style={styles.useWordsText}>Use My Words</Text>
              </Pressable>
            )}
          </View>
          <ScrollView
            style={{ flexShrink: 1 }}
            contentContainerStyle={styles.editorRows}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {items.map((item) => {
              const memory = byId.get(item.itemId)!;
              return (
                <View key={item.itemId} style={styles.editorRow}>
                  <ItemSprite itemId={item.itemId} size={58} radius={14} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.editorName}>{item.displayName}</Text>
                    <TextInput
                      value={memory.text}
                      placeholder="Type here"
                      placeholderTextColor="#B7AEA6"
                      multiline
                      style={styles.editorInput}
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
          <OffsetCard color={RC.yellowDrop} offset={4} radius={22} onPress={onDone} cardStyle={styles.doneButton}>
            <Text style={styles.doneText}>Done</Text>
          </OffsetCard>
          {!shared && <Text style={styles.editorFoot}>Turn off the toggle if you don’t want the memory seen by your paired.</Text>}
        </View>
      </View>
    </KeyboardDismissView>
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
  const hidden = new Set(memories.filter((memory) => !memory.visible).map((memory) => memory.itemId));
  const toggle = (itemId: string) => {
    void haptics.light();
    onChange(memories.map((memory) => memory.itemId === itemId
      ? { ...memory, visible: !memory.visible }
      : memory));
  };
  return (
    <View style={styles.overlay}>
      <View style={styles.modalCard}>
        <Text style={styles.reviewTitle}>Click to select the items you don’t{`\n`}want your person to see.</Text>
        <ScrollView contentContainerStyle={styles.itemGrid} showsVerticalScrollIndicator={false}>
          {items.map((item) => (
            <Pressable
              key={item.itemId}
              onPress={() => toggle(item.itemId)}
              style={[styles.reviewItem, hidden.has(item.itemId) && styles.hiddenItem]}
            >
              <ItemSprite itemId={item.itemId} size={58} radius={14} />
              {hidden.has(item.itemId) && (
                <MaterialIcons name="visibility-off" size={18} color="#FFFFFF" style={styles.removeBadge} />
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
          <MaterialIcons name={hidden.size === items.length ? 'check-box' : 'check-box-outline-blank'} size={28} color="#5A351B" />
          <Text style={styles.selectAllText}>{hidden.size === items.length ? 'Show All' : 'Hide All'}</Text>
        </Pressable>
        <OffsetCard color="#CBBDAA" offset={4} radius={22} onPress={onDone} cardStyle={styles.brownButton}>
          <Text style={styles.brownButtonText}>Confirm</Text>
        </OffsetCard>
      </View>
    </View>
  );
}

export function ReflectSettlementView({
  draft,
  itemWord,
  shared = false,
  onFinalized,
}: {
  draft: PreparedReflect;
  itemWord: 'Matched' | 'Selected';
  shared?: boolean;
  onFinalized: (snapshot: ReflectSnapshot) => void;
}) {
  const tier = useSubscriptionTier();
  const isPaid = tier !== 'free';
  // Prepare normally supplies Plus copy. Still run one blank-only enrichment
  // pass so an AI timeout, a concurrent idempotent retry, or an in-page
  // purchase can recover without replacing anything the user typed.
  const enriched = useRef(false);
  const [memories, setMemories] = useState<ReflectMemoryDraft[]>(() => draft.matchedItems.map((item) => ({
    itemId: item.itemId,
    text: draft.aiMemories[item.itemId] || '',
    source: draft.aiMemories[item.itemId] ? 'ai' : 'manual',
    visible: true,
  })));
  const [editorOpen, setEditorOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [rewardToast, setRewardToast] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setRewardToast(false), 1500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isPaid || enriched.current) return;
    enriched.current = true;
    const empty = memories.filter((memory) => !memory.text.trim()).map((memory) => memory.itemId);
    if (empty.length === 0) return;
    setEnriching(true);
    void enrichReflectDraft(draft.draftId, empty).then((result) => {
      if (result.ok) {
        setMemories((current) => current.map((memory) => {
          if (memory.text.trim()) return memory;
          const text = result.aiMemories[memory.itemId]?.trim() || '';
          return text ? { ...memory, text, source: 'ai' } : memory;
        }));
      }
      setEnriching(false);
    });
  }, [draft.draftId, isPaid]);

  const savedCount = memories.filter((memory) => memory.text.trim()).length;
  const hiddenCount = shared ? 0 : memories.filter((memory) => !memory.visible).length;
  const allCreated = savedCount === memories.length && memories.length > 0;

  async function finish() {
    if (saving) return;
    void haptics.medium();
    setSaving(true);
    const result = await finalizeReflect(draft, memories);
    setSaving(false);
    if (!result.ok) {
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
    onFinalized(result.snapshot);
    if (recordReflectClaimForRating()) emitOfficialRatingRequest();
  }

  return (
    <View style={styles.settlement}>
      <ScrollView contentContainerStyle={styles.settlementScroll} showsVerticalScrollIndicator={false}>
        {isPaid && <View style={styles.plusBadge}><Text style={styles.plusBadgeText}>♕  Burrow Plus</Text></View>}
        <Text style={styles.celebration}>🎉</Text>
        <Text style={styles.savedTitle}>REFLECTION SAVED</Text>
        <Text style={styles.savedSub}>Your full reflection is private in My Logs.</Text>

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

        {!shared && (
          <Pressable onPress={() => { void haptics.pageOpen(); setShareOpen(true); }} style={styles.shareCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.shareTitle}>Any items you don’t want to share? Edit here.</Text>
              {hiddenCount > 0 && <Text style={styles.shareStatus}>{hiddenCount} items will not be seen by your paired</Text>}
            </View>
            <View style={styles.editCircle}><MaterialIcons name="edit" size={20} color="#5A351B" /></View>
          </Pressable>
        )}
      </ScrollView>

      <View style={styles.settlementFooter}>
        {!isPaid && (
          <>
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
          </>
        )}
        <OffsetCard color="#D96B3F" offset={4} radius={24} onPress={() => void finish()} disabled={saving} cardStyle={styles.finishButton}>
          {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.finishText}>Done</Text>}
        </OffsetCard>
      </View>

      {rewardToast && (
        <View pointerEvents="none" style={styles.rewardToast}>
          <Text style={styles.rewardToastText}>🍀 +30 Clovers</Text>
        </View>
      )}
      {editorOpen && (
        <MemoryEditorSheet
          items={draft.matchedItems}
          memories={memories}
          isPaid={isPaid}
          shared={shared}
          onChange={setMemories}
          onDone={() => { void haptics.pageClose(); setEditorOpen(false); }}
        />
      )}
      {shareOpen && (
        <ShareItemsSheet
          items={draft.matchedItems}
          memories={memories}
          onChange={setMemories}
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
  modalCard: { width: '100%', maxHeight: '82%', backgroundColor: '#FFF7E7', borderRadius: 30, padding: 22 },
  reviewTitle: { fontSize: 24, lineHeight: 32, fontFamily: 'Inter_800ExtraBold', textAlign: 'center', color: '#161311', marginVertical: 22 },
  itemGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12, paddingVertical: 16 },
  reviewItem: { position: 'relative', borderRadius: 16, backgroundColor: '#B27A4C', padding: 5 },
  hiddenItem: { backgroundColor: '#7B4B37', opacity: 0.72 },
  removeBadge: { position: 'absolute', right: 2, top: 2, borderRadius: 10, backgroundColor: '#8B3D2E', padding: 2 },
  brownButton: { backgroundColor: '#84503E', alignItems: 'center', paddingVertical: 17, marginTop: 18 },
  brownButtonText: { color: '#FFFFFF', fontSize: 19, fontFamily: 'Inter_800ExtraBold' },
  selectAllRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 14 },
  selectAllText: { fontSize: 18, fontFamily: 'Inter_800ExtraBold', color: '#1E1712' },
  editorFrame: { backgroundColor: RC.yellow, borderRadius: 30, padding: 10, width: '100%', maxHeight: '91%' },
  editorCard: { backgroundColor: '#FDF9F1', borderRadius: 22, padding: 16, flexShrink: 1 },
  editorHeader: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginBottom: 14 },
  editorTitle: { fontSize: 27, fontFamily: 'Inter_800ExtraBold', color: '#161311' },
  editorSub: { fontSize: 13, lineHeight: 18, fontFamily: 'Inter_500Medium', color: '#3A2E1A', marginTop: 3 },
  useWordsButton: { backgroundColor: '#54351E', borderRadius: 18, paddingHorizontal: 13, paddingVertical: 11 },
  useWordsText: { color: '#FFFFFF', fontSize: 13, fontFamily: 'Inter_800ExtraBold' },
  editorRows: { gap: 12, paddingBottom: 12 },
  editorRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderColor: '#D8BCA8', borderRadius: 18, padding: 11, backgroundColor: '#FFFFFF' },
  editorName: { fontSize: 16, fontFamily: 'Inter_800ExtraBold', color: '#161311' },
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
  settlementScroll: { paddingVertical: 8, gap: 13 },
  plusBadge: { alignSelf: 'flex-start', backgroundColor: '#54351E', borderRadius: 16, paddingHorizontal: 15, paddingVertical: 9 },
  plusBadgeText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter_800ExtraBold' },
  celebration: { fontSize: 42, textAlign: 'center' },
  savedTitle: { color: '#FFFFFF', textAlign: 'center', fontSize: 25, fontFamily: 'Inter_800ExtraBold' },
  savedSub: { color: '#FFFFFF', textAlign: 'center', fontSize: 16, fontFamily: 'Inter_700Bold', marginBottom: 8 },
  summaryCard: { backgroundColor: '#FFFFFF', borderRadius: 25, padding: 18, alignItems: 'center' },
  summaryTitle: { color: '#12100E', fontSize: 23, fontFamily: 'Inter_800ExtraBold' },
  summarySub: { color: '#2A2118', fontSize: 15, lineHeight: 21, fontFamily: 'Inter_500Medium', textAlign: 'center', marginTop: 8 },
  summaryItems: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 9, marginTop: 14 },
  shareCard: { backgroundColor: '#54351E', borderRadius: 18, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  shareTitle: { color: '#FFFFFF', fontSize: 15, lineHeight: 20, fontFamily: 'Inter_800ExtraBold' },
  shareStatus: { color: '#FF7A2F', fontSize: 13, fontFamily: 'Inter_800ExtraBold', marginTop: 5 },
  editCircle: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  settlementFooter: { gap: 12, paddingTop: 8 },
  joinCopy: { color: '#FFFFFF', textAlign: 'center', fontSize: 14, lineHeight: 19, fontFamily: 'Inter_700Bold', paddingHorizontal: 20 },
  joinButton: { backgroundColor: RC.yellow, alignItems: 'center', paddingVertical: 16 },
  joinText: { color: '#633A21', fontSize: 19, fontFamily: 'Inter_800ExtraBold' },
  finishButton: { backgroundColor: '#FF8A47', alignItems: 'center', paddingVertical: 16 },
  finishText: { color: '#FFFFFF', fontSize: 19, fontFamily: 'Inter_800ExtraBold' },
  rewardToast: { position: 'absolute', top: '45%', alignSelf: 'center', backgroundColor: 'rgba(45,35,25,0.92)', borderRadius: 18, paddingHorizontal: 20, paddingVertical: 13, zIndex: 60 },
  rewardToastText: { color: '#FFFFFF', fontSize: 17, fontFamily: 'Inter_800ExtraBold' },
});
