import { useCallback, useMemo, useRef, useState } from 'react';
import { useWindowDimensions, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { ICONS } from '@/lib/icons';
import { ItemSprite } from '@/components/ui/item-sprite';
import { fetchReflectFeed, getCachedFeed, formatDayLabel, type FeedDay } from '@/lib/reflect-feed-api';
import {
  editReflectMemories,
  fetchReflectMemories,
  type ReflectMemoryDraft,
  type ReflectMemoryEditorData,
} from '@/lib/reflect-api';
import { appAlert } from '@/components/ui/app-dialog';
import { haptics } from '@/lib/haptics';
import { GridBackground } from '@/components/ui/grid-background';
import { MemoryEditorSheet } from '@/components/main/reflect-settlement';
import { useSubscriptionTier } from '@/lib/use-subscription-tier';
import { invalidateMineBagsCache } from '@/lib/bags-api';

function toMemoryDrafts(data: ReflectMemoryEditorData): ReflectMemoryDraft[] {
  return data.items.map((item) => ({
    itemId: item.itemId,
    text: item.text,
    source: item.source,
    visible: item.visible,
  }));
}

function memoryDraftSignature(memories: ReflectMemoryDraft[]): string {
  return JSON.stringify(memories.map((memory) => [
    memory.itemId,
    memory.text,
    memory.source,
    memory.visible,
  ]));
}

/**
 * Reflect detail (design 2026-07-22, 1:1): dark-brown full screen, a white
 * card with the dated full reflection, then a "Memory Items Created" card --
 * the items that reflection gathered as sprite tiles with xN counts -- and a
 * round white close button. Read from the cached feed by reflectId; items
 * resolved from cached bags by matching each memory's reflectId.
 */
export default function ReflectDetailScreen() {
  const insets = useSafeAreaInsets();
  // Justified item grid (2026-08-08): ~72pt targets pick the column count,
  // then the tile size stretches so each full row spans the card exactly.
  const { width: winW } = useWindowDimensions();
  const memInner = winW - 36 - 40 - 8; // page pad(18x2) + memCard pad + memRow pad
  const memCols = Math.max(4, Math.floor((memInner + 14) / (72 + 14)));
  const memTile = Math.floor((memInner - (memCols - 1) * 14) / memCols);
  const router = useRouter();
  const isPaid = useSubscriptionTier() !== 'free';
  const { reflectId } = useLocalSearchParams<{ reflectId: string }>();
  // Cache-first: the pushed-from screen already had this feed cached.
  const [feed, setFeed] = useState<FeedDay[]>(() => getCachedFeed());

  useFocusEffect(
    useCallback(() => {
      void fetchReflectFeed().then(setFeed);
    }, []),
  );

  // Find the reflection + its day label.
  const entry = useMemo(() => {
    for (const day of feed) {
      const r = day.reflects.find((x) => x.id === reflectId);
      if (r) return {
        body: r.body,
        dateLabel: formatDayLabel(day.date),
        sharedToFriends: r.sharedToFriends,
        itemIds: r.itemIds,
        hasMemories: r.hasMemories,
      };
    }
    return null;
  }, [feed, reflectId]);

  const [editor, setEditor] = useState<ReflectMemoryEditorData | null>(null);
  const [editorMemories, setEditorMemories] = useState<ReflectMemoryDraft[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [loadingEditor, setLoadingEditor] = useState(false);
  const [savingEditor, setSavingEditor] = useState(false);
  const savedEditorSignature = useRef('');

  const adoptEditorData = useCallback((data: ReflectMemoryEditorData) => {
    const memories = toMemoryDrafts(data);
    setEditor(data);
    setEditorMemories(memories);
    savedEditorSignature.current = memoryDraftSignature(memories);
  }, []);

  // Warm this reflect's small editor payload while the user reads the detail.
  // fetchReflectMemories deduplicates the request and keeps a session cache, so
  // opening the sheet normally requires no additional round-trip.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (reflectId) {
        void fetchReflectMemories(reflectId).then((data) => {
          if (active && data) adoptEditorData(data);
        });
      }
      return () => { active = false; };
    }, [adoptEditorData, reflectId]),
  );

  async function openEditor() {
    if (!reflectId || loadingEditor) return;
    void haptics.pageOpen();
    if (editor) {
      setEditorOpen(true);
      return;
    }
    setLoadingEditor(true);
    const data = await fetchReflectMemories(reflectId);
    setLoadingEditor(false);
    if (!data) {
      appAlert('Could not load memories', 'Please check your connection and try again.');
      return;
    }
    adoptEditorData(data);
    setEditorOpen(true);
  }

  async function saveEditor() {
    if (!reflectId || !editor || savingEditor) return;
    const nextSignature = memoryDraftSignature(editorMemories);
    if (nextSignature === savedEditorSignature.current) {
      void haptics.pageClose();
      setEditorOpen(false);
      return;
    }
    setSavingEditor(true);
    const ok = await editReflectMemories(reflectId, editorMemories);
    setSavingEditor(false);
    if (!ok) {
      appAlert('Could not save', 'Please check your connection and try again.');
      return;
    }
    const editsByItem = new Map(editorMemories.map((memory) => [memory.itemId, memory]));
    setEditor((current) => current ? {
      ...current,
      items: current.items.map((item) => {
        const memory = editsByItem.get(item.itemId);
        return memory ? { ...item, text: memory.text, source: memory.source, visible: memory.visible } : item;
      }),
    } : current);
    savedEditorSignature.current = nextSignature;
    const hasMemories = editorMemories.some((memory) => memory.text.trim().length > 0);
    setFeed((current) => current.map((day) => ({
      ...day,
      reflects: day.reflects.map((reflect) => reflect.id === reflectId
        ? { ...reflect, hasMemories }
        : reflect),
    })));
    invalidateMineBagsCache();
    void fetchReflectFeed({ force: true }).then(setFeed);
    void haptics.success();
    setEditorOpen(false);
  }

  // Items this reflection gathered, aggregated to (item, count) so a double
  // mention shows one tile with x2 rather than two x1 tiles.
  const gathered = useMemo(() => {
    const counts = new Map<string, number>();
    for (const itemId of entry?.itemIds ?? []) {
      counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
    }
    return [...counts].map(([itemId, count]) => ({ itemId, count }));
  }, [entry?.itemIds]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <GridBackground base="#43301F" line="#59412B" cell={22} lineWidth={1.2} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Reflection card */}
        <View style={styles.card}>
          {entry && (
            <View style={styles.dateRow}>
              <Image source={ICONS.calendar} style={styles.calendarIcon} resizeMode="contain" />
              <Text style={styles.date}>{entry.dateLabel}</Text>
            </View>
          )}
          <Text style={styles.body}>
            {entry
              ? entry.body.trim() || 'You did not type anything on this reflection.'
              : 'This reflection is no longer available.'}
          </Text>
        </View>

        {/* Every item matched/selected by this reflection. */}
        {gathered.length > 0 && (
          <View style={styles.memCard}>
            <View style={styles.memTitleRow}>
              <Image source={ICONS.memory} style={styles.memTitleIcon} resizeMode="contain" />
              <Text style={styles.memTitle}>{entry?.hasMemories ? 'Memories Created' : 'Items Reflected'}</Text>
            </View>
            {/* Wrapping grid: every item visible, growing downward (no side-scroll). */}
            <View style={styles.memRow}>
              {gathered.map((g) => (
                <View key={g.itemId} style={styles.memItem}>
                  <ItemSprite itemId={g.itemId} size={memTile} radius={16} />
                  <Text style={styles.memCount}>x{g.count}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {gathered.length > 0 && (
          <Pressable
            disabled={loadingEditor}
            onPress={() => void openEditor()}
            style={({ pressed }) => [styles.editMemories, pressed && { opacity: 0.82 }]}
          >
            <Text style={styles.editMemoriesText}>{loadingEditor ? 'Loading…' : 'Edit Memories'}</Text>
          </Pressable>
        )}
      </ScrollView>

      {/* Close: white circle, dark X (mock) */}
      <View style={[styles.closeWrap, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable onPress={() => { void haptics.pageClose(); router.back(); }} style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.85 }]}>
          <MaterialIcons name="close" size={28} color="#43301F" />
        </Pressable>
      </View>
      {editorOpen && editor && (
        <MemoryEditorSheet
          items={editor.items.map((item) => ({
            itemId: item.itemId,
            displayName: item.displayName,
            rarity: 'common',
            label: item.displayName,
            sourceExcerpt: item.sourceExcerpt,
          }))}
          memories={editorMemories}
          isPaid={isPaid}
          shared={editor.shared}
          allowUseMyWords={editor.mode === 'typing'}
          tapYourDay={editor.mode === 'prompt'}
          onChange={setEditorMemories}
          onDone={() => void saveEditor()}
          saving={savingEditor}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#43301F', paddingHorizontal: 18 },
  scroll: { paddingBottom: 24, gap: 20, paddingTop: 8 },

  card: { backgroundColor: '#FDF9F1', borderRadius: 26, padding: 24 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  calendarIcon: { width: 28, height: 28 },
  date: { fontSize: 17, fontFamily: 'Inter_800ExtraBold', color: '#2E2418' },
  body: { fontSize: 16, fontFamily: 'Inter_500Medium', color: '#3A2E1A', lineHeight: 26 },

  memCard: { backgroundColor: '#FDF9F1', borderRadius: 26, padding: 20 },
  memTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16 },
  memTitleIcon: { width: 30, height: 30 },
  memTitle: { fontSize: 18, fontFamily: 'Inter_800ExtraBold', color: '#2A2118' },
  memRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, paddingHorizontal: 4 },
  memItem: { alignItems: 'center', gap: 6 },
  memCount: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#4A3B2A' },

  editMemories: { backgroundColor: '#F9C939', borderRadius: 22, paddingVertical: 17, alignItems: 'center' },
  editMemoriesText: { color: '#633A21', fontSize: 19, fontFamily: 'Inter_800ExtraBold' },

  closeWrap: { alignItems: 'center' },
  closeBtn: {
    width: 58, height: 58, borderRadius: 29, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
  },
});
