import { useEffect, useMemo } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { haptics } from '@/lib/haptics';
import { ImgPage, PrimaryButton } from '@/components/onboarding/shared';
import { useResponsive, useTextStyle } from '@/hooks/use-responsive';
import {
  diffCacheAgainstManifest,
  downloadAssets,
  fetchManifestFromR2,
  setCachedManifest,
  STEP_8_CARDS,
} from '@/lib/asset-cache';

/**
 * Step 1 — Welcome.
 *
 * Visual: full-bleed ob-1.webp + NovaMe wordmark + "Journal. Reflect.
 * Evolve." + "Unlock My Potential" button.
 *
 * Side effect: triggers the R2 manifest fetch + foreground download
 * of outfit-1 videos and background download of all other videos +
 * cards (B38 strategy from stage 3.3 plan). Fire-and-forget — the
 * user can advance to step 2 immediately while downloads continue
 * in the background.
 *
 * If manifest fetch fails (offline / R2 outage), we silently fall
 * back to whatever is already cached locally. Onboarding still
 * proceeds; step-8 etc. will use the asset-cache fallback path
 * (placeholder image when card art is not yet downloaded).
 */
export default function OnboardingStep1() {
  const { scale } = useResponsive();
  const t = useTextStyle();
  const styles = useMemo(() => makeStyles(scale, t), [scale, t]);
  const signInLinkStyles = useMemo(() => makeSignInLinkStyles(scale, t), [scale, t]);
  const router = useRouter();

  useEffect(() => {
    // Fire-and-forget: fetch manifest + download outfit-1 (foreground)
    // then queue everything else (background).
    (async () => {
      try {
        const manifest = await fetchManifestFromR2();
        setCachedManifest(manifest);

        // ---- Phase 1 (awaited): outfit-1 videos + step-8 cards ----
        // These are the assets the user MUST see during onboarding.
        // Block until they're cached so step 8 never renders an empty
        // placeholder card. Total payload ~9 MB (videos) + 2x ~50 KB
        // (cards) = ~9.1 MB — finishes well before the user reaches
        // step 8 even on a slow connection.
        const outfit1Names = manifest.videos
          .filter((v) => v.outfit === 1)
          .map((v) => v.filename);
        const step8CardNames = STEP_8_CARDS.filter((filename) =>
          manifest.cards.some((c) => c.filename === filename),
        );
        const phase1Targets = [...outfit1Names, ...step8CardNames];

        // Only download those that are actually missing or stale.
        const phase1Missing = phase1Targets.filter((filename) => {
          const videoEntry = manifest.videos.find(
            (v) => v.filename === filename,
          );
          const cardEntry = manifest.cards.find(
            (c) => c.filename === filename,
          );
          const entry = videoEntry ?? cardEntry;
          if (!entry) return false;
          return (
            diffCacheAgainstManifest({
              ...manifest,
              videos: videoEntry ? [videoEntry] : [],
              cards: cardEntry ? [cardEntry] : [],
            }).length > 0
          );
        });

        if (phase1Missing.length > 0) {
          await downloadAssets(manifest.baseUrl, phase1Missing);
        }

        // ---- Phase 2 (fire-and-forget): everything else ----
        // outfit-2..6 videos + the other 50 cards. Not awaited so user
        // can advance through onboarding immediately. By the time they
        // reach the main tabs these will (mostly) be cached.
        const remaining = diffCacheAgainstManifest(manifest);
        if (remaining.length > 0) {
          void downloadAssets(manifest.baseUrl, remaining);
        }
      } catch {
        // Network / R2 errors are non-fatal during onboarding —
        // downloads will retry on next launch via the same flow.
      }
    })();
  }, []);

  return (
    <ImgPage
      imgSource={require('@/../assets/images/onboarding/ob-1.webp')}
      btn={
        <View>
          <PrimaryButton onPress={() => router.push('/(onboarding)/step-2')}>
            Unlock My Potential
          </PrimaryButton>
          {/* Stage 6.OnboardingSignInShortcut: returning users skip
              the 11-step onboarding entirely and go straight to
              sign-in. router.replace (not push) so the back-gesture
              can't yank them back into onboarding — once they've
              chosen this path, the onboarding flow is no longer
              their context. Mirrors the step-11 -> /(auth)/sign-in
              transition pattern. */}
          <Pressable
            onPress={() => {
              void haptics.light();
              router.replace('/(auth)/sign-in');
            }}
            style={({ pressed }) => [
              signInLinkStyles.tap,
              pressed && signInLinkStyles.tapPressed,
            ]}
            hitSlop={8}
          >
            <Text style={signInLinkStyles.label}>
              I already have an account
            </Text>
          </Pressable>
        </View>
      }
    >
      <View style={styles.center}>
        <Text style={styles.brand}>NovaMe</Text>
        <Text style={styles.tagline}>Journal. Reflect. Evolve.</Text>
        <Text style={styles.subtagline}>
          Unlock personal growth through your own lived experience.
        </Text>
      </View>
    </ImgPage>
  );
}

function makeStyles(
  scale: (n: number) => number,
  t: ReturnType<typeof useTextStyle>,
) {
  return StyleSheet.create({
  center: {
    alignItems: 'center',
  },
  brand: {
    color: '#FFFFFF',
    ...t.title1,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginBottom: scale(12),
  },
  tagline: {
    color: 'rgba(255,255,255,0.6)',
    ...t.headline,
    fontWeight: '500',
    fontFamily: 'Inter_500Medium',
    textAlign: 'center',
    marginBottom: scale(8),
  },
  subtagline: {
    color: 'rgba(255,255,255,0.4)',
    ...t.footnote,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
  });
}

// Stage 6.OnboardingSignInShortcut: secondary CTA styling.
//
// Visual rules (industry standard for "skip / sign in" links beneath
// a primary CTA — Duolingo, Headspace, Calm all use this pattern):
//   - Smaller font (14 vs 18 on the primary button)
//   - Lower-contrast color (0.6 alpha white) so it reads as a
//     secondary option, not competing with "Unlock My Potential".
//   - Centered, with a generous tap area via paddingVertical so
//     it meets Apple's 44pt minimum HIG target.
//   - Subtle pressed state (opacity dip) rather than full color
//     change — this is an alternative path, not the prominent one.
function makeSignInLinkStyles(
  scale: (n: number) => number,
  t: ReturnType<typeof useTextStyle>,
) {
  return StyleSheet.create({
  tap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: scale(14),
    marginTop: scale(4),
  },
  tapPressed: {
    opacity: 0.5,
  },
  label: {
    color: 'rgba(255,255,255,0.6)',
    ...t.footnote,
    fontWeight: '500',
    fontFamily: 'Inter_500Medium',
  },
  });
}
