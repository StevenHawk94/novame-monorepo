import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { ItemSheet, type ItemSheetRef } from '@/components/main/item-sheet';
import { ItemSprite } from '@/components/ui/item-sprite';
import { OffsetCard } from '@/components/ui/offset-card';
import { fetchBags, getCachedBags, sharedBoxToCollectedItems, type CollectedItem } from '@/lib/bags-api';
import {
  fetchPairing,
  fetchSharedBox,
  getCachedPairing,
  type PairingStatus,
} from '@/lib/friends-api';
import { ICONS } from '@/lib/icons';

type CollectionTab = 'mine' | 'their' | 'ours';

const COLLECTION_TABS: { key: CollectionTab; label: string }[] = [
  { key: 'mine', label: 'Mine' },
  { key: 'their', label: 'Their' },
  { key: 'ours', label: 'Ours' },
];

/**
 * Bags is one collection split by ownership:
 * Mine = the signed-in user's collected reflection items;
 * Their = the paired partner's collection;
 * Ours = items from the pair's shared collection.
 */
export default function BagsScreen() {
  const router = useRouter();
  const { tab: initialTab } = useLocalSearchParams<{ tab?: string }>();
  const { width } = useWindowDimensions();
  const numColumns = Math.min(10, Math.max(5, Math.floor((width - 32) / 62)));
  const tileSize = Math.floor((width - 32) / numColumns) - 6;
  const cellWidth = `${100 / numColumns}%` as const;

  const [tab, setTab] = useState<CollectionTab>(initialTab === 'ours' ? 'ours' : initialTab === 'their' ? 'their' : 'mine');
  const [mineItems, setMineItems] = useState<CollectedItem[]>(() => getCachedBags());
  const [theirItems, setTheirItems] = useState<CollectedItem[]>([]);
  const [ourItems, setOurItems] = useState<CollectedItem[]>([]);
  const [pairing, setPairing] = useState<PairingStatus | null>(() => getCachedPairing());
  const [loaded, setLoaded] = useState(() => getCachedBags().length > 0);
  const itemSheetRef = useRef<ItemSheetRef>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void Promise.all([fetchBags(), fetchPairing()]).then(async ([mine, pair]) => {
        if (!active) return;
        setMineItems(mine);
        setPairing(pair);

        if (pair.paired && pair.partner) {
          const [theirs, shared] = await Promise.all([
            fetchBags('their'),
            fetchSharedBox(pair.partner.userId),
          ]);
          if (!active) return;
          setTheirItems(theirs);
          setOurItems(sharedBoxToCollectedItems(shared));
        } else {
          setTheirItems([]);
          setOurItems([]);
        }
        setLoaded(true);
      });
      return () => { active = false; };
    }, []),
  );

  const shown = useMemo(() => {
    if (tab === 'their') return theirItems;
    if (tab === 'ours') return ourItems;
    return mineItems;
  }, [mineItems, ourItems, tab, theirItems]);

  const PAGE = 100;
  const [visibleCount, setVisibleCount] = useState(PAGE);
  useEffect(() => setVisibleCount(PAGE), [tab]);
  const paged = shown.slice(0, visibleCount);
  const partner = pairing?.paired ? pairing.partner : null;

  function openSharedCreator() {
    if (!partner) return;
    router.push({
      pathname: '/(main)/shared-memory-create',
      params: {
        friendUserId: partner.userId,
      },
    });
  }

  function emptyCopy(): string {
    if (tab !== 'mine' && !partner) {
      return 'Pair with someone on Connection to see your collections together.';
    }
    if (tab === 'their') {
      return `${partner?.displayName || 'Your person'} hasn’t collected any memory items yet.`;
    }
    if (tab === 'ours') {
      return 'Nothing here yet — create a shared memory together.';
    }
    return 'Write reflections to start collecting the little things in your days.';
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Image source={ICONS.memory} style={styles.headerIcon} resizeMode="contain" />
        <View style={styles.titleWrap}>
          <Text style={styles.title} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.75}>
            Memories{`\n`}Collection
          </Text>
        </View>

        {tab === 'mine' ? (
          <OffsetCard
            color="#C96F2A"
            offset={4}
            radius={18}
            onPress={() => router.push('/(main)/my-logs')}
            cardStyle={styles.headerButton}
          >
            <Image source={ICONS.sharedMemories} style={styles.headerButtonIcon} resizeMode="contain" />
            <Text style={styles.headerButtonText}>My Logs</Text>
          </OffsetCard>
        ) : tab === 'ours' && partner ? (
          <OffsetCard
            color="#C96F2A"
            offset={4}
            radius={18}
            onPress={openSharedCreator}
            cardStyle={styles.headerButton}
          >
            <Text style={styles.plus}>＋</Text>
            <Text style={styles.headerButtonText}>Create New</Text>
          </OffsetCard>
        ) : null}
      </View>

      <Text style={styles.collectionNote} numberOfLines={2}>
        {tab === 'mine'
          ? 'Memory items from your reflections'
          : tab === 'their'
            ? partner ? `${partner.displayName}’s memory items` : 'Your person’s memory items'
            : 'Memory items you created together'}
      </Text>

      <View style={styles.tabStrip}>
        {COLLECTION_TABS.map((entry) => {
          const active = entry.key === tab;
          return (
            <Pressable
              key={entry.key}
              onPress={() => setTab(entry.key)}
              style={[styles.tab, active && styles.tabActive]}
            >
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{entry.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {!loaded ? (
        <View style={styles.empty}>
          <ActivityIndicator color="#8A6240" />
        </View>
      ) : shown.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>{tab === 'ours' ? '🎁' : '🎒'}</Text>
          <Text style={styles.emptyText}>{emptyCopy()}</Text>
          {tab === 'ours' && partner ? (
            <Pressable onPress={openSharedCreator} style={styles.emptyCreateButton}>
              <Text style={styles.emptyCreateText}>Create New</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <FlatList
          key={numColumns}
          data={paged}
          keyExtractor={(item) => item.itemId}
          numColumns={numColumns}
          contentContainerStyle={styles.gridScroll}
          showsVerticalScrollIndicator={false}
          onEndReached={() => setVisibleCount((count) => Math.min(count + PAGE, shown.length))}
          onEndReachedThreshold={0.6}
          initialNumToRender={40}
          maxToRenderPerBatch={40}
          windowSize={7}
          removeClippedSubviews
          renderItem={({ item }) => (
            <Pressable
              onPress={() => itemSheetRef.current?.present(item.itemId)}
              style={[styles.cell, { width: cellWidth }]}
            >
              <View style={styles.itemCard}>
                <ItemSprite itemId={item.itemId} size={tileSize} radius={18} />
                {item.count > 1 ? (
                  <View style={styles.countBadge}>
                    <Text style={styles.countBadgeText}>x{item.count > 99 ? '99+' : item.count}</Text>
                  </View>
                ) : null}
              </View>
            </Pressable>
          )}
        />
      )}

      <ItemSheet ref={itemSheetRef} items={shown} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FEF5F1', paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingTop: 10, paddingBottom: 2 },
  headerIcon: { width: 56, height: 56 },
  titleWrap: { flex: 1 },
  title: { fontSize: 27, lineHeight: 33, fontFamily: 'Inter_800ExtraBold', color: '#4A2E17' },
  headerButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#F0913D', paddingHorizontal: 14, paddingVertical: 13,
  },
  headerButtonIcon: { width: 24, height: 24 },
  headerButtonText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter_700Bold' },
  plus: { color: '#FFFFFF', fontSize: 22, lineHeight: 22, fontFamily: 'Inter_700Bold' },
  collectionNote: {
    minHeight: 22, fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#2E2418',
    marginTop: 8, marginBottom: 16, paddingHorizontal: 2,
  },
  tabStrip: {
    flexDirection: 'row', alignItems: 'center', padding: 7,
    backgroundColor: '#FFF8E3', borderRadius: 30, borderWidth: 1.5,
    borderColor: '#3E2C1A', marginBottom: 18,
  },
  tab: { flex: 1, height: 46, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  tabActive: { backgroundColor: '#4A3423' },
  tabLabel: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#8A6B3F' },
  tabLabelActive: { color: '#FFF6DE' },
  gridScroll: { paddingBottom: 24 },
  cell: { alignItems: 'center', marginBottom: 10, paddingHorizontal: 3 },
  itemCard: {
    width: '100%', aspectRatio: 1, borderRadius: 18, backgroundColor: '#F4F1F8',
    alignItems: 'center', justifyContent: 'center',
  },
  countBadge: {
    position: 'absolute', right: -2, bottom: -2, backgroundColor: '#4A3423',
    borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2,
  },
  countBadgeText: { color: '#FFFFFF', fontSize: 10, fontFamily: 'Inter_800ExtraBold' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 12 },
  emptyEmoji: { fontSize: 44 },
  emptyText: {
    fontSize: 15, fontFamily: 'Inter_500Medium', color: '#9A8770',
    textAlign: 'center', lineHeight: 22,
  },
  emptyCreateButton: {
    marginTop: 4, backgroundColor: '#F0913D', borderRadius: 16,
    paddingHorizontal: 24, paddingVertical: 12,
  },
  emptyCreateText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter_700Bold' },
});
