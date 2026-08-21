import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { haptics } from '../../src/lib/haptics';
import { BACKGROUNDS, ICONS } from '../../src/lib/icons';
import { refreshRemoteItems } from '../../src/lib/remote-items';
import { useSubscriptionTier } from '../../src/lib/use-subscription-tier';
import { OffsetCard } from '../../src/components/ui/offset-card';
import { SwipeDownToDismiss } from '../../src/components/ui/swipe-down-to-dismiss';

const TAN_OFFSET = '#E5B57E';

/**
 * Reflect entry (2026-07-24 design, mock 1:1): "How would you like to
 * reflect?" over the sunset art, three ways in:
 *   Write Freely    → 流程1 typing (9-prompt second level + live match bar)
 *   Guided Prompts  → 流程2 my-days guided taps
 *   Shared Memories → write a memory whose items land in the pair's Ours box
 *
 * New Lens still deep-links with a preset line — that's a typing reflect, so
 * the params forward straight to reflect-typing (this screen never shows).
 */
export default function ReflectEntryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isPaid = useSubscriptionTier() !== 'free';
  const params = useLocalSearchParams<{
    presetPrompt?: string;
    sourceKit?: string;
  }>();
  const hasPreset = typeof params.presetPrompt === 'string' && params.presetPrompt.length > 0;

  useEffect(() => {
    // Cloud additions are only checked when the user enters an item-consuming
    // feature. Cached rules and art remain available immediately.
    void refreshRemoteItems();
  }, []);

  useEffect(() => {
    if (hasPreset) {
      router.replace({ pathname: '/(main)/reflect-typing', params });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPreset]);

  if (hasPreset) return <View style={{ flex: 1, backgroundColor: '#000' }} />;

  const ways = [
    {
      key: 'typing',
      title: 'Write Freely',
      text: 'Write down whatever is on your mind.',
      icon: ICONS.reflectEntry1,
      route: '/(main)/reflect-typing' as const,
    },
    {
      key: 'prompt',
      title: 'Guided Prompts',
      text: 'Find inspiration with curated questions.',
      icon: ICONS.reflectEntry2,
      route: '/(main)/reflect-guided' as const,
    },
    {
      key: 'shared',
      title: 'Shared Memories',
      text: 'Moments we shared together.',
      icon: ICONS.reflectEntry3,
      route: '/(main)/shared-memory-create' as const,
    },
  ];

  return (
    <SwipeDownToDismiss onDismiss={() => router.back()}>
      <View style={{ flex: 1, backgroundColor: '#5A2E2A' }}>
        <ExpoImage source={BACKGROUNDS.reflect} style={StyleSheet.absoluteFill} contentFit="cover" />
        <View style={[styles.root, { paddingTop: insets.top + 10 }]}>
          <Pressable onPress={() => { void haptics.pageClose(); router.back(); }} style={styles.backCircle} hitSlop={10}>
            <MaterialIcons name="arrow-back" size={24} color="#2B2B2B" />
          </Pressable>
          <Text style={styles.lead}>How would you like to reflect?</Text>
          <Text style={styles.leadSub}>Pick a way.</Text>
          {ways.map((w) => (
            <OffsetCard
              key={w.key}
              color={TAN_OFFSET}
              offset={4}
              radius={30}
              onPress={() => {
                void haptics.pageOpen();
                if (w.key === 'shared' && !isPaid) {
                  router.push('/(main)/(modals)/subscription-paywall?phase=plans' as never);
                  return;
                }
                router.push(w.route as never);
              }}
              cardStyle={styles.wayCard}
              style={{ marginBottom: 18 }}
            >
              <View style={{ flex: 1 }}>
                <View style={styles.wayTitleRow}>
                  <Text style={styles.wayTitle}>{w.title}</Text>
                  {w.key === 'shared' ? (
                    <View style={styles.plusBadge}>
                      <Text style={styles.plusBadgeText}>Plus</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.wayText}>{w.text}</Text>
              </View>
              <ExpoImage source={w.icon} style={styles.wayIcon} contentFit="contain" />
            </OffsetCard>
          ))}
        </View>
      </View>
    </SwipeDownToDismiss>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 18 },
  backCircle: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  lead: { fontSize: 28, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
  leadSub: { fontSize: 16, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.95)', marginTop: 4, marginBottom: 20 },
  wayCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFFFFF', padding: 20 },
  wayTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  wayTitle: { fontSize: 22, fontFamily: 'Inter_800ExtraBold', color: '#161311' },
  plusBadge: { backgroundColor: '#4A3220', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 3 },
  plusBadgeText: { color: '#FFFFFF', fontSize: 12, fontFamily: 'Inter_800ExtraBold' },
  wayText: { fontSize: 14.5, fontFamily: 'Inter_500Medium', color: '#3E3229', marginTop: 4 },
  wayIcon: { width: 56, height: 56 },
});
