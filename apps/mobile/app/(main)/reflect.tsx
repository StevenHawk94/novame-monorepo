import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { haptics } from '../../src/lib/haptics';
import { BACKGROUNDS, ICONS } from '../../src/lib/icons';
import { refreshRemoteItems } from '../../src/lib/remote-items';
import { useSubscriptionTier } from '../../src/lib/use-subscription-tier';
import { OffsetCard } from '../../src/components/ui/offset-card';
import { SwipeDownToDismiss } from '../../src/components/ui/swipe-down-to-dismiss';
import { FeatureGuideModal } from '../../src/components/main/feature-guide-modal';
import { AndroidCompactText as Text } from '@/components/ui/android-compact-typography';
import { TAP_YOUR_DAY_QUESTIONS } from '@novame/engine';
import { warmItemSprites } from '@/components/ui/item-sprite';
import {
  fetchJournalEntryStates,
  getJournalEntryStatesToday,
  getPlusAiRemainingToday,
  type JournalEntryStates,
  type JournalKind,
} from '@/lib/reflect-api';
import { appAlert } from '@/components/ui/app-dialog';

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
  const [entryStates, setEntryStates] = useState<JournalEntryStates>(getJournalEntryStatesToday);
  const [plusAiRemaining, setPlusAiRemaining] = useState(getPlusAiRemainingToday);

  useFocusEffect(useCallback(() => {
    let active = true;
    setEntryStates(getJournalEntryStatesToday());
    setPlusAiRemaining(getPlusAiRemainingToday());
    void fetchJournalEntryStates().then((state) => {
      if (active) {
        setEntryStates(state.entries);
        setPlusAiRemaining(state.plusAiRemaining);
      }
    });
    return () => { active = false; };
  }, []));

  useEffect(() => {
    // Cloud additions are only checked when the user enters an item-consuming
    // feature. Cached rules and art remain available immediately.
    void refreshRemoteItems();
    // The first Tap Your Day question is entirely curated and bounded. Decode
    // its bundled placeholders before the user taps the card so Android never
    // has to reveal a half-painted grid during the route transition.
    void warmItemSprites(
      TAP_YOUR_DAY_QUESTIONS[0]?.groups.flatMap((group) =>
        group.choices.map((choice) => choice.itemId),
      ) ?? [],
    );
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
      journalKind: 'write_freely' as JournalKind,
      title: 'Write Freely',
      text: 'Journal in your own words.',
      icon: ICONS.reflectEntry1,
      route: '/(main)/reflect-typing' as const,
    },
    {
      key: 'prompt',
      journalKind: 'tap_your_day' as JournalKind,
      title: 'Tap Your Day',
      text: 'Tap moments from your day.',
      icon: ICONS.reflectEntry2,
      route: '/(main)/reflect-guided' as const,
    },
    {
      key: 'shared',
      journalKind: 'remember_together' as JournalKind,
      title: 'Remember Together',
      text: 'Keep a moment you’ve shared.',
      icon: ICONS.reflectEntry3,
      route: '/(main)/shared-memory-create' as const,
    },
  ];

  return (
    <SwipeDownToDismiss onDismiss={() => router.back()}>
      <View style={{ flex: 1, backgroundColor: '#FE6F79' }}>
        <ExpoImage source={BACKGROUNDS.reflect} style={StyleSheet.absoluteFill} contentFit="cover" />
        <View style={[styles.root, { paddingTop: insets.top + 10 }]}>
          <Pressable onPress={() => { void haptics.pageClose(); router.back(); }} style={styles.backCircle} hitSlop={10}>
            <MaterialIcons name="arrow-back" size={24} color="#2B2B2B" />
          </Pressable>
          <Text style={styles.lead}>How would you like to journal?</Text>
          <Text style={styles.leadSub}>Pick a way.</Text>
          {ways.map((w) => {
            const status = isPaid && w.journalKind === 'write_freely'
              ? 'available' : entryStates[w.journalKind];
            const unavailable = status !== 'available';
            return (
            <OffsetCard
              key={w.key}
              color={unavailable ? '#B8B1AA' : TAN_OFFSET}
              offset={4}
              radius={30}
              onPress={() => {
                if (unavailable) return;
                if (w.key === 'shared' && !isPaid) {
                  void haptics.pageOpen();
                  router.push('/(main)/(modals)/subscription-paywall?phase=plans' as never);
                  return;
                }
                const openJournal = () => {
                  void haptics.pageOpen();
                  router.push(w.route as never);
                };
                if (isPaid && plusAiRemaining <= 0
                  && (w.journalKind === 'write_freely' || w.journalKind === 'tap_your_day')) {
                  appAlert(
                    "You've hit your Plus limit for today.",
                    'You can still journal, entries will be saved to your log, and you can manually edit your memories anytime.',
                    [{ text: 'Continue', onPress: openJournal }],
                  );
                  return;
                }
                openJournal();
              }}
              disabled={unavailable}
              cardStyle={[styles.wayCard, unavailable && styles.wayCardDisabled]}
              style={{ marginBottom: 18, opacity: unavailable ? 0.72 : 1 }}
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
                {unavailable ? (
                  <Text style={styles.doneText}>{status === 'in_progress' ? 'Finishing today’s Journal…' : 'Done for today'}</Text>
                ) : null}
              </View>
              <ExpoImage source={w.icon} style={styles.wayIcon} contentFit="contain" />
            </OffsetCard>
            );
          })}
        </View>
        <FeatureGuideModal guide="reflect" />
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
  wayCardDisabled: { backgroundColor: '#D8D2CC' },
  wayTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  wayTitle: { fontSize: 22, fontFamily: 'Inter_800ExtraBold', color: '#161311' },
  plusBadge: { backgroundColor: '#4A3220', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 3 },
  plusBadgeText: { color: '#FFFFFF', fontSize: 12, fontFamily: 'Inter_800ExtraBold' },
  wayText: { fontSize: 14.5, fontFamily: 'Inter_500Medium', color: '#3E3229', marginTop: 4 },
  doneText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#765F50', marginTop: 7 },
  wayIcon: { width: 56, height: 56 },
});
