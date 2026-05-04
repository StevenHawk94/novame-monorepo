import { useEffect, useRef, useState } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import {
  HighlightedText,
  PrimaryButton,
  Shell,
} from '@/components/onboarding/shared';
import { REVIEWS } from '@/components/onboarding/constants';

/**
 * Step 9 — User reviews carousel.
 *
 * Auto-advances every 4 seconds. Tapping a dot indicator jumps to
 * that review.
 *
 * Avatars: REVIEWS[i].avatarFile (e.g. ob-9-user1.webp). These
 * files are NOT yet committed in apps/mobile/assets/images/onboarding/
 * (user will add them after stage 3.5). Until then, Image source
 * resolution will fail silently and the avatar slot shows a circle
 * placeholder.
 *
 * Stage 3.5 simplification: no swipe-to-pan gesture (old Capacitor
 * had touch handlers). Users navigate via dot indicators or wait
 * for auto-advance. Stage 3.8 may add gesture-handler swipe.
 */

const ROTATE_MS = 4000;

export default function OnboardingStep9() {
  const router = useRouter();
  const [idx, setIdx] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timer.current = setInterval(() => {
      setIdx((i) => (i + 1) % REVIEWS.length);
    }, ROTATE_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  const review = REVIEWS[idx];

  return (
    <Shell step={9} onBack={() => router.back()}>
      <View style={styles.body}>
        <Text style={styles.headline}>Don&apos;t just take our word for it.</Text>
        <Text style={styles.subheadline}>
          See how others are turning their everyday moments into lasting wisdom.
        </Text>
        <View style={styles.card}>
          <View style={styles.stars}>
            {[1, 2, 3, 4, 5].map((i) => (
              <Text key={i} style={styles.star}>
                {'★'}
              </Text>
            ))}
          </View>
          <HighlightedText text={review.text} />
          <View style={styles.author}>
            <View style={styles.avatar} />
            <Text style={styles.authorName}>{'— '}{review.name}</Text>
          </View>
        </View>
        <View style={styles.dots}>
          {REVIEWS.map((_, i) => (
            <Pressable
              key={i}
              onPress={() => setIdx(i)}
              style={[styles.dot, i === idx && styles.dotActive]}
            />
          ))}
        </View>
      </View>
      <View style={styles.footer}>
        <PrimaryButton onPress={() => router.push('/(onboarding)/step-10')}>
          Continue
        </PrimaryButton>
      </View>
    </Shell>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  headline: {
    color: '#FFFFFF',
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  subheadline: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    marginBottom: 24,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    padding: 20,
    minHeight: 220,
    marginBottom: 16,
  },
  stars: {
    flexDirection: 'row',
    gap: 2,
    marginBottom: 12,
  },
  star: {
    color: '#FBBF24',
    fontSize: 16,
  },
  author: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 16,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  authorName: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  dotActive: {
    backgroundColor: '#A855F7',
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
});
