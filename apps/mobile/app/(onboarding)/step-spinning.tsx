import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Image as ExpoImage } from 'expo-image';

import { CardSpinAnimation } from '@/components/cards/CardSpinAnimation';

/**
 * Spinning transition between step 7 and step 8.
 *
 * Stage 3.5 → Stage 3.5.bugfix (2025-11-XX): wraps CardSpinAnimation
 * in a dark navy backdrop matching the rest of the onboarding flow
 * (#0A0820, same as Shell / ImgPage). Without this wrapper, the
 * transparent CardSpinAnimation root let the system default light
 * background show through during the Stack push transition, causing
 * the spinning card to disappear into a near-white bg on iOS.
 *
 * CardSpinAnimation itself is left transparent on purpose so other
 * callers (record.tsx publishing/analyzing phases) can compose it
 * over their own backgrounds.
 *
 * Stage 6.OnboardingPrefetch (2026-05-XX): added a hidden-image
 * warm-up pipeline identical to the wisdom-publish flow's
 * InsightPrefetch. The two step-8 card art files (front + back) are
 * mounted as 1x1 invisible <ExpoImage> components inside this view
 * and their onLoad callbacks gate the navigation to step-8.
 *
 * Why this is needed even though onboarding/index.tsx already
 * pre-downloads STEP_8_CARDS to asset-cache during phase 1: that
 * download targets asset-cache (file:// in documentDir/cache/),
 * while FlippableCard in step-8 reads from expo-image's separate
 * disk + memory cache via R2 URIs. The two caches do not share
 * storage, so a fresh user reaching step-spinning would otherwise
 * see expo-image start its FIRST R2 fetch right when step-8 mounts
 * — exactly the placeholder-flash you described.
 *
 * Gate logic:
 *   - 3000ms animation timer (unchanged) sets animationDone=true.
 *   - Each hidden <Image> onLoad/onError increments imagesLoadedRef
 *     and may set imagesReady=true.
 *   - When BOTH conditions are true, router.replace to step-8.
 *   - 15s safety timeout flips imagesReady=true unconditionally so
 *     a broken R2 / network outage cannot deadlock onboarding;
 *     users in that case land on step-8 with whatever expo-image
 *     can render (placeholder until network recovers).
 *
 * Lifecycle: 'timed' mode keeps the existing 3s minimum hold. The
 * wait can extend up to 15s if expo-image is still loading, but
 * users see the loop animation continue (Lottie loop=true) the
 * whole time, so the wait is visually indistinguishable from the
 * normal 3s hold.
 */
const R2_BASE = 'https://media.novameapp.com';
const STEP_8_FRONT_URI = `${R2_BASE}/action-initiative-front.webp`;
const STEP_8_BACK_URI = `${R2_BASE}/action-back.webp`;

// FlippableCard render dimensions per card-dimensions.ts. Hidden
// <Image>s must use these so the GPU texture is decoded at the
// correct size — a 1x1 decode would force re-decode on step-8.
const CARD_W = 285;
const CARD_H = 428; // 285 / (1024/1536)

const ANIMATION_DURATION_MS = 3000;
const SAFETY_TIMEOUT_MS = 15000;

export default function OnboardingStepSpinning() {
  const router = useRouter();
  const [animationDone, setAnimationDone] = useState(false);
  const [imagesReady, setImagesReady] = useState(false);
  const imagesLoadedRef = useRef(0);
  const navigatedRef = useRef(false);

  // Increment counter on each hidden <Image>'s onLoad/onError. We
  // count errors as "done" so a 404 / network failure for ONE image
  // cannot indefinitely block navigation; the safety timeout below
  // is the hard ceiling for the case where BOTH fail to fire.
  const handleImageLoaded = () => {
    imagesLoadedRef.current += 1;
    if (imagesLoadedRef.current >= 2) {
      setImagesReady(true);
    }
  };

  // 15-second safety: even if onLoad never fires (R2 outage, etc),
  // we still let the user proceed. expo-image will keep retrying
  // and the placeholder will be replaced when it eventually resolves.
  useEffect(() => {
    const t = setTimeout(() => {
      setImagesReady(true);
    }, SAFETY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, []);

  // Navigate when BOTH gates are open. navigatedRef guards against
  // double-fire if both effects observe ready transitions in the
  // same tick.
  useEffect(() => {
    if (animationDone && imagesReady && !navigatedRef.current) {
      navigatedRef.current = true;
      router.replace('/(onboarding)/step-8');
    }
  }, [animationDone, imagesReady, router]);

  return (
    <View style={styles.root}>
      <CardSpinAnimation
        label1="Crafting your first Wisdom Card..."
        sublabel="Just a moment"
        duration={ANIMATION_DURATION_MS}
        onDone={() => setAnimationDone(true)}
      />

      {/* Hidden warm-up Images. Off-screen (top:-10000) so they
          don't affect layout but still mount and load. memory-disk
          cachePolicy keeps the decoded image resident so step-8's
          FlippableCard render is GPU-instant. Dimensions match the
          render size in step-8 so the decoded texture is reusable. */}
      <View style={styles.hiddenLoader} pointerEvents="none">
        <ExpoImage
          source={{ uri: STEP_8_FRONT_URI }}
          style={{ width: CARD_W, height: CARD_H }}
          contentFit="cover"
          cachePolicy="memory-disk"
          onLoad={handleImageLoaded}
          onError={handleImageLoaded}
        />
        <ExpoImage
          source={{ uri: STEP_8_BACK_URI }}
          style={{ width: CARD_W, height: CARD_H }}
          contentFit="cover"
          cachePolicy="memory-disk"
          onLoad={handleImageLoaded}
          onError={handleImageLoaded}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  hiddenLoader: {
    position: 'absolute',
    top: -10000,
    left: -10000,
    opacity: 0,
  },
});
