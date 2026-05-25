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

  // Stage 6 Bug 3 fix: communityCount comes from the server-persisted
  // wisdom_cards.community_count column instead of being random-generated
  // here. Historical wisdoms (pre-migration 20260525123624) have NULL;
  // InsightView Block 4a hides in that case rather than fabricating a
  // number that doesn't match what the user saw on first view.
  const communityCount = payload?.card?.community_count ?? null;

  const goBack = () => {
    void haptics.light();
    if (router.canGoBack()) router.back();
    else router.replace('/(main)/(tabs)/growth');
  };

  return (
    <View style={styles.root}>
      {payload ? (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* InsightView's Block 1+2 ImageBackground extends all the way
              to the screen top (root has no paddingTop). topExtraPadding
              gives the in-content text room to clear the status bar
              while the purple glow still bleeds into the safe area —
              matches the design comp and PhaseInsight's behavior in
              record.tsx. */}
          <InsightView
            card={payload.card}
            emotion={payload.emotion}
            cardCollection={null}
            aspireImpact={null}
            communityCount={communityCount}
            topExtraPadding={Math.max(0, insets.top - 4)}
          />
        </ScrollView>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Could not load this insight.</Text>
        </View>
      )}
      {/* Floating back button on top of the purple ImageBackground.
          Position is anchored to the safe-area top so on every device
          it sits just below the status bar. zIndex above ScrollView
          so it stays tappable while content scrolls underneath. */}
      <Pressable
        onPress={goBack}
        hitSlop={12}
        style={({ pressed }) => [
          styles.backFloating,
          { top: insets.top + 8 },
          pressed && { opacity: 0.7 },
        ]}
      >
        <MaterialIcons name="arrow-back" size={22} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    // Stage 6 Wisdom Insight redesign: white root matches the in-page
    // section colors (white body for reframe + dark Ask card + purple
    // Missions card). The back button switches to a dark glyph against
    // this white background.
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backBtn: {
    // DEPRECATED — kept temporarily; no JSX references this any more
    // since back button moved to backFloating below. Safe to delete in
    // a follow-up cleanup once we're sure no other surface imports it.
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(31,17,71,0.06)',
  },
  // Stage 6.WisdomFix-S4: floating back button overlays the
  // ImageBackground (which now extends into the safe area). White
  // glyph + semi-opaque white-tint circle for contrast against the
  // purple glow. `top` is supplied inline from insets.top + 8 at
  // render time, so iPhone SE / Pro Max both get correct placement.
  backFloating: {
    position: 'absolute',
    left: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
    zIndex: 10,
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
