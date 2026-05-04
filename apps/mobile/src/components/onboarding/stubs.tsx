import { useEffect } from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  View,
} from 'react-native';

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

const flippableStyles = StyleSheet.create({
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
    padding: 16,
    backgroundColor: 'rgba(15, 11, 46, 0.85)',
  },
  quote: {
    color: '#FFFFFF',
    fontSize: 13,
    lineHeight: 18,
    fontFamily: 'Inter_500Medium',
    fontStyle: 'italic',
  },
});

// ---- CardSpinStub ----

type CardSpinStubProps = {
  label1: string;
  sublabel: string;
  duration: number;
  onDone: () => void;
};

/**
 * Spinning placeholder shown for `duration` ms then calls onDone.
 *
 * Stage 3.8 will replace the ActivityIndicator with a real 3D
 * spinning card animation. The duration + onDone contract is
 * preserved so step-spinning.tsx will not need changes.
 */
export function CardSpinStub({
  label1,
  sublabel,
  duration,
  onDone,
}: CardSpinStubProps) {
  useEffect(() => {
    const t = setTimeout(onDone, duration);
    return () => clearTimeout(t);
  }, [duration, onDone]);
  return (
    <View style={spinStyles.root}>
      <ActivityIndicator size="large" color="#C084FC" />
      <Text style={spinStyles.label1}>{label1}</Text>
      <Text style={spinStyles.sublabel}>{sublabel}</Text>
    </View>
  );
}

const spinStyles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0F0B2E',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  label1: {
    color: '#FFFFFF',
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginTop: 32,
  },
  sublabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    marginTop: 8,
  },
});

// ---- ConfettiStub ----

/**
 * No-op confetti placeholder. Stage 3.8 will add real confetti
 * particles using react-native-reanimated. Until then, the moment
 * of celebration is conveyed by the screen text only.
 */
export function ConfettiStub() {
  return null;
}
