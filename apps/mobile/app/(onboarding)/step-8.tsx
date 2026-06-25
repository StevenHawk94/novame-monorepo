import { useMemo, useState } from 'react';
import {
  Dimensions,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import {
  PrimaryButton,
  Shell,
} from '@/components/onboarding/shared';
import { Confetti } from '@/components/cards/Confetti';
import { FlippableCard } from '@/components/cards/FlippableCard';
import { INITIATIVE_CARD } from '@/components/onboarding/constants';
import { getCachedAssetUri } from '@/lib/asset-cache';
import { getStandardCardWidth } from '@/lib/card-dimensions';
import { useResponsive, useTextStyle } from '@/hooks/use-responsive';

/**
 * Step 8 — "Look at that. Your initiative... holds a lesson!"
 *
 * Shows the action-initiative card (the user's first wisdom card).
 *
 * Asset resolution order:
 *   1. asset-cache (R2 download triggered in step 1) — preferred,
 *      uses local file:// URI for fast load.
 *   2. null fallback — FlippableCardStub renders a purple gradient
 *      with a sparkle, no Image at all. The quote text still shows.
 *
 * Stage 3.8 will replace FlippableCardStub with a real flipping
 * card using reanimated 3D rotateY transforms.
 *
 * ConfettiStub is currently a no-op (returns null). Stage 3.8
 * will add a real confetti burst.
 */
export default function OnboardingStep8() {
  const { scale } = useResponsive();
  const t = useTextStyle();
  const styles = useMemo(() => makeStyles(scale, t), [scale, t]);
  const router = useRouter();
  const [showConfetti] = useState(true);

  const screenWidth = Dimensions.get('window').width;
  const cardWidth = getStandardCardWidth(screenWidth);

  // Note: FlippableCard handles cache lookup internally now.
  // const frontFilename = 'action-initiative-front.webp';
  // const backFilename = 'action-back.webp';

  return (
    <Shell step={8} hideProgress>
      {showConfetti ? <Confetti /> : null}
      <View style={styles.body}>
        <Text style={styles.headline}>
          See how that works?
        </Text>
        <Text style={styles.subheadline}>
          Even the smallest thing you share holds something worth keeping.
        </Text>
        <View style={styles.cardContainer}>
          <FlippableCard
            frontFilename="action-initiative-front.webp"
            backFilename="action-back.webp"
            quoteShort={INITIATIVE_CARD.quoteShort}
            insightFull={INITIATIVE_CARD.insightFull ?? ''}
            width={cardWidth}
          />
        </View>
        <Text style={styles.flipHint}>Tap to flip</Text>
      </View>
      <View style={styles.footer}>
        <PrimaryButton onPress={() => router.push('/(onboarding)/step-9')}>
          Continue
        </PrimaryButton>
      </View>
    </Shell>
  );
}

function makeStyles(
  scale: (n: number) => number,
  t: ReturnType<typeof useTextStyle>,
) {
  return StyleSheet.create({
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: scale(24),
  },
  headline: {
    color: '#FFFFFF',
    ...t.headline,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginBottom: scale(4),
  },
  subheadline: {
    color: 'rgba(255,255,255,0.4)',
    ...t.caption,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    marginBottom: scale(20),
  },
  cardContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  flipHint: {
    color: '#A855F7',
    ...t.caption2,
    fontFamily: 'Inter_400Regular',
    marginTop: scale(12),
  },
  footer: {
    paddingHorizontal: scale(24),
    paddingBottom: scale(24),
  },
  });
}
