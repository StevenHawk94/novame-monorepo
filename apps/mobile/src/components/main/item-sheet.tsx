import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';

import { haptics } from '@/lib/haptics';
import {
  fetchItemMemories,
  fetchMoreItemMemories,
  getCachedBags,
  getCachedTheirBags,
  type CollectedItem,
} from '@/lib/bags-api';
import { ItemSprite } from '@/components/ui/item-sprite';

export type ItemSheetRef = {
  present: (itemId: string) => void;
  dismiss: () => void;
};

/**
 * Item detail sheet (design 2026-07-22, 1:1): a dark-brown sheet holding one
 * off-white card -- item name + "N Memories" on the left, a dark "Recent"
 * pill on the right, then every memory as a thin-bordered row (thumbnail,
 * excerpt, Details pill). Dark round close button at the bottom.
 */
type ItemSheetProps = {
  items?: CollectedItem[];
  scope?: 'mine' | 'their' | 'ours';
  expectedOwnerUserId?: string;
};

export const ItemSheet = forwardRef<ItemSheetRef, ItemSheetProps>(({
  items,
  scope = 'mine',
  expectedOwnerUserId,
}, ref) => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const sheetH = screenH * 0.82;
  const sheetRef = useRef<BottomSheetModal>(null);
  const pendingReflectIdRef = useRef<string | null>(null);
  const reopenAfterDetailsRef = useRef(false);
  const [itemId, setItemId] = useState<string | null>(null);
  const activeItemIdRef = useRef<string | null>(null);
  const itemsRef = useRef(items);
  const [item, setItem] = useState<CollectedItem | undefined>();
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [loadingMoreDetails, setLoadingMoreDetails] = useState(false);
  const snapPoints = useMemo(() => ['82%'], []);

  useEffect(() => {
    itemsRef.current = items;
    if (!activeItemIdRef.current) return;
    const updated = items?.find((candidate) => candidate.itemId === activeItemIdRef.current);
    if (updated && scope === 'ours') setItem(updated);
  }, [items, scope]);

  const readImmediateItem = useCallback((id: string) => {
    const supplied = itemsRef.current?.find((candidate) => candidate.itemId === id);
    if (supplied) return supplied;
    return scope === 'their'
      ? getCachedTheirBags(expectedOwnerUserId).find((candidate) => candidate.itemId === id)
      : getCachedBags().find((candidate) => candidate.itemId === id);
  }, [expectedOwnerUserId, scope]);

  useImperativeHandle(ref, () => ({
    present: (id: string) => {
      activeItemIdRef.current = id;
      setItemId(id);
      setItem(readImmediateItem(id));
      sheetRef.current?.present();
      if (scope !== 'ours') {
        setLoadingDetails(true);
        void fetchItemMemories(scope, id, expectedOwnerUserId).then((fresh) => {
          if (fresh && activeItemIdRef.current === id) setItem(fresh);
        }).finally(() => {
          if (activeItemIdRef.current === id) setLoadingDetails(false);
        });
      }
    },
    dismiss: () => sheetRef.current?.dismiss(),
  }), [expectedOwnerUserId, readImmediateItem, scope]);

  const loadMoreDetails = useCallback(() => {
    if (!itemId || scope === 'ours' || item?.memoriesComplete || loadingMoreDetails) return;
    setLoadingMoreDetails(true);
    void fetchMoreItemMemories(scope, itemId, expectedOwnerUserId).then((fresh) => {
      if (fresh && activeItemIdRef.current === itemId) setItem(fresh);
    }).finally(() => {
      if (activeItemIdRef.current === itemId) setLoadingMoreDetails(false);
    });
  }, [expectedOwnerUserId, item?.memoriesComplete, itemId, loadingMoreDetails, scope]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.5} />
    ),
    [],
  );

  const handleSheetDismiss = useCallback(() => {
    const reflectId = pendingReflectIdRef.current;
    if (!reflectId) {
      activeItemIdRef.current = null;
      setLoadingDetails(false);
      setLoadingMoreDetails(false);
      return;
    }

    // The root BottomSheet portal must finish closing before a Stack route is
    // pushed. Otherwise the route is mounted underneath the still-open sheet.
    pendingReflectIdRef.current = null;
    router.push({ pathname: '/(main)/reflect-detail', params: { reflectId } });
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      if (!reopenAfterDetailsRef.current) return undefined;

      // Returning from reflection details should reveal the item list the user
      // came from, while keeping that list in the root portal above the tab bar.
      reopenAfterDetailsRef.current = false;
      const frame = requestAnimationFrame(() => sheetRef.current?.present());
      return () => cancelAnimationFrame(frame);
    }, []),
  );

  function openReflect(reflectId: string) {
    void haptics.light();
    pendingReflectIdRef.current = reflectId;
    reopenAfterDetailsRef.current = true;
    sheetRef.current?.dismiss();
  }

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      backdropComponent={renderBackdrop}
      handleComponent={null}
      backgroundStyle={styles.sheetBg}
      enableContentPanningGesture={false}
      enableHandlePanningGesture={false}
      enableOverDrag={false}
      onDismiss={handleSheetDismiss}
    >
      <BottomSheetView style={[styles.content, { height: sheetH }]}>
        <View style={styles.innerCard}>
          {item && (
            <>
              {/* Header: name + memory count left, Recent pill right */}
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

              {/* Memories */}
              <BottomSheetScrollView
                style={{ flex: 1 }}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.scroll}
                onScroll={({ nativeEvent }) => {
                  const remaining = nativeEvent.contentSize.height
                    - nativeEvent.layoutMeasurement.height
                    - nativeEvent.contentOffset.y;
                  if (remaining < 160) loadMoreDetails();
                }}
              >
                {item.memories.length === 0 && loadingDetails ? (
                  <ActivityIndicator style={styles.detailsLoader} color="#8A6240" />
                ) : null}
                {item.memories.length === 0 && !loadingDetails ? (
                  <Text style={styles.noDetails}>Memory details aren’t available for this item.</Text>
                ) : null}
                {item.memories.map((m, i) => {
                  // A name-only excerpt is not a written memory (mock 2026-08-08):
                  // rows show DATE + description, never the item's own name.
                  const wrote =
                    m.excerpt.trim().length > 0 &&
                    m.excerpt.trim().toLowerCase() !== item.displayName.trim().toLowerCase();
                  const dateLabel = new Date(m.createdAt).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric',
                  });
                  return (
                    <View key={i} style={styles.memCard}>
                      <ItemSprite itemId={item.itemId} size={72} radius={16} />
                      <View style={styles.memBody}>
                        <Text style={styles.memDate}>{dateLabel}</Text>
                        <Text
                          style={[styles.memExcerpt, !wrote && styles.memExcerptEmpty]}
                          numberOfLines={3}
                        >
                          {wrote ? m.excerpt : 'No memory was added to this item.'}
                        </Text>
                      </View>
                      {m.reflectId ? (
                        <Pressable
                          onPress={() => openReflect(m.reflectId!)}
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
              </BottomSheetScrollView>
            </>
          )}

          {/* Close: dark circle, white X (mock) */}
          <Pressable
            onPress={() => sheetRef.current?.dismiss()}
            style={[styles.closeBtn, { bottom: insets.bottom + 14 }]}
            hitSlop={8}
          >
            <MaterialIcons name="close" size={28} color="#FFFFFF" />
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
});

ItemSheet.displayName = 'ItemSheet';

const styles = StyleSheet.create({
  // Dark-brown shell with the off-white card inset (mock's thick brown rim).
  sheetBg: { backgroundColor: '#43301F', borderTopLeftRadius: 34, borderTopRightRadius: 34 },
  content: {
    borderTopLeftRadius: 34, borderTopRightRadius: 34, overflow: 'hidden',
    padding: 14, paddingBottom: 0,
  },
  innerCard: {
    flex: 1, backgroundColor: '#FDF9F1', borderRadius: 26,
    paddingHorizontal: 20, paddingTop: 26,
  },

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
  // Mock: thin warm-bordered rows on the off-white card, no shadows.
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
  // Design: solid dark-brown Details pill with white text.
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
