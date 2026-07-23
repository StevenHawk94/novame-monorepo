import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useRouter } from 'expo-router';
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
import { getCachedBags, type CollectedItem } from '@/lib/bags-api';
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
export const ItemSheet = forwardRef<ItemSheetRef>((_, ref) => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const sheetH = screenH * 0.82;
  const sheetRef = useRef<BottomSheetModal>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const snapPoints = useMemo(() => ['82%'], []);

  useImperativeHandle(ref, () => ({
    present: (id: string) => {
      setItemId(id);
      sheetRef.current?.present();
    },
    dismiss: () => sheetRef.current?.dismiss(),
  }));

  const item: CollectedItem | undefined = useMemo(
    () => (itemId ? getCachedBags().find((it) => it.itemId === itemId) : undefined),
    [itemId],
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.5} />
    ),
    [],
  );

  function openReflect(reflectId: string) {
    void haptics.light();
    router.push({ pathname: '/(main)/reflect-detail', params: { reflectId } });
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
    >
      <BottomSheetView style={[styles.content, { height: sheetH }]}>
        <View style={styles.innerCard}>
          {item && (
            <>
              {/* Header: name + memory count left, Recent pill right */}
              <View style={styles.header}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.displayName}</Text>
                  <Text style={styles.memCount}>
                    {item.memories.length} {item.memories.length === 1 ? 'Memory' : 'Memories'}
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
              >
                {item.memories.map((m, i) => (
                  <View key={i} style={styles.memCard}>
                    <ItemSprite itemId={item.itemId} size={72} radius={16} />
                    <View style={styles.memBody}>
                      <Text style={styles.memExcerpt} numberOfLines={3}>{m.excerpt}</Text>
                    </View>
                    <Pressable
                      onPress={() => openReflect(m.reflectId)}
                      style={({ pressed }) => [styles.detailsBtn, pressed && { opacity: 0.7 }]}
                    >
                      <Text style={styles.detailsText}>Details</Text>
                      <MaterialIcons name="chevron-right" size={16} color="#FFFFFF" />
                    </Pressable>
                  </View>
                ))}
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
  name: { fontSize: 30, fontFamily: 'Inter_800ExtraBold', color: '#161311' },
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
