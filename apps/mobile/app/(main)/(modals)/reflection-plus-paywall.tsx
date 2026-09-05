import { useEffect } from 'react';
import { Image as ExpoImage } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GridBackground } from '@/components/ui/grid-background';
import { haptics } from '@/lib/haptics';
import { ICONS } from '@/lib/icons';
import {
  recordReflectionPaywallVariantShown,
  type ReflectionPaywallVariant,
} from '@/lib/reflection-paywall-count';

const PARK_ICON = require('../../../assets/items/each/memory.1486_park.webp');

const INK = '#4A2F17';
const BROWN = '#4A3220';
const CREAM = '#FFF7E8';

const V1_BENEFITS = [
  'Better memories organization for every reflection.',
  'Know when to reach out, and when to give them space',
  'Understand whether they need comfort, encouragement, or someone to listen',
  'Take better care of yourself, and create more moments worth remembering and sharing.',
  'More time having real conversations',
  'Never miss the moments when they need you most.',
] as const;

export default function ReflectionPlusPaywallModal() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ variant?: string | string[] }>();
  const requestedVariant = Array.isArray(params.variant) ? params.variant[0] : params.variant;
  const variant: ReflectionPaywallVariant = requestedVariant === '2' ? '2' : '1';

  // Consume the alternating slot only after navigation committed this screen.
  useEffect(() => recordReflectionPaywallVariantShown(variant), [variant]);

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

      {variant === '1' ? (
        <>
          <ScrollView
            style={styles.v1Scroll}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              styles.v1Content,
              { paddingTop: insets.top + 82 },
            ]}
          >
            <ExpoImage
              source={ICONS.Plus}
              style={styles.v1PlusIcon}
              contentFit="contain"
            />
            <Text style={styles.v1Title}>Get Burrow Plus</Text>
            <Text style={styles.v1Subtitle}>
              Plus user get 2x significant improvement in how close they feel to their person.
            </Text>

            <View style={styles.v1BenefitsCard}>
              <View style={styles.v1SectionBadge}>
                <Text style={styles.v1SectionBadgeText}>PLUS FOR BOTH OF YOU</Text>
              </View>
              <View style={styles.v1BenefitsList}>
                {V1_BENEFITS.map((benefit) => (
                  <View key={benefit} style={styles.v1BenefitRow}>
                    <MaterialIcons name="check-circle" size={25} color="#FFFFFF" />
                    <Text style={styles.v1BenefitText}>{benefit}</Text>
                  </View>
                ))}
              </View>
            </View>
          </ScrollView>

          <View style={[styles.v1Footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <Pressable onPress={openPlans} style={({ pressed }) => [styles.cta, styles.v1Cta, pressed && styles.ctaPressed]}>
              <Text style={styles.ctaText}>Try for Free</Text>
            </Pressable>
          </View>
        </>
      ) : (
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
      )}
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
  v1Scroll: { flex: 1 },
  v1Content: { flexGrow: 1, paddingHorizontal: 22, paddingBottom: 20 },
  v1PlusIcon: { width: 56, height: 56, alignSelf: 'center', marginBottom: 8 },
  v1Title: {
    color: INK, fontSize: 31, lineHeight: 39, fontFamily: 'Inter_800ExtraBold',
    textAlign: 'center', paddingHorizontal: 4,
  },
  v1Subtitle: {
    color: '#24170D', fontSize: 16, lineHeight: 23, fontFamily: 'Inter_500Medium',
    textAlign: 'center', marginTop: 22, paddingHorizontal: 18,
  },
  v1BenefitsCard: {
    backgroundColor: 'rgba(89,62,39,0.78)', borderRadius: 18,
    marginTop: 36, paddingHorizontal: 22, paddingTop: 22, paddingBottom: 24,
  },
  v1SectionBadge: {
    minHeight: 48, borderRadius: 14, backgroundColor: '#FFF0D2',
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14,
  },
  v1SectionBadgeText: {
    color: INK, fontSize: 15, fontFamily: 'Inter_800ExtraBold', textAlign: 'center',
  },
  v1BenefitsList: { gap: 24, marginTop: 24 },
  v1BenefitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  v1BenefitText: {
    flex: 1, color: '#FFFFFF', fontSize: 16, lineHeight: 22,
    fontFamily: 'Inter_800ExtraBold',
  },
  v1Footer: { paddingHorizontal: 22, paddingTop: 12 },
  v1Cta: { marginTop: 0 },
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
