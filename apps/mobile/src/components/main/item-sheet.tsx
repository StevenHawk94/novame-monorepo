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

export type ItemSheetRef = {
  present: (itemId: string) => void;
  dismiss: () => void;
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

/**
 * Item detail sheet. Tapping an item in Bags pulls this up (same interaction as
 * the companion sheet): the item's portrait, its memory count, and every memory
 * -- each a card with the excerpt and a Details button that opens the full
 * reflection. A light card over a soft backdrop; fixed height, content scrolls.
 */
export const ItemSheet = forwardRef<ItemSheetRef>((_, ref) => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const sheetH = screenH * 0.75;
  const sheetRef = useRef<BottomSheetModal>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const snapPoints = useMemo(() => ['75%'], []);

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
        {item && (
          <>
            {/* Header: portrait + name + memory count */}
            <View style={styles.header}>
              <View style={styles.portrait}>
                <Text style={styles.portraitEmoji}>{item.emoji}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.displayName}</Text>
                <Text style={styles.memCount}>
                  {item.memories.length} {item.memories.length === 1 ? 'Memory' : 'Memories'}
                </Text>
              </View>
            </View>

            {/* Memories */}
            <BottomSheetScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
              {item.memories.map((m, i) => (
                <View key={i} style={styles.memCard}>
                  <View style={styles.memThumb}>
                    <Text style={styles.memThumbEmoji}>{item.emoji}</Text>
                  </View>
                  <View style={styles.memBody}>
                    <Text style={styles.memExcerpt} numberOfLines={3}>{m.excerpt}</Text>
                    <Text style={styles.memDate}>{formatDate(m.createdAt)}</Text>
                  </View>
                  <Pressable
                    onPress={() => openReflect(m.reflectId)}
                    style={({ pressed }) => [styles.detailsBtn, pressed && { opacity: 0.7 }]}
                  >
                    <Text style={styles.detailsText}>Details</Text>
                  </Pressable>
                </View>
              ))}
            </BottomSheetScrollView>
          </>
        )}

        {/* Close */}
        <Pressable onPress={() => sheetRef.current?.dismiss()} style={[styles.closeBtn, { bottom: insets.bottom + 12 }]} hitSlop={8}>
          <MaterialIcons name="close" size={26} color="#3A2A1A" />
        </Pressable>
      </BottomSheetView>
    </BottomSheetModal>
  );
});

ItemSheet.displayName = 'ItemSheet';

const styles = StyleSheet.create({
  sheetBg: { backgroundColor: '#FBF3E8', borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  content: { borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden', paddingHorizontal: 20, paddingTop: 24, paddingBottom: 30 },

  header: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 18 },
  portrait: {
    width: 64, height: 64, borderRadius: 20, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#8A6D3B', shadowOpacity: 0.1, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
  },
  portraitEmoji: { fontSize: 34 },
  name: { fontSize: 24, fontFamily: 'Inter_800ExtraBold', color: '#3A2A1A' },
  memCount: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#8A6240', marginTop: 2 },

  scroll: { gap: 14, paddingBottom: 90 },
  memCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FFFFFF', borderRadius: 20, padding: 14,
    shadowColor: '#8A6D3B', shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
  },
  memThumb: {
    width: 60, height: 60, borderRadius: 14, backgroundColor: '#FBF3E8',
    alignItems: 'center', justifyContent: 'center',
  },
  memThumbEmoji: { fontSize: 30 },
  memBody: { flex: 1 },
  memExcerpt: { fontSize: 14, fontFamily: 'Inter_500Medium', color: '#3A2E1A', lineHeight: 20 },
  memDate: { fontSize: 12, fontFamily: 'Inter_500Medium', color: '#9A8770', marginTop: 4 },
  // Design: solid dark-brown Details pill with white text.
  detailsBtn: {
    borderRadius: 16, backgroundColor: '#4A3423',
    paddingHorizontal: 14, paddingVertical: 10,
  },
  detailsText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },

  closeBtn: {
    position: 'absolute', alignSelf: 'center',
    width: 52, height: 52, borderRadius: 26, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
  },
});
