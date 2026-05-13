import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Image,
  ListRenderItem,
  NativeScrollEvent,
  NativeSyntheticEvent,
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

// Static require() map for review avatars. React Native's require()
// can only take a string literal, not a variable, so this map is the
// idiomatic way to resolve dynamic filenames to bundled image assets.
// Keys must match the avatarFile field in REVIEWS exactly.
const REVIEW_AVATARS: Record<string, number> = {
  'ob-9-user1.webp': require('@/../assets/images/onboarding/ob-9-user1.webp'),
  'ob-9-user2.webp': require('@/../assets/images/onboarding/ob-9-user2.webp'),
  'ob-9-user3.webp': require('@/../assets/images/onboarding/ob-9-user3.webp'),
};

/**
 * Step 9 — User reviews carousel.
 *
 * Stage 3.5 → Stage 3.5.bugfix (2025-11-XX):
 *   - Replaces single-card rendering with FlatList horizontal +
 *     pagingEnabled, so users can swipe between reviews.
 *   - Auto-rotation pauses on user drag (onScrollBeginDrag) and
 *     resumes 1.5s after the user releases (onMomentumScrollEnd).
 *     Pattern matches Instagram Stories / Apple Music carousels.
 *   - Dot indicators remain interactive (scrollToIndex on tap).
 *
 * Note: the previous 4-second auto-advance is preserved.
 */

const ROTATE_MS = 4000;
const RESUME_DELAY_MS = 1500;

type Review = (typeof REVIEWS)[number];

export default function OnboardingStep9() {
  const router = useRouter();
  const [idx, setIdx] = useState(0);
  const listRef = useRef<FlatList<Review>>(null);
  const autoTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isUserInteracting = useRef(false);

  const screenWidth = Dimensions.get('window').width;
  // ItemWidth = screen width minus the body horizontal padding (24*2)
  const itemWidth = screenWidth - 48;

  // ---- Auto-rotation control ----

  const startAutoRotate = useCallback(() => {
    if (autoTimer.current) return;
    autoTimer.current = setInterval(() => {
      if (isUserInteracting.current) return;
      setIdx((i) => {
        const next = (i + 1) % REVIEWS.length;
        listRef.current?.scrollToIndex({ index: next, animated: true });
        return next;
      });
    }, ROTATE_MS);
  }, []);

  const stopAutoRotate = useCallback(() => {
    if (autoTimer.current) {
      clearInterval(autoTimer.current);
      autoTimer.current = null;
    }
  }, []);

  useEffect(() => {
    startAutoRotate();
    return () => {
      stopAutoRotate();
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    };
  }, [startAutoRotate, stopAutoRotate]);

  // ---- Scroll handlers ----

  const handleScrollBeginDrag = () => {
    isUserInteracting.current = true;
    stopAutoRotate();
    if (resumeTimer.current) {
      clearTimeout(resumeTimer.current);
      resumeTimer.current = null;
    }
  };

  const handleMomentumScrollEnd = (
    e: NativeSyntheticEvent<NativeScrollEvent>,
  ) => {
    const offsetX = e.nativeEvent.contentOffset.x;
    const newIdx = Math.round(offsetX / itemWidth);
    setIdx(Math.max(0, Math.min(REVIEWS.length - 1, newIdx)));

    // Schedule auto-rotate resume after a short delay
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => {
      isUserInteracting.current = false;
      startAutoRotate();
    }, RESUME_DELAY_MS);
  };

  const handleDotPress = (i: number) => {
    setIdx(i);
    listRef.current?.scrollToIndex({ index: i, animated: true });
    // Treat dot tap as a brief interaction, then resume
    isUserInteracting.current = true;
    stopAutoRotate();
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => {
      isUserInteracting.current = false;
      startAutoRotate();
    }, RESUME_DELAY_MS);
  };

  // ---- Render ----

  const renderItem: ListRenderItem<Review> = ({ item }) => (
    <View style={[styles.card, { width: itemWidth }]}>
      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map((i) => (
          <Text key={i} style={styles.star}>
            {'★'}
          </Text>
        ))}
      </View>
      <HighlightedText text={item.text} />
      <View style={styles.author}>
        <Image
          source={REVIEW_AVATARS[item.avatarFile]}
          style={styles.avatar}
        />
        <Text style={styles.authorName}>
          {'— '}
          {item.name}
        </Text>
      </View>
    </View>
  );

  return (
    <Shell step={9} onBack={() => router.back()}>
      <View style={styles.body}>
        <Text style={styles.headline}>
          Don&apos;t just take our word for it.
        </Text>
        <Text style={styles.subheadline}>
          See how others are turning their everyday moments into lasting wisdom.
        </Text>

        <View style={styles.carouselWrap}>
          <FlatList
            ref={listRef}
            data={REVIEWS}
            renderItem={renderItem}
            keyExtractor={(item) => item.name}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScrollBeginDrag={handleScrollBeginDrag}
            onMomentumScrollEnd={handleMomentumScrollEnd}
            getItemLayout={(_, i) => ({
              length: itemWidth,
              offset: itemWidth * i,
              index: i,
            })}
            decelerationRate="fast"
            snapToInterval={itemWidth}
            snapToAlignment="start"
          />
        </View>

        <View style={styles.dots}>
          {REVIEWS.map((_, i) => (
            <Pressable
              key={i}
              onPress={() => handleDotPress(i)}
              hitSlop={10}
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
  carouselWrap: {
    marginBottom: 16,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    padding: 20,
    minHeight: 260,
    justifyContent: 'center',
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
    width: 20, // Active dot wider for clearer state
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
});