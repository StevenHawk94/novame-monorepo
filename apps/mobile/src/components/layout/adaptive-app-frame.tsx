import { type ReactNode, useMemo } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

/**
 * Phase-one large-screen compatibility frame.
 *
 * Burrow is still a phone-first, portrait experience. Android 16 can ignore a
 * portrait request on large displays, however, so an unfolded foldable or a
 * wide freeform window must not stretch the phone composition across the whole
 * display. Keep the complete app inside a centered portrait canvas until the
 * individual destinations receive purpose-built two-pane layouts.
 *
 * Compact portrait phones remain exactly full width. On a large display (the
 * Android medium-width breakpoint) or a clearly landscape/wide window, the
 * canvas is capped at 520dp. Its height also informs the cap so short, wide
 * displays get a naturally phone-shaped canvas instead of a squat one.
 */
export const LARGE_SCREEN_BREAKPOINT = 600;
export const APP_FRAME_MIN_WIDTH = 390;
export const APP_FRAME_MAX_WIDTH = 520;
export const APP_FRAME_PORTRAIT_RATIO = 9 / 16;

export type AdaptiveFrameMetrics = {
  constrained: boolean;
  width: number;
};

export function getAdaptiveFrameMetrics(
  windowWidth: number,
  windowHeight: number,
): AdaptiveFrameMetrics {
  const safeWidth = Math.max(0, windowWidth);
  const safeHeight = Math.max(0, windowHeight);
  const isLargeScreen = safeWidth >= LARGE_SCREEN_BREAKPOINT;
  const isClearlyWide = safeHeight > 0 && safeWidth / safeHeight >= 1.1;
  const constrained = isLargeScreen || isClearlyWide;

  if (!constrained) return { constrained: false, width: safeWidth };

  const heightBasedWidth = Math.max(
    APP_FRAME_MIN_WIDTH,
    Math.round(safeHeight * APP_FRAME_PORTRAIT_RATIO),
  );
  return {
    constrained: true,
    width: Math.min(safeWidth, APP_FRAME_MAX_WIDTH, heightBasedWidth),
  };
}

export function AdaptiveAppFrame({ children }: { children: ReactNode }) {
  const { width, height } = useWindowDimensions();
  const frame = useMemo(
    () => getAdaptiveFrameMetrics(width, height),
    [width, height],
  );

  return (
    <View style={styles.outside}>
      <View
        testID="adaptive-app-frame"
        style={[
          styles.canvas,
          frame.constrained ? { width: frame.width } : styles.compactCanvas,
        ]}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outside: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#E7DEC5',
  },
  canvas: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: '#4C331B',
  },
  compactCanvas: {
    width: '100%',
  },
});
