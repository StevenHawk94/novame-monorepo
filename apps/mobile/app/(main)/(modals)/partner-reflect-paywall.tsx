import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GridBackground } from '@/components/ui/grid-background';
import { haptics } from '@/lib/haptics';
import {
  clearPartnerReflectPaywallAssignment,
  getPartnerReflectPaywallAssignment,
  recordPartnerReflectPaywallClick,
  type PartnerReflectPaywallAssignment,
} from '@/lib/partner-reflect-paywall';

const BROWN = '#4A2F17';
const SERIF = Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' });

export default function PartnerReflectPaywallModal() {
  const insets = useSafeAreaInsets();
  const [assignment] = useState<PartnerReflectPaywallAssignment | null>(
    getPartnerReflectPaywallAssignment,
  );

  useEffect(() => {
    if (!assignment) router.back();
  }, [assignment]);

  if (!assignment) return null;

  const close = () => {
    void haptics.light();
    clearPartnerReflectPaywallAssignment();
    router.back();
  };

  const openPlans = () => {
    void haptics.pageOpen();
    void recordPartnerReflectPaywallClick(assignment);
    clearPartnerReflectPaywallAssignment();
    router.replace('/(main)/(modals)/subscription-paywall?phase=plans' as never);
  };

  return (
    <View style={styles.screen}>
      <GridBackground />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={close}
        hitSlop={10}
        style={[styles.close, { top: insets.top + 8 }]}
      >
        <MaterialIcons name="close" size={27} color="#FFFFFF" />
      </Pressable>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 92, paddingBottom: Math.max(insets.bottom, 12) + 18 },
        ]}
      >
        <View style={styles.headingBlock}>
          <Text style={styles.title}>{assignment.headline}</Text>
          <Text style={styles.subtitle}>{assignment.subheadline}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardHeading}>{assignment.ctaHeading}</Text>
          <View style={styles.benefits}>
            {assignment.benefits.map((benefit) => (
              <View key={benefit} style={styles.benefitRow}>
                <MaterialIcons name="check-circle" size={24} color="#FF7168" />
                <Text style={styles.benefitText}>{benefit}</Text>
              </View>
            ))}
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={openPlans}
          style={({ pressed }) => [styles.ctaShadow, pressed && styles.ctaPressed]}
        >
          <View style={styles.cta}><Text style={styles.ctaText}>Try for Free</Text></View>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F8E2C1' },
  close: {
    position: 'absolute', left: 18, zIndex: 3,
    width: 50, height: 50, borderRadius: 25, backgroundColor: BROWN,
    alignItems: 'center', justifyContent: 'center',
  },
  content: { flexGrow: 1, paddingHorizontal: 30, justifyContent: 'space-between' },
  headingBlock: { alignItems: 'center', paddingHorizontal: 8 },
  title: {
    color: '#3E220F', fontSize: 34, lineHeight: 42, fontFamily: SERIF,
    fontWeight: '700', textAlign: 'center',
  },
  subtitle: {
    color: '#23170F', fontSize: 17, lineHeight: 24, fontFamily: 'Inter_500Medium',
    textAlign: 'center', marginTop: 22, paddingHorizontal: 8,
  },
  card: {
    backgroundColor: '#FFFDF9', borderWidth: 2, borderColor: '#15110E',
    borderRadius: 26, paddingHorizontal: 25, paddingVertical: 36, marginVertical: 28,
  },
  cardHeading: {
    color: BROWN, fontSize: 20, lineHeight: 27, fontFamily: 'Inter_800ExtraBold',
    textAlign: 'center', marginBottom: 27,
  },
  benefits: { gap: 22 },
  benefitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  benefitText: {
    flex: 1, color: BROWN, fontSize: 16, lineHeight: 22, fontFamily: 'Inter_500Medium',
  },
  ctaShadow: {
    borderRadius: 13, backgroundColor: '#9A6139', paddingBottom: 4,
  },
  ctaPressed: { transform: [{ translateY: 3 }], paddingBottom: 1 },
  cta: {
    minHeight: 64, borderRadius: 13, backgroundColor: BROWN,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18,
  },
  ctaText: { color: '#FFFFFF', fontSize: 18, fontFamily: 'Inter_800ExtraBold' },
});
