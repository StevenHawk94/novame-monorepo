import { Image as ExpoImage } from 'expo-image';
import { router } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GridBackground } from '@/components/ui/grid-background';
import { haptics } from '@/lib/haptics';
import { ICONS } from '@/lib/icons';

const PARK_ICON = require('../../../assets/items/each/memory.1486_park.webp');

const INK = '#4A2F17';
const BROWN = '#4A3220';
const CREAM = '#FFF7E8';

export default function ReflectionPlusPaywallModal() {
  const insets = useSafeAreaInsets();

  const close = () => {
    void haptics.light();
    router.back();
  };

  const openPlans = () => {
    void haptics.pageOpen();
    router.replace('/(main)/(modals)/subscription-paywall?phase=plans' as never);
  };

  return (
    <View style={styles.screen}>
      <GridBackground />
      <Pressable
        onPress={close}
        hitSlop={10}
        style={[styles.close, { top: insets.top + 8 }]}
      >
        <MaterialIcons name="close" size={24} color="#FFFFFF" />
      </Pressable>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 78, paddingBottom: insets.bottom + 18 },
        ]}
      >
        <Text style={styles.title}>Join Plus to enjoy all the premium features</Text>
        <Text style={styles.subtitle}>
          One Plus subscription unlocks the full experience for both of you.
        </Text>

        <View style={styles.compareCard}>
          <View pointerEvents="none" style={styles.lockAnchor}>
            <ExpoImage
              source={ICONS.obPaywallUnlock}
              style={styles.lockImage}
              contentFit="contain"
            />
          </View>
          <View style={styles.columns}>
            <View style={styles.column}>
              <View style={styles.freeBadge}><Text style={styles.freeBadgeText}>Free</Text></View>
              <Text style={styles.columnCaption}>Memories Need Your Input</Text>
              <View style={styles.itemCard}>
                <ExpoImage
                  source={PARK_ICON}
                  style={styles.itemImage}
                  contentFit="contain"
                />
                <Text style={styles.plusDetail}>[Input your memory]</Text>
              </View>
            </View>

            <View style={styles.column}>
              <View style={styles.plusBadge}><Text style={styles.plusBadgeText}>Plus</Text></View>
              <Text style={styles.columnCaption}>Auto Summarize Reflections into Memories</Text>
              <View style={styles.itemCard}>
                <ExpoImage
                  source={PARK_ICON}
                  style={styles.itemImage}
                  contentFit="contain"
                />
                <Text style={styles.plusDetail}>
                  The park I went to tonight where I met my college friend James!
                </Text>
              </View>
            </View>
          </View>
        </View>

        <Text style={styles.promise}>
          And more features to help you live your life while staying close to your person.
        </Text>

        <Pressable onPress={openPlans} style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}>
          <Text style={styles.ctaText}>Try for Free</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F8E2C1' },
  close: {
    position: 'absolute', left: 18, zIndex: 3,
    width: 48, height: 48, borderRadius: 24, backgroundColor: BROWN,
    alignItems: 'center', justifyContent: 'center',
  },
  content: { flexGrow: 1, paddingHorizontal: 22 },
  title: {
    color: INK, fontSize: 29, lineHeight: 37, fontFamily: 'Inter_800ExtraBold',
    textAlign: 'center', paddingHorizontal: 4,
  },
  subtitle: {
    color: '#3A2E1A', fontSize: 15.5, lineHeight: 22, fontFamily: 'Inter_500Medium',
    textAlign: 'center', marginTop: 20, paddingHorizontal: 20,
  },
  compareCard: {
    position: 'relative', backgroundColor: 'rgba(89,62,39,0.78)',
    borderRadius: 18, paddingHorizontal: 14, paddingTop: 34, paddingBottom: 16,
    marginTop: 58,
  },
  lockAnchor: {
    position: 'absolute', top: -31, left: 0, right: 0, alignItems: 'center',
  },
  lockImage: { width: 62, height: 62 },
  columns: { flexDirection: 'row', gap: 14 },
  column: { flex: 1, alignItems: 'center' },
  freeBadge: { backgroundColor: CREAM, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 4 },
  freeBadgeText: { color: INK, fontSize: 15, fontFamily: 'Inter_800ExtraBold' },
  plusBadge: { backgroundColor: '#FF742F', borderRadius: 10, paddingHorizontal: 11, paddingVertical: 4 },
  plusBadgeText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter_800ExtraBold' },
  columnCaption: {
    color: '#FFFFFF', fontSize: 12, lineHeight: 17, fontFamily: 'Inter_700Bold',
    textAlign: 'center', marginTop: 8, marginBottom: 10, minHeight: 51,
  },
  itemCard: {
    width: '100%', flex: 1, backgroundColor: CREAM, borderRadius: 16,
    paddingHorizontal: 8, paddingVertical: 12, alignItems: 'center', gap: 6,
  },
  itemImage: { width: '100%', maxWidth: 124, aspectRatio: 1 },
  plusDetail: {
    color: INK, fontSize: 12, lineHeight: 16, fontFamily: 'Inter_700Bold',
    textAlign: 'center',
  },
  promise: {
    color: '#24170D', fontSize: 14.5, lineHeight: 20, fontFamily: 'Inter_800ExtraBold',
    textAlign: 'center', marginTop: 28, paddingHorizontal: 12,
  },
  cta: {
    backgroundColor: BROWN, borderRadius: 17, minHeight: 62,
    alignItems: 'center', justifyContent: 'center', marginTop: 20,
  },
  ctaPressed: { transform: [{ translateY: 2 }], opacity: 0.9 },
  ctaText: { color: '#FFFFFF', fontSize: 19, fontFamily: 'Inter_800ExtraBold' },
});
