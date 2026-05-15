/**
 * PagerTabBar -- shared sub-tab switcher for Growth + Assets tabs.
 *
 * Stage 6 visual refresh (per design comp):
 *   - White active text, dimmed inactive text.
 *   - Purple short underline under the active tab.
 *   - Light grey full-width baseline behind/under the underline.
 *   - Two tabs share screen width 50/50 (centered text).
 *   - Underline slides between tabs in lockstep with the parent
 *     swipe surface's scroll progress.
 *
 * Driving the slide animation:
 *   The parent (Growth / Assets) uses react-native-reanimated-carousel.
 *   Carousel's `onProgressChange` accepts a SharedValue<number>
 *   directly (v4.x API). The shared value receives absoluteProgress
 *   in [0, data.length-1] -- for a 2-tab carousel that's [0, 1],
 *   matching the interpolate domain we use here.
 *
 *   PagerView (the first attempt) was abandoned: react-native-pager-view
 *   v8.0.1 has a React 19 peer-deps mismatch that crashes the native
 *   bridge at app launch. reanimated-carousel is pure JS + worklet,
 *   no native module bridge, and is already used elsewhere in the app
 *   (keyword-detail.tsx) -- so we know the version + RN stack are
 *   compatible.
 */
import React from 'react';
import {
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  SharedValue,
  useAnimatedStyle,
  interpolate,
} from 'react-native-reanimated';

import { haptics } from '@/lib/haptics';

export type PagerTabBarProps = {
  tabs: readonly [string, string];
  /**
   * SharedValue in [0, tabs.length - 1] representing scroll position
   * including in-progress drag offset. Owned by the parent (which
   * also owns PagerView).
   */
  scrollProgress: SharedValue<number>;
  /** Tap handler -- parent uses ref.setPage(index). */
  onTabPress: (index: 0 | 1) => void;
  /**
   * Active index for text color tinting. Tap or page settle commits
   * a new active index in the parent. Used for label color only;
   * underline position is driven by scrollProgress.
   */
  activeIndex: 0 | 1;
};

export function PagerTabBar({
  tabs,
  scrollProgress,
  onTabPress,
  activeIndex,
}: PagerTabBarProps) {
  // Measured tab width in pt. Two tabs share 50/50 of the row, so
  // tabWidth = rowWidth / 2 once layout is done. Until then it's 0
  // and the underline is invisible (width: 0) -- single-frame
  // pre-layout state, unnoticeable.
  const [rowWidth, setRowWidth] = React.useState(0);
  const tabWidth = rowWidth / 2;

  // Short underline (about 40% of a tab's width) centered on the
  // active tab. As PagerView scrolls, slides between the two tab
  // centers.
  const UNDERLINE_WIDTH_RATIO = 0.4;
  const underlineWidth = tabWidth * UNDERLINE_WIDTH_RATIO;

  const onLayout = (e: LayoutChangeEvent) => {
    setRowWidth(e.nativeEvent.layout.width);
  };

  const underlineStyle = useAnimatedStyle(() => {
    // tab i center x = tabWidth * (i + 0.5). Underline left edge sits
    // at center - underlineWidth/2.
    const centerX = interpolate(
      scrollProgress.value,
      [0, 1],
      [tabWidth * 0.5, tabWidth * 1.5],
    );
    return {
      width: underlineWidth,
      transform: [{ translateX: centerX - underlineWidth / 2 }],
    };
  });

  const handlePress = (index: 0 | 1) => {
    void haptics.light();
    onTabPress(index);
  };

  return (
    <View style={styles.container}>
      <View style={styles.row} onLayout={onLayout}>
        {tabs.map((label, i) => {
          const isActive = activeIndex === i;
          return (
            <Pressable
              key={label}
              style={styles.tab}
              onPress={() => handlePress(i as 0 | 1)}
              hitSlop={8}
            >
              <Text
                style={[
                  styles.tabText,
                  isActive ? styles.tabTextActive : null,
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {/* Baseline: pale full-width line that the active underline
          sits on top of. Stage 6 design comp shows both. */}
      <View style={styles.baseline} />
      {/* Active underline: short purple bar, slides between tabs. */}
      {tabWidth > 0 ? (
        <Animated.View style={[styles.underline, underlineStyle]} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabText: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  tabTextActive: {
    color: '#FFFFFF',
  },
  baseline: {
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 1,
  },
  underline: {
    position: 'absolute',
    bottom: 0,
    height: 3,
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
  },
});
