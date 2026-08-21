import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { GridBackground } from '@/components/ui/grid-background';
import { ItemSprite } from '@/components/ui/item-sprite';
import { OffsetCard } from '@/components/ui/offset-card';
import {
  fetchMoreBags,
  getCachedBags,
  getCachedTheirBags,
  isBagsHistoryComplete,
  refreshBagsIfStale,
  sharedBoxToCollectedItems,
  type CollectedItem,
} from '@/lib/bags-api';
import {
  fetchPairing,
  fetchMoreSharedBox,
  fetchSharedBoxWithMeta,
  getCachedPairing,
  getCachedSharedBox,
  isPairingCacheStale,
  isSharedBoxCacheStale,
  markSharedBoxRead,
  subscribeSharedBoxChanges,
  type PairingStatus,
} from '@/lib/friends-api';
import { ICONS } from '@/lib/icons';
import { haptics } from '@/lib/haptics';
import { refreshRemoteItems } from '@/lib/remote-items';

type CollectionTab = 'mine' | 'their' | 'ours';

const COLLECTION_TABS: { key: CollectionTab; label: string }[] = [
  { key: 'mine', label: 'Mine' },
  { key: 'their', label: 'Theirs' },
  { key: 'ours', label: 'Ours' },
];

const TAB_GRID: Record<CollectionTab, { base: string; line: string }> = {
  mine: { base: '#F8DF91', line: '#E9C76B' },
  their: { base: '#DDEFF7', line: '#B9DDEA' },
  ours: { base: '#F7DFE7', line: '#EABFCC' },
};

const COLLECTION_PAGE_SIZE = 100;

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

  const initialPairing = useMemo(() => getCachedPairing(), []);
  const initialPartnerId = initialPairing?.paired ? initialPairing.partner?.userId : undefined;
  const initialMineItems = useMemo(() => getCachedBags(), []);
  const initialTheirItems = useMemo(() => getCachedTheirBags(initialPartnerId), [initialPartnerId]);
  const initialSharedBox = useMemo(() => getCachedSharedBox(initialPartnerId), [initialPartnerId]);
  const initialOurItems = useMemo(
    () => sharedBoxToCollectedItems(initialSharedBox.items),
    [initialSharedBox],
  );

  const [tab, setTab] = useState<CollectionTab>(initialTab === 'ours' ? 'ours' : initialTab === 'their' ? 'their' : 'mine');
  const [mineItems, setMineItems] = useState<CollectedItem[]>(initialMineItems);
  const [theirItems, setTheirItems] = useState<CollectedItem[]>(initialTheirItems);
  const [ourItems, setOurItems] = useState<CollectedItem[]>(initialOurItems);
  const [pairing, setPairing] = useState<PairingStatus | null>(initialPairing);
  const [loaded, setLoaded] = useState(
    initialPairing !== null || initialMineItems.length > 0 || initialTheirItems.length > 0 || initialOurItems.length > 0,
  );
  const [oursUnread, setOursUnread] = useState(initialSharedBox.hasUnreadFromPartner);
  const [oursReadThrough, setOursReadThrough] = useState(initialSharedBox.readThrough);
  const [oursHistoryComplete, setOursHistoryComplete] = useState(initialSharedBox.historyComplete);
  const [mineHistoryComplete, setMineHistoryComplete] = useState(() => isBagsHistoryComplete('mine'));
  const [theirHistoryComplete, setTheirHistoryComplete] = useState(() => isBagsHistoryComplete('their', initialPartnerId));
  const [mineLoadingMore, setMineLoadingMore] = useState(false);
  const [theirLoadingMore, setTheirLoadingMore] = useState(false);
  const [oursLoadingMore, setOursLoadingMore] = useState(false);
  const listRef = useRef<FlatList<CollectedItem[]>>(null);
  const sharedRefreshGeneration = useRef(0);
  const screenRefreshGeneration = useRef(0);
  const ourItemsRef = useRef(initialOurItems);

  const applyOurItems = useCallback((items: ReturnType<typeof getCachedSharedBox>['items']) => {
    const next = sharedBoxToCollectedItems(items);
    const currentIds = new Set(ourItemsRef.current.map((item) => item.itemId));
    const newlyVisible = next.reduce((count, item) => count + (currentIds.has(item.itemId) ? 0 : 1), 0);
    ourItemsRef.current = next;
    setOurItems(next);
    // Keep every tile that was already visible in view when new unique items
    // are prepended. Otherwise slice(0, 100) makes the same number of old tail
    // tiles appear to have been overwritten until another pagination event.
    if (newlyVisible > 0) {
      setVisibleCount((count) => Math.min(next.length, Math.max(COLLECTION_PAGE_SIZE, count + newlyVisible)));
    }
  }, []);

  const selectCollectionTab = useCallback((nextTab: CollectionTab) => {
    setTab(nextTab);
    router.setParams({ tab: nextTab });
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const screenGeneration = ++screenRefreshGeneration.current;
      // Six-hour TTL is evaluated lazily here; rendering always uses the local
      // bundled + cached dictionary first.
      void refreshRemoteItems();
      // Repaint persistent snapshots first. Network work only runs when the
      // corresponding snapshot is stale, so revisiting this tab is instant.
      const cachedPair = getCachedPairing();
      setMineItems(getCachedBags());
      setMineHistoryComplete(isBagsHistoryComplete('mine'));
      if (cachedPair) setPairing(cachedPair);
      if (cachedPair?.paired && cachedPair.partner) {
        setTheirItems(getCachedTheirBags(cachedPair.partner.userId));
        setTheirHistoryComplete(isBagsHistoryComplete('their', cachedPair.partner.userId));
        const cachedShared = getCachedSharedBox(cachedPair.partner.userId);
        applyOurItems(cachedShared.items);
        setOursUnread(cachedShared.hasUnreadFromPartner);
        setOursReadThrough(cachedShared.readThrough);
        setOursHistoryComplete(cachedShared.historyComplete);
      }
      setLoaded(true);

      const pairPromise = cachedPair && !isPairingCacheStale()
        ? Promise.resolve(cachedPair)
        : fetchPairing();
      void Promise.all([refreshBagsIfStale(), pairPromise]).then(async ([mine, pair]) => {
        if (!active || screenGeneration !== screenRefreshGeneration.current) return;
        setMineItems(mine);
        setMineHistoryComplete(isBagsHistoryComplete('mine'));
        setPairing(pair);

        if (pair.paired && pair.partner) {
          const sharedGeneration = ++sharedRefreshGeneration.current;
          const cachedShared = getCachedSharedBox(pair.partner.userId);
          const [theirs, shared] = await Promise.all([
            refreshBagsIfStale('their', pair.partner.userId),
            isSharedBoxCacheStale(pair.partner.userId)
              ? fetchSharedBoxWithMeta(pair.partner.userId)
              : Promise.resolve(cachedShared),
          ]);
          if (!active || screenGeneration !== screenRefreshGeneration.current) return;
          setTheirItems(theirs);
          setTheirHistoryComplete(isBagsHistoryComplete('their', pair.partner.userId));
          if (sharedGeneration === sharedRefreshGeneration.current) {
            applyOurItems(shared.items);
            setOursUnread(shared.hasUnreadFromPartner);
            setOursReadThrough(shared.readThrough);
            setOursHistoryComplete(shared.historyComplete);
          }
        } else {
          setTheirItems([]);
          setTheirHistoryComplete(true);
          ourItemsRef.current = [];
          setOurItems([]);
          setOursUnread(false);
          setOursHistoryComplete(true);
        }
        setLoaded(true);
      });
      return () => { active = false; };
    }, [applyOurItems]),
  );

  const shown = useMemo(() => {
    if (tab === 'their') return theirItems;
    if (tab === 'ours') return ourItems;
    return mineItems;
  }, [mineItems, ourItems, tab, theirItems]);

  const [visibleCount, setVisibleCount] = useState(COLLECTION_PAGE_SIZE);
  useEffect(() => setVisibleCount(COLLECTION_PAGE_SIZE), [tab]);
  const paged = shown.slice(0, visibleCount);
  // Render explicit rows instead of FlatList's numColumns mode. When new
  // items are prepended, numColumns can briefly reuse stale row buckets and
  // hide displaced cells until a remount. Stable row-position keys keep the
  // virtualized containers mounted while React reconciles each tile by id.
  const rows = useMemo(() => {
    const result: CollectedItem[][] = [];
    for (let index = 0; index < paged.length; index += numColumns) {
      result.push(paged.slice(index, index + numColumns));
    }
    return result;
  }, [numColumns, paged]);
  const partner = pairing?.paired ? pairing.partner : null;

  const loadMore = useCallback(() => {
    if (visibleCount < shown.length) {
      setVisibleCount((count) => Math.min(count + COLLECTION_PAGE_SIZE, shown.length));
      return;
    }
    if (tab === 'mine') {
      if (mineHistoryComplete || mineLoadingMore) return;
      setMineLoadingMore(true);
      void fetchMoreBags('mine').then((items) => {
        setMineItems(items);
        setMineHistoryComplete(isBagsHistoryComplete('mine'));
        setVisibleCount((count) => Math.min(items.length, count + COLLECTION_PAGE_SIZE));
      }).finally(() => setMineLoadingMore(false));
      return;
    }
    if (tab === 'their') {
      if (!partner || theirHistoryComplete || theirLoadingMore) return;
      setTheirLoadingMore(true);
      void fetchMoreBags('their', partner.userId).then((items) => {
        setTheirItems(items);
        setTheirHistoryComplete(isBagsHistoryComplete('their', partner.userId));
        setVisibleCount((count) => Math.min(items.length, count + COLLECTION_PAGE_SIZE));
      }).finally(() => setTheirLoadingMore(false));
      return;
    }
    if (!partner || oursHistoryComplete || oursLoadingMore) return;
    setOursLoadingMore(true);
    void fetchMoreSharedBox(partner.userId).then((shared) => {
      applyOurItems(shared.items);
      setOursHistoryComplete(shared.historyComplete);
      setOursReadThrough(shared.readThrough);
      setVisibleCount((count) => Math.min(sharedBoxToCollectedItems(shared.items).length, count + COLLECTION_PAGE_SIZE));
    }).finally(() => setOursLoadingMore(false));
  }, [
    applyOurItems,
    mineHistoryComplete,
    mineLoadingMore,
    oursHistoryComplete,
    oursLoadingMore,
    partner,
    shown.length,
    tab,
    theirHistoryComplete,
    theirLoadingMore,
    visibleCount,
  ]);

  useEffect(() => {
    if (!partner) return;
    return subscribeSharedBoxChanges((change) => {
      if (change.friendUserId !== partner.userId) return;
      // Paint the optimistic cache synchronously before any network request.
      applyOurItems(getCachedSharedBox(change.friendUserId).items);
      const generation = ++sharedRefreshGeneration.current;
      void fetchSharedBoxWithMeta(change.friendUserId).then((shared) => {
        if (generation !== sharedRefreshGeneration.current) return;
        applyOurItems(shared.items);
        setOursUnread(shared.hasUnreadFromPartner);
        setOursReadThrough(shared.readThrough);
        setOursHistoryComplete(shared.historyComplete);
        // New rows are sorted at the head. Explicitly reset the virtualized
        // list's retained offset so those rows cannot remain above the viewport.
        requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: 0, animated: false }));
      });
    });
  }, [applyOurItems, partner]);

  useEffect(() => {
    if (tab !== 'ours' || !partner || !oursUnread) return;
    setOursUnread(false);
    void markSharedBoxRead(partner.userId, oursReadThrough).then((ok) => {
      if (!ok) setOursUnread(true);
    });
  }, [oursReadThrough, oursUnread, partner, tab]);

  function openSharedCreator() {
    void haptics.pageOpen();
    if (!partner) {
      router.push('/(main)/(tabs)/friends' as never);
      return;
    }
    router.push({
      pathname: '/(main)/shared-memory-create',
      params: {
        friendUserId: partner.userId,
      },
    });
  }

  const headerButtonLabel = tab === 'mine' ? 'My Logs' : tab === 'their' ? 'Their Logs' : 'Create';

  function openHeaderDestination() {
    if (tab === 'mine') {
      void haptics.pageOpen();
      router.push('/(main)/my-logs');
      return;
    }
    if (tab === 'their') {
      void haptics.pageOpen();
      router.push('/(main)/(tabs)/friends' as never);
      return;
    }
    openSharedCreator();
  }

  function emptyCopy(): string {
    if (tab === 'mine') return 'Start reflecting and collecting the little things in your days.';
    if (tab === 'their') {
      return partner
        ? "They haven't reflect anything yet."
        : 'Pair with someone now and start seeing their little moments.';
    }
    return partner
      ? 'No shared memories available, create now.'
      : 'Pair with someone now and start creating items with shared memories.';
  }

  const gridColors = TAB_GRID[tab];

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: gridColors.base }]} edges={['top']}>
      <GridBackground base={gridColors.base} line={gridColors.line} cell={22} lineWidth={1.4} />
      <View style={styles.content}>
        <View style={styles.header}>
          <Image source={ICONS.memory} style={styles.headerIcon} resizeMode="contain" />
          <View style={styles.titleWrap}>
            <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
              Memories Hub
            </Text>
          </View>

          <OffsetCard
            color="#C96F2A"
            offset={4}
            radius={18}
            onPress={openHeaderDestination}
            cardStyle={styles.headerButton}
          >
            <View style={styles.headerButtonIconSlot}>
              <Image
                source={ICONS.sharedMemories}
                style={[styles.headerButtonIcon, tab === 'ours' && styles.headerButtonIconHidden]}
                resizeMode="contain"
              />
              <Image
                source={ICONS.add}
                style={[styles.headerButtonIcon, tab !== 'ours' && styles.headerButtonIconHidden]}
                resizeMode="contain"
              />
            </View>
            <Text style={styles.headerButtonText}>{headerButtonLabel}</Text>
          </OffsetCard>
        </View>

      <View style={styles.tabStrip}>
        {COLLECTION_TABS.map((entry) => {
          const active = entry.key === tab;
          return (
            <Pressable
              key={entry.key}
              onPress={() => selectCollectionTab(entry.key)}
              style={[styles.tab, active && styles.tabActive]}
            >
              <View>
                <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{entry.label}</Text>
                {entry.key === 'ours' && oursUnread ? <View style={styles.unreadDot} /> : null}
              </View>
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
          <Text style={styles.emptyText}>{emptyCopy()}</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          key={`${tab}-${numColumns}`}
          data={rows}
          keyExtractor={(_, index) => `${tab}-row-${index}`}
          contentContainerStyle={styles.gridScroll}
          showsVerticalScrollIndicator={false}
          onEndReached={loadMore}
          onEndReachedThreshold={0.6}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          renderItem={({ item: row }) => (
            <View style={styles.gridRow}>
              {row.map((item) => (
                <Pressable
                  key={item.itemId}
                  onPress={() => {
                    void haptics.pageOpen();
                    router.push({
                      pathname: '/(main)/item-sheet',
                      params: {
                        itemId: item.itemId,
                        scope: tab,
                        ...(partner?.userId ? { expectedOwnerUserId: partner.userId } : {}),
                      },
                    });
                  }}
                  style={[styles.cell, { width: cellWidth }]}
                >
                  <View style={styles.itemCard}>
                    <ItemSprite itemId={item.itemId} size={tileSize} radius={18} tileColor="transparent" />
                    {item.count > 1 ? (
                      <View style={styles.countBadge}>
                        <Text style={styles.countBadgeText}>x{item.count > 99 ? '99+' : item.count}</Text>
                      </View>
                    ) : null}
                  </View>
                </Pressable>
              ))}
            </View>
          )}
          ListFooterComponent={
            (tab === 'mine' && mineLoadingMore)
              || (tab === 'their' && theirLoadingMore)
              || (tab === 'ours' && oursLoadingMore)
              ? <ActivityIndicator color="#8A6240" />
              : null
          }
        />
      )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8DF91' },
  content: { flex: 1, paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 10, paddingBottom: 10 },
  headerIcon: { width: 56, height: 56 },
  titleWrap: { flex: 1 },
  title: { fontSize: 27, lineHeight: 33, fontFamily: 'Inter_800ExtraBold', color: '#4A2E17' },
  headerButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    minHeight: 56, backgroundColor: '#F0913D', paddingHorizontal: 14, paddingVertical: 13,
  },
  headerButtonIconSlot: { width: 30, height: 30 },
  headerButtonIcon: { position: 'absolute', width: 30, height: 30 },
  headerButtonIconHidden: { opacity: 0 },
  headerButtonText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter_700Bold' },
  unreadDot: {
    position: 'absolute', right: -10, top: -4, width: 9, height: 9,
    borderRadius: 5, backgroundColor: '#E53935',
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
  gridRow: { flexDirection: 'row', width: '100%' },
  cell: { alignItems: 'center', marginBottom: 10, paddingHorizontal: 3 },
  itemCard: {
    width: '100%', aspectRatio: 1, borderRadius: 18, backgroundColor: 'rgba(76,51,27,0.10)',
    alignItems: 'center', justifyContent: 'center',
  },
  countBadge: {
    position: 'absolute', right: -2, bottom: -2, backgroundColor: '#4A3423',
    borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2,
  },
  countBadgeText: { color: '#FFFFFF', fontSize: 10, fontFamily: 'Inter_800ExtraBold' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 12 },
  emptyText: {
    fontSize: 15, fontFamily: 'Inter_500Medium', color: '#9A8770',
    textAlign: 'center', lineHeight: 22,
  },
});
