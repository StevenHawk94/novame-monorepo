/**
 * Shared pieces of the three Reflect entries (2026-07-24 design):
 *   - ReflectTopBar     back circle + "N of 3 left today"
 *   - SelectableItemGrid the tappable sprite grid (guided + object flows)
 *   - MemoryEditSheet   the "N Items" note editor (mocks: yellow-frame card)
 *   - ReflectResultView "Reflection Done" (+clovers, +memory items, claim,
 *                       the paired-details toggle) and the skill reveal
 *
 * Every input screen sits on the sunset art under a 50% black scrim (设计
 * 要求), so these pieces assume a dark ground.
 */
import { memo, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

import { ITEM_DICTIONARY } from '@novame/engine';

import { haptics } from '@/lib/haptics';
import { ICONS } from '@/lib/icons';
import { setReflectVisibility, type ReflectSnapshot } from '@/lib/reflect-api';
import { OffsetCard } from '@/components/ui/offset-card';
import { SpringPop } from '@/components/ui/spring-pop';
import { FireworksBurst } from '@/components/ui/fireworks-burst';
import { ConfettiBurst } from '@/components/ui/confetti-burst';
import { ItemSprite } from '@/components/ui/item-sprite';

export const RC = {
  yellow: '#F9C939',
  yellowDrop: '#E8A33C',
  orange: '#F0885C',
  orangeDrop: '#D96B3F',
  ink: '#2B2B2B',
  cream: '#FFF6E8',
  scrim: 'rgba(0,0,0,0.5)',
};

/** Item ids of one or more categories, in sheet order (row, then col). */
export function itemIdsForCategories(categories: string[]): string[] {
  const out: string[] = [];
  for (const cat of categories) {
    const ids = Object.entries(ITEM_DICTIONARY.items)
      .filter(([, def]) => def.category === cat)
      .sort((a, b) => a[1].row - b[1].row || a[1].col - b[1].col)
      .map(([id]) => id);
    out.push(...ids);
  }
  return out;
}

// ---- top bar ----------------------------------------------------------------

export function ReflectTopBar({ remaining, onBack }: { remaining?: number; onBack: () => void }) {
  return (
    <View style={s.topBar}>
      <Pressable onPress={onBack} style={s.backCircle} hitSlop={10}>
        <MaterialIcons name="arrow-back" size={24} color={RC.ink} />
      </Pressable>
      {remaining != null && <Text style={s.remaining}>{remaining} of 3 left today</Text>}
    </View>
  );
}

// ---- selectable grid --------------------------------------------------------

// Memoized cell: a toggle re-renders exactly two cells, not the whole grid.
const GridCell = memo(function GridCell({
  id,
  on,
  onToggle,
}: {
  id: string;
  on: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <Pressable
      onPress={() => {
        void haptics.light();
        onToggle(id);
      }}
      style={[s.gridCell, on && s.gridCellOn]}
    >
      <ItemSprite itemId={id} size={44} radius={12} />
      {on && (
        <View style={s.gridCheck}>
          <MaterialIcons name="check" size={12} color="#FFFFFF" />
        </View>
      )}
    </Pressable>
  );
});

/**
 * Virtualized picker grid: the object flow's "all" view holds 1000+ sprite
 * tiles — a plain flexWrap ScrollView janks hard, so this is a windowed
 * FlatList (it scrolls itself; don't nest it in another ScrollView).
 */
export function SelectableItemGrid({
  itemIds,
  selected,
  onToggle,
}: {
  itemIds: string[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <FlatList
      data={itemIds}
      keyExtractor={(id) => id}
      numColumns={6}
      renderItem={({ item }) => (
        <GridCell id={item} on={selected.has(item)} onToggle={onToggle} />
      )}
      columnWrapperStyle={s.gridRow}
      contentContainerStyle={s.gridContent}
      showsVerticalScrollIndicator={false}
      initialNumToRender={60}
      maxToRenderPerBatch={48}
      windowSize={7}
      removeClippedSubviews
    />
  );
}

// ---- edit sheet -------------------------------------------------------------

export function MemoryEditSheet({
  items,
  notes,
  onChangeNote,
  onRemove,
  onDone,
  isPaid,
}: {
  items: { itemId: string; displayName: string }[];
  notes: Record<string, string>;
  onChangeNote: (itemId: string, text: string) => void;
  /** typing flow only: dismiss a wrong match. */
  onRemove?: (itemId: string) => void;
  onDone: () => void;
  isPaid: boolean;
}) {
  return (
    <View style={s.sheetOverlay}>
      <View style={s.sheetFrame}>
        <View style={s.sheetCard}>
          <View style={s.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={s.sheetTitle}>
                {items.length} {items.length === 1 ? 'Item' : 'Items'}
              </Text>
              <Text style={s.sheetSub}>
                {isPaid
                  ? 'Your memories will be added automatically after save.'
                  : 'Add memories manually'}
              </Text>
            </View>
            <View style={s.plusWrap}>
              <View style={s.plusPill}>
                <Text style={s.plusPillText}>NovaMe Plus</Text>
              </View>
              {!isPaid && <Text style={s.plusNote}>Join Plus to add memories automatically</Text>}
            </View>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ gap: 14, paddingBottom: 16 }}
            keyboardShouldPersistTaps="handled"
          >
            {items.map((it) => (
              <View key={it.itemId} style={s.sheetRow}>
                <ItemSprite itemId={it.itemId} size={56} radius={14} />
                <View style={{ flex: 1 }}>
                  <Text style={s.sheetRowName}>{it.displayName}</Text>
                  <TextInput
                    style={s.sheetRowInput}
                    placeholder="Type here"
                    placeholderTextColor="#B7AEA6"
                    value={notes[it.itemId] ?? ''}
                    onChangeText={(t) => onChangeNote(it.itemId, t.slice(0, 200))}
                  />
                </View>
                {onRemove && (
                  <Pressable onPress={() => onRemove(it.itemId)} hitSlop={8} style={s.sheetRemove}>
                    <MaterialIcons name="close" size={18} color="#B0432E" />
                  </Pressable>
                )}
              </View>
            ))}
          </ScrollView>

          <OffsetCard color={RC.yellowDrop} offset={4} radius={24} onPress={onDone} cardStyle={s.doneBtn}>
            <Text style={s.doneBtnText}>Done</Text>
          </OffsetCard>
        </View>
      </View>
    </View>
  );
}

// ---- result -----------------------------------------------------------------

export function ReflectResultView({
  result,
  onFinished,
}: {
  result: ReflectSnapshot;
  onFinished: () => void;
}) {
  const [phase, setPhase] = useState<'claim' | 'skill'>('claim');
  // 结果页 toggle：默认开（paired 可见细节）；关掉只藏细节、物品仍可见。
  const [detailsVisible, setDetailsVisible] = useState(true);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const it of result.matchedItems) map.set(it.itemId, (map.get(it.itemId) ?? 0) + 1);
    return [...map.entries()];
  }, [result.matchedItems]);

  function onToggleDetails() {
    const next = !detailsVisible;
    setDetailsVisible(next);
    void haptics.light();
    if (result.reflectId) void setReflectVisibility(result.reflectId, next);
  }

  function onClaim() {
    void haptics.medium();
    if (phase === 'claim' && result.generatedSkill) {
      setPhase('skill');
      return;
    }
    onFinished();
  }

  if (phase === 'skill' && result.generatedSkill) {
    const sk = result.generatedSkill;
    return (
      <View style={s.resultWrap}>
        <FireworksBurst />
        <ConfettiBurst />
        <View style={s.resultCenter}>
          <Text style={s.resultTitle}>Your Rabbit Learned a New Skill!</Text>
          <SpringPop>
            <View style={[s.skillCard, sk.rarity === 'secret' && s.skillCardSecret]}>
              <Text style={s.skillTitle}>{sk.title}</Text>
              <Text style={s.skillBody}>{sk.body}</Text>
            </View>
          </SpringPop>
        </View>
        <OffsetCard color={RC.yellowDrop} offset={4} radius={24} onPress={onClaim} cardStyle={s.claimBtn}>
          <Text style={s.claimBtnText}>Claim</Text>
        </OffsetCard>
      </View>
    );
  }

  return (
    <View style={s.resultWrap}>
      <FireworksBurst />
      <ConfettiBurst />
      <ScrollView contentContainerStyle={s.resultScroll} showsVerticalScrollIndicator={false}>
        <Text style={s.resultEmoji}>{'🎉'}</Text>
        <Text style={s.resultTitle}>Reflection Done</Text>

        <SpringPop>
          <View style={s.cloverCard}>
            <Image source={ICONS.Clover} style={{ width: 34, height: 34 }} resizeMode="contain" />
            <Text style={s.cloverAmount}>+{result.xpAwarded}</Text>
            <Text style={s.cloverLabel}>Clovers</Text>
          </View>
        </SpringPop>

        <SpringPop delay={140}>
          <View style={s.itemsCard}>
            <View style={s.itemsCardHeader}>
              <Image source={ICONS.memory} style={{ width: 28, height: 28 }} resizeMode="contain" />
              <Text style={s.itemsCardAmount}>+{result.matchedItems.length}</Text>
              <Text style={s.itemsCardLabel}>Memory Items</Text>
            </View>
            {counts.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.itemsRow}>
                {counts.map(([id, n]) => (
                  <View key={id} style={{ alignItems: 'center', gap: 4 }}>
                    <ItemSprite itemId={id} size={64} radius={14} />
                    {n > 1 && <Text style={s.itemCount}>x{n}</Text>}
                  </View>
                ))}
              </ScrollView>
            ) : (
              <Text style={s.itemsEmpty}>A quiet one — no items this time, and that's okay.</Text>
            )}
          </View>
        </SpringPop>

        {result.story ? (
          <SpringPop delay={240}>
            <View style={s.storyCard}>
              <Text style={s.storyTitle}>{'✨ A little story of your day'}</Text>
              <Text style={s.storyBody}>{result.story}</Text>
            </View>
          </SpringPop>
        ) : null}
      </ScrollView>

      <View style={s.resultFooter}>
        <OffsetCard color={RC.yellowDrop} offset={4} radius={24} onPress={onClaim} cardStyle={s.claimBtn}>
          <Text style={s.claimBtnText}>Claim</Text>
        </OffsetCard>
        <Pressable onPress={onToggleDetails} style={s.toggleRow} hitSlop={6}>
          <View style={[s.togglePill, detailsVisible ? s.togglePillOn : s.togglePillOff]}>
            <Text style={s.toggleState}>{detailsVisible ? 'ON' : 'OFF'}</Text>
            <View style={s.toggleKnob} />
          </View>
          <Text style={s.toggleText}>
            Turn off to hide all the details of these memory items to your paired.
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  backCircle: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
  },
  remaining: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: 'rgba(255,255,255,0.95)' },

  gridRow: { gap: 8, paddingHorizontal: 2 },
  gridContent: { gap: 8, padding: 12 },
  gridCell: { borderRadius: 14, borderWidth: 2.5, borderColor: 'transparent', padding: 2 },
  gridCellOn: { borderColor: RC.orange },
  gridCheck: {
    position: 'absolute', right: -4, top: -4, width: 18, height: 18, borderRadius: 9,
    backgroundColor: RC.orange, alignItems: 'center', justifyContent: 'center',
  },

  sheetOverlay: {
    ...StyleSheet.absoluteFillObject, backgroundColor: RC.scrim,
    alignItems: 'center', justifyContent: 'center', padding: 14, zIndex: 20,
  },
  sheetFrame: { backgroundColor: RC.yellow, borderRadius: 30, padding: 12, width: '100%', maxHeight: '88%' },
  sheetCard: { backgroundColor: '#FDF9F1', borderRadius: 22, padding: 18, flexShrink: 1 },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 14 },
  sheetTitle: { fontSize: 28, fontFamily: 'Inter_800ExtraBold', color: '#161311' },
  sheetSub: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#8A6240', marginTop: 4 },
  plusWrap: { alignItems: 'flex-end', maxWidth: 150 },
  plusPill: { backgroundColor: '#43301F', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8 },
  plusPillText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  plusNote: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#2A2118', textAlign: 'right', marginTop: 6 },
  sheetRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1.5, borderColor: '#D8BCA8', borderRadius: 16, padding: 12, backgroundColor: '#FFFFFF',
  },
  sheetRowName: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#161311' },
  sheetRowInput: { fontSize: 14, fontFamily: 'Inter_500Medium', color: '#2A2118', paddingVertical: 4, padding: 0 },
  sheetRemove: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: '#F8E2DC',
    alignItems: 'center', justifyContent: 'center',
  },
  doneBtn: { backgroundColor: RC.yellow, alignItems: 'center', paddingVertical: 15, marginTop: 6 },
  doneBtnText: { fontSize: 17, fontFamily: 'Inter_800ExtraBold', color: '#5A4419' },

  resultWrap: { flex: 1 },
  resultCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, paddingHorizontal: 20 },
  resultScroll: { alignItems: 'stretch', gap: 14, paddingBottom: 16, paddingTop: 8 },
  resultEmoji: { fontSize: 40, textAlign: 'center' },
  resultTitle: {
    fontSize: 26, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF',
    textAlign: 'center', marginBottom: 8,
  },
  cloverCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#FFFFFF', borderRadius: 22, paddingVertical: 18,
  },
  cloverAmount: { fontSize: 26, fontFamily: 'Inter_800ExtraBold', color: '#161311' },
  cloverLabel: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#2E7A3E' },
  itemsCard: { backgroundColor: '#FDF9F1', borderRadius: 22, padding: 16 },
  itemsCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 12 },
  itemsCardAmount: { fontSize: 22, fontFamily: 'Inter_800ExtraBold', color: '#161311' },
  itemsCardLabel: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#6B4E2E' },
  itemsRow: { gap: 10, paddingHorizontal: 2 },
  itemCount: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#4A3B2A' },
  itemsEmpty: { fontSize: 14, fontFamily: 'Inter_500Medium', color: '#9A8770', textAlign: 'center', paddingVertical: 8 },
  storyCard: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 18 },
  storyTitle: { fontSize: 15, fontFamily: 'Inter_800ExtraBold', color: '#161311', marginBottom: 8 },
  storyBody: { fontSize: 15, fontFamily: 'Inter_500Medium', color: '#3A2E1A', lineHeight: 23 },

  skillCard: {
    backgroundColor: '#FFFFFF', borderRadius: 24, borderWidth: 3, borderColor: RC.yellow,
    padding: 24, width: 300, gap: 10,
  },
  skillCardSecret: { borderColor: '#B57BC9' },
  skillTitle: { fontSize: 20, fontFamily: 'Inter_800ExtraBold', color: '#161311', textAlign: 'center' },
  skillBody: { fontSize: 15, fontFamily: 'Inter_500Medium', color: '#3A2E1A', lineHeight: 23, textAlign: 'center' },

  resultFooter: { gap: 14, paddingTop: 6 },
  claimBtn: { backgroundColor: RC.yellow, alignItems: 'center', paddingVertical: 17 },
  claimBtnText: { fontSize: 19, fontFamily: 'Inter_800ExtraBold', color: '#5A4419' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4 },
  togglePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 20, paddingHorizontal: 8, paddingVertical: 5, minWidth: 74, justifyContent: 'space-between',
  },
  togglePillOn: { backgroundColor: RC.orange },
  togglePillOff: { backgroundColor: '#8A8A8A', flexDirection: 'row-reverse' },
  toggleState: { fontSize: 13, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF', marginHorizontal: 4 },
  toggleKnob: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#FFFFFF' },
  toggleText: {
    flex: 1, fontSize: 13, fontFamily: 'Inter_600SemiBold',
    color: 'rgba(255,255,255,0.95)', lineHeight: 18,
  },
});
