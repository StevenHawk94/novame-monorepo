/**
 * Wisdom insight modal — Stage 6 redesign
 *
 * Re-view of a previously published wisdom's full insight payload.
 * Renders the same InsightView used by the record flow, but without
 * the post-publish side effects (no confetti, no character-state
 * cache clear, no skin-unlock placeholder). Just close on back.
 *
 * Payload contract (URL-encoded JSON via `payload` route param):
 *   {
 *     card: InsightCardData | null,
 *     emotion: string,
 *   }
 *
 * Stage 6 semantic decisions:
 *   - cardCollection is ALWAYS null here. The "New Card Type Unlocked"
 *     banner only makes sense in the moment of publishing — replaying
 *     it for historical wisdoms would mislead the user about what was
 *     "just unlocked." InsightView hides Section 1 when null.
 *   - aspireImpact is ALWAYS null here. The current aspire_scores at
 *     publish time aren't replayable, so showing today's bar with
 *     yesterday's delta would be lying.
 *   - communityCount is generated fresh in this modal via useMemo so
 *     it stays stable across re-renders but doesn't need to be
 *     serialized in the URL (URLs already get long with the card JSON).
 */
import { useMemo } from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { InsightView, type InsightCardData } from '@/components/insight/insight-view';
import { haptics } from '@/lib/haptics';

type Payload = {
  card: InsightCardData | null;
  emotion: string;
};

function decodePayload(raw: string | undefined): Payload | null {
  if (!raw) return null;
  try {
    return JSON.parse(decodeURIComponent(raw)) as Payload;
  } catch {
    return null;
  }
}

export default function WisdomInsightModal() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ payload?: string }>();
  const payload = decodePayload(params.payload);

  // Generate a stable community-count for the lifetime of this modal.
  // useMemo with [] deps means the number is computed once on mount
  // and survives every re-render (so the "1,203 people" line doesn't
  // re-randomize when the user scrolls or the keyboard appears).
  const communityCount = useMemo(
    () => 50 + Math.floor(Math.random() * 1951),
    [],
  );

  const goBack = () => {
    void haptics.light();
    if (router.canGoBack()) router.back();
    else router.replace('/(main)/(tabs)/growth');
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      {/* Header: just a back button on the left; the inner WISDOM INSIGHT
          title acts as the page title to avoid duplication. */}
      <View style={styles.header}>
        <Pressable
          onPress={goBack}
          hitSlop={12}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
        >
          <MaterialIcons name="arrow-back" size={22} color="#FFFFFF" />
        </Pressable>
      </View>

      {payload ? (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
          showsVerticalScrollIndicator={false}
        >
          <InsightView
            card={payload.card}
            emotion={payload.emotion}
            cardCollection={null}
            aspireImpact={null}
            communityCount={communityCount}
          />
        </ScrollView>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Could not load this insight.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#1A0F3D',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  headerSpacer: {
    width: 36,
    height: 36,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  scroll: {
    paddingTop: 0,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
  },
});
