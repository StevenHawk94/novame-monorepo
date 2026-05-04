import { useEffect } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { ImgPage, PrimaryButton } from '@/components/onboarding/shared';
import {
  diffCacheAgainstManifest,
  downloadAssets,
  fetchManifestFromR2,
  setCachedManifest,
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
  const router = useRouter();

  useEffect(() => {
    // Fire-and-forget: fetch manifest + download outfit-1 (foreground)
    // then queue everything else (background).
    (async () => {
      try {
        const manifest = await fetchManifestFromR2();
        setCachedManifest(manifest);

        // Build foreground list: outfit-1 videos only (3 files, ~9 MB).
        const outfit1 = manifest.videos
          .filter((v) => v.outfit === 1)
          .map((v) => v.filename);
        const foregroundMissing = outfit1.filter((filename) => {
          const entry = manifest.videos.find((v) => v.filename === filename);
          if (!entry) return false;
          return diffCacheAgainstManifest(
            { ...manifest, videos: [entry], cards: [] },
          ).length > 0;
        });

        if (foregroundMissing.length > 0) {
          await downloadAssets(manifest.baseUrl, foregroundMissing);
        }

        // Background fill: everything else (outfit-2..6 + 52 cards).
        const remaining = diffCacheAgainstManifest(manifest);
        if (remaining.length > 0) {
          // Intentionally not awaited.
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
        <PrimaryButton onPress={() => router.push('/(onboarding)/step-2')}>
          Unlock My Potential
        </PrimaryButton>
      }
    >
      <View style={styles.center}>
        <Text style={styles.brand}>NovaMe</Text>
        <Text style={styles.tagline}>Journal. Reflect. Evolve.</Text>
        <Text style={styles.subtagline}>
          Unlock personal growth through reflective wisdom.
        </Text>
      </View>
    </ImgPage>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
  },
  brand: {
    color: '#FFFFFF',
    fontSize: 32,
    fontFamily: 'Inter_700Bold',
    marginBottom: 12,
  },
  tagline: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 18,
    fontFamily: 'Inter_500Medium',
    marginBottom: 8,
  },
  subtagline: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
});
