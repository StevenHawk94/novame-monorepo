import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';

import { haptics } from '@/lib/haptics';
import {
  fetchItemMemories,
  fetchMoreItemMemories,
  getCachedBags,
  getCachedTheirBags,
  sharedBoxToCollectedItems,
  type CollectedItem,
} from '@/lib/bags-api';
import { getCachedSharedBox } from '@/lib/friends-api';
import { ItemSprite } from '@/components/ui/item-sprite';

export type ItemSheetScope = 'mine' | 'their' | 'ours';

type ItemSheetProps = {
  itemId: string;
  scope?: ItemSheetScope;
  expectedOwnerUserId?: string;
  onClose: () => void;
  onOpenReflect: (reflectId: string) => void;
};

function readCachedItem(
  itemId: string,
  scope: ItemSheetScope,
  expectedOwnerUserId?: string,
): CollectedItem | undefined {
  const items = scope === 'ours'
    ? sharedBoxToCollectedItems(getCachedSharedBox(expectedOwnerUserId).items)
    : scope === 'their'
      ? getCachedTheirBags(expectedOwnerUserId)
      : getCachedBags();
  return items.find((candidate) => candidate.itemId === itemId);
}

/**
 * Item memories sheet rendered inside the navigation stack. Keeping this
 * content out of BottomSheetModal's root portal lets reflection details stack
 * above it and reveal the still-mounted list when the detail route is popped.
 */
export function ItemSheet({
  itemId,
  scope = 'mine',
  expectedOwnerUserId,
  onClose,
  onOpenReflect,
}: ItemSheetProps) {
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const sheetH = screenH * 0.82;
  const [item, setItem] = useState<CollectedItem | undefined>(() => (
    readCachedItem(itemId, scope, expectedOwnerUserId)
  ));
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [loadingMoreDetails, setLoadingMoreDetails] = useState(false);

  useEffect(() => {
    let active = true;
    const cached = readCachedItem(itemId, scope, expectedOwnerUserId);
    if (cached) setItem(cached);
    if (scope === 'ours') return () => { active = false; };

    setLoadingDetails(true);
    void fetchItemMemories(scope, itemId, expectedOwnerUserId).then((fresh) => {
      if (active && fresh) setItem(fresh);
    }).finally(() => {
      if (active) setLoadingDetails(false);
    });
    return () => { active = false; };
  }, [expectedOwnerUserId, itemId, scope]);

  const loadMoreDetails = useCallback(() => {
    if (scope === 'ours' || item?.memoriesComplete || loadingMoreDetails) return;
    setLoadingMoreDetails(true);
    void fetchMoreItemMemories(scope, itemId, expectedOwnerUserId).then((fresh) => {
      if (fresh) setItem(fresh);
    }).finally(() => setLoadingMoreDetails(false));
  }, [expectedOwnerUserId, item?.memoriesComplete, itemId, loadingMoreDetails, scope]);

  function openReflect(reflectId: string) {
    void haptics.pageOpen();
    onOpenReflect(reflectId);
  }

  return (
    <View style={styles.overlay}>
      <Pressable
        onPress={onClose}
        style={[styles.backdrop, { height: Math.max(0, screenH - sheetH) }]}
        accessibilityRole="button"
        accessibilityLabel="Close item memories"
      />

      <View style={[styles.sheet, { height: sheetH }]}>
        <View style={styles.innerCard}>
          {item ? (
            <>
              <View style={styles.header}>
                <View style={{ flex: 1 }}>
                  <Text
                    style={styles.name}
                    numberOfLines={3}
                    maxFontSizeMultiplier={Platform.OS === 'android' ? 1.15 : undefined}
                  >
                    {item.displayName}
                  </Text>
                  <Text style={styles.memCount}>
                    {item.count} {item.count === 1 ? 'Memory' : 'Memories'}
                  </Text>
                </View>
                <View style={styles.recentPill}>
                  <Text style={styles.recentText}>Recent</Text>
                  <MaterialIcons name="keyboard-arrow-down" size={20} color="#FFFFFF" />
                </View>
              </View>

              <ScrollView
                style={{ flex: 1 }}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.scroll}
                onScroll={({ nativeEvent }) => {
                  const remaining = nativeEvent.contentSize.height
                    - nativeEvent.layoutMeasurement.height
                    - nativeEvent.contentOffset.y;
                  if (remaining < 160) loadMoreDetails();
                }}
                scrollEventThrottle={100}
              >
                {item.memories.length === 0 && loadingDetails ? (
                  <ActivityIndicator style={styles.detailsLoader} color="#8A6240" />
                ) : null}
                {item.memories.length === 0 && !loadingDetails ? (
                  <Text style={styles.noDetails}>Memory details aren’t available for this item.</Text>
                ) : null}
                {item.memories.map((memory, index) => {
                  const wrote =
                    memory.excerpt.trim().length > 0
                    && memory.excerpt.trim().toLowerCase() !== item.displayName.trim().toLowerCase();
                  const dateLabel = new Date(memory.createdAt).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric',
                  });
                  return (
                    <View key={`${memory.reflectId ?? memory.createdAt}-${index}`} style={styles.memCard}>
                      <ItemSprite itemId={item.itemId} size={72} radius={16} />
                      <View style={styles.memBody}>
                        <Text style={styles.memDate}>{dateLabel}</Text>
                        <Text
                          style={[styles.memExcerpt, !wrote && styles.memExcerptEmpty]}
                          numberOfLines={3}
                        >
                          {wrote ? memory.excerpt : 'No memory was added to this item.'}
                        </Text>
                      </View>
                      {memory.reflectId ? (
                        <Pressable
                          onPress={() => openReflect(memory.reflectId!)}
                          style={({ pressed }) => [styles.detailsBtn, pressed && { opacity: 0.7 }]}
                        >
                          <Text style={styles.detailsText}>Details</Text>
                          <MaterialIcons name="chevron-right" size={16} color="#FFFFFF" />
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })}
                {loadingMoreDetails ? (
                  <ActivityIndicator style={styles.detailsLoader} color="#8A6240" />
                ) : null}
                {scope !== 'ours' && !item.memoriesComplete && !loadingMoreDetails ? (
                  <Pressable
                    onPress={loadMoreDetails}
                    style={({ pressed }) => [styles.loadMoreButton, pressed && { opacity: 0.72 }]}
                  >
                    <Text style={styles.loadMoreText}>Load older memories</Text>
                  </Pressable>
                ) : null}
              </ScrollView>
            </>
          ) : loadingDetails ? (
            <ActivityIndicator style={styles.itemLoader} color="#8A6240" />
          ) : (
            <Text style={styles.noDetails}>This item is no longer available.</Text>
          )}

          <Pressable
            onPress={onClose}
            style={[styles.closeBtn, { bottom: insets.bottom + 14 }]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close item memories"
          >
            <MaterialIcons name="close" size={28} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 0,
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    zIndex: 1,
    backgroundColor: '#43301F',
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
    overflow: 'hidden',
    padding: 14,
    paddingBottom: 0,
  },
  innerCard: {
    flex: 1, backgroundColor: '#FDF9F1', borderRadius: 26,
    paddingHorizontal: 20, paddingTop: 26,
  },
  itemLoader: { flex: 1 },

  header: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 20 },
  name: {
    fontSize: Platform.OS === 'android' ? 24 : 30,
    lineHeight: Platform.OS === 'android' ? 29 : 36,
    fontFamily: 'Inter_800ExtraBold',
    color: '#161311',
  },
  memCount: { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#8A6240', marginTop: 6 },
  recentPill: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: '#4A3423', borderRadius: 22,
    paddingLeft: 18, paddingRight: 12, paddingVertical: 11,
  },
  recentText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },

  scroll: { gap: 14, paddingBottom: 100 },
  memCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#FFFFFF', borderRadius: 18,
    borderWidth: 1.5, borderColor: '#D8BCA8', padding: 14,
  },
  memBody: { flex: 1 },
  memExcerpt: { fontSize: 16, fontFamily: 'Inter_500Medium', color: '#2A2118', lineHeight: 23 },
  memDate: { fontSize: 14, fontFamily: 'Inter_800ExtraBold', color: '#161311', marginBottom: 3 },
  memExcerptEmpty: { color: '#A99A85' },
  noDetails: {
    paddingHorizontal: 18, paddingVertical: 28, textAlign: 'center',
    color: '#A99A85', fontSize: 14, lineHeight: 21, fontFamily: 'Inter_500Medium',
  },
  detailsLoader: { marginVertical: 22 },
  loadMoreButton: {
    alignSelf: 'center', borderRadius: 18, backgroundColor: '#EAD6BD',
    paddingHorizontal: 18, paddingVertical: 11, marginTop: 2,
  },
  loadMoreText: { color: '#4A3423', fontSize: 14, fontFamily: 'Inter_700Bold' },
  detailsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 1,
    borderRadius: 18, backgroundColor: '#4A3423',
    paddingLeft: 14, paddingRight: 9, paddingVertical: 11,
  },
  detailsText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },

  closeBtn: {
    position: 'absolute', alignSelf: 'center',
    width: 58, height: 58, borderRadius: 29, backgroundColor: '#4A3423',
    alignItems: 'center', justifyContent: 'center',
  },
});
