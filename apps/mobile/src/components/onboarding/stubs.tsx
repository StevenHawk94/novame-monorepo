import { useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useResponsive, useTextStyle } from '@/hooks/use-responsive';

/**
 * Stage 3.5 stub components for FlippableCard, CardSpinAnimation, Confetti.
 *
 * Stage 3.8 will replace these with real implementations using
 * react-native-reanimated (3D flip / 3D spin / confetti particles).
 *
 * Until 3.8, onboarding step 8 + step-spinning use these visual
 * stand-ins so the flow is functionally complete and the user
 * journey works end to end.
 */

// ---- FlippableCardStub ----

type FlippableCardStubProps = {
  /** Filename to look up in asset-cache (e.g. "action-initiative-front.webp"). */
  frontUri?: string | null;
  /** Quote shown on the static card face. */
  quoteShort: string;
  /** Card width in pixels. */
  width: number;
};

/**
 * Static card preview — no flip animation. Shows the front image if
 * cached locally, otherwise a purple gradient placeholder with the
 * quote text. Stage 3.8 will replace with reanimated 3D flip.
 */
export function FlippableCardStub({
  frontUri,
  quoteShort,
  width,
}: FlippableCardStubProps) {
  const { scale } = useResponsive();
  const t = useTextStyle();
  const flippableStyles = useMemo(() => makeFlippableStyles(scale, t), [scale, t]);
  const height = width * 1.5;
  return (
    <View
      style={[
        flippableStyles.card,
        { width, height, borderRadius: width * 0.08 },
      ]}
    >
      {frontUri ? (
        <Image
          source={{ uri: frontUri }}
          style={[flippableStyles.image, { borderRadius: width * 0.08 }]}
          resizeMode="cover"
        />
      ) : (
        <View
          style={[
            flippableStyles.placeholderBg,
            { borderRadius: width * 0.08 },
          ]}
        >
          <Text style={flippableStyles.placeholderStar}>{'✨'}</Text>
        </View>
      )}
      <View style={flippableStyles.overlay}>
        <Text style={flippableStyles.quote} numberOfLines={4}>
          {quoteShort}
        </Text>
      </View>
    </View>
  );
}

function makeFlippableStyles(
  scale: (n: number) => number,
  t: ReturnType<typeof useTextStyle>,
) {
  return StyleSheet.create({
  card: {
    backgroundColor: '#1A1430',
    overflow: 'hidden',
    shadowColor: '#A855F7',
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  image: {
    width: '100%',
    height: '100%',
    position: 'absolute',
  },
  placeholderBg: {
    width: '100%',
    height: '100%',
    backgroundColor: '#7C3AED',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderStar: {
    fontSize: 64,
  },
  overlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: scale(16),
    backgroundColor: 'rgba(15, 11, 46, 0.85)',
  },
  quote: {
    color: '#FFFFFF',
    ...t.footnote,
    fontFamily: 'Inter_500Medium',
    fontStyle: 'italic',
  },
  });
}

// ---- CardSpinStub ----

type CardSpinStubProps = {
  /** Headline shown above the spinner. */
  label1: string;
  /** Optional middle line (used by record publishing phase). */
  label2?: string;
  /** Smaller text below the headline. */
  sublabel: string;
  /**
   * Spin lifecycle mode.
   *   - 'timed' (default): spin for `duration` ms then call `onDone`.
   *     Used by onboarding step-spinning.tsx.
   *   - 'continuous': spin forever; the parent will unmount this when
   *     a network/state transition is ready. Used by record.tsx
   *     publishing/analyzing phases. `duration` and `onDone` are
   *     ignored.
   */
  mode?: 'timed' | 'continuous';
  /** Required only for mode='timed'. */
  duration?: number;
  /** Required only for mode='timed'. */
  onDone?: () => void;
};

/**
 * Spinning placeholder. Two lifecycle modes (see CardSpinStubProps).
 *
 * Stage 3.8 will replace ActivityIndicator with a real 3D card spin
 * animation. The mode + props contract is preserved so callers do
 * not need to change.
 */
export function CardSpinStub({
  label1,
  label2,
  sublabel,
  mode = 'timed',
  duration,
  onDone,
}: CardSpinStubProps) {
  const { scale } = useResponsive();
  const t = useTextStyle();
  const spinStyles = useMemo(() => makeSpinStyles(scale, t), [scale, t]);
  useEffect(() => {
    if (mode !== 'timed') return;
    if (typeof duration !== 'number' || !onDone) return;
    const t = setTimeout(onDone, duration);
    return () => clearTimeout(t);
  }, [mode, duration, onDone]);
  return (
    <View style={spinStyles.root}>
      <ActivityIndicator size="large" color="#C084FC" />
      <Text style={spinStyles.label1}>{label1}</Text>
      {label2 ? <Text style={spinStyles.label2}>{label2}</Text> : null}
      <Text style={spinStyles.sublabel}>{sublabel}</Text>
    </View>
  );
}

function makeSpinStyles(
  scale: (n: number) => number,
  t: ReturnType<typeof useTextStyle>,
) {
  return StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0F0B2E',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: scale(24),
  },
  label1: {
    color: '#FFFFFF',
    ...t.headline,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginTop: scale(32),
  },
  label2: {
    color: 'rgba(255,255,255,0.7)',
    ...t.footnote,
    fontFamily: 'Inter_500Medium',
    textAlign: 'center',
    marginTop: scale(6),
  },
  sublabel: {
    color: 'rgba(255,255,255,0.4)',
    ...t.footnote,
    fontFamily: 'Inter_400Regular',
    marginTop: scale(8),
  },
  });
}

// ---- ConfettiStub ----

/**
 * No-op confetti placeholder. Stage 3.8 will add real confetti
 * particles using react-native-reanimated. Until then, the moment
 * of celebration is conveyed by the screen text only.
 */
export function ConfettiStub() {
  return null;
}
