import { useMemo } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { haptics } from '@/lib/haptics';
import { ImgPage, PrimaryButton } from '@/components/onboarding/shared';
import { useResponsive, useTextStyle } from '@/hooks/use-responsive';

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
  // iPhone SE / small-height devices: the full-bleed ImgPage image
  // (aspectRatio 7/6) eats ~321pt on a 375-wide screen, leaving little
  // vertical room, so the primary button was overlapping the tagline.
  // On short screens shrink the title + tighten spacing; taller screens
  // are unchanged (the responsive system's SE baseline is 1:1 there).
  const { height } = useWindowDimensions();
  const isShort = height < 700;
  const styles = useMemo(() => makeStyles(scale, t, isShort), [scale, t, isShort]);
  const signInLinkStyles = useMemo(() => makeSignInLinkStyles(scale, t), [scale, t]);
  const router = useRouter();

  return (
    <ImgPage
      imgSource={require('@/../assets/images/onboarding/ob-1.webp')}
      btn={
        <View>
          <PrimaryButton onPress={() => router.push('/(onboarding)/step-2')}>
            Start Finding Mine
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
        <Image
          source={require('@/../assets/images/onboarding/ob-1-logo.webp')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.tagline}>
          Your raw days hold <Text style={styles.taglineAccent}>real wisdom</Text>.
        </Text>
        <Text style={styles.subtagline}>
          You already have what you need to grow.{'\n'}NovaMe helps you find it.
        </Text>
      </View>
    </ImgPage>
  );
}

function makeStyles(
  scale: (n: number) => number,
  t: ReturnType<typeof useTextStyle>,
  isShort: boolean,
) {
  return StyleSheet.create({
  center: {
    alignItems: 'center',
  },
  logo: {
    width: scale(isShort ? 160 : 200),
    height: scale(isShort ? 44 : 56),
    marginBottom: scale(isShort ? 8 : 16),
  },
  tagline: {
    color: '#FFFFFF',
    ...t.title1,
    // Short screens: shrink the title below the title1 token so the
    // full-bleed image + title + subtitle + button all fit without the
    // button overlapping. lineHeight is reduced proportionally.
    ...(isShort
      ? (() => {
          const shrunk = Math.round((t.title1.fontSize ?? 28) * 0.8);
          return { fontSize: shrunk, lineHeight: Math.round(shrunk * 1.15) };
        })()
      : null),
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginBottom: scale(isShort ? 8 : 16),
  },
  taglineAccent: {
    color: '#FACC15',
  },
  subtagline: {
    color: 'rgba(255,255,255,0.6)',
    ...t.subheadline,
    ...(isShort ? { fontSize: Math.round((t.subheadline.fontSize ?? 15) * 0.92) } : null),
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: scale(isShort ? 18 : 22),
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
