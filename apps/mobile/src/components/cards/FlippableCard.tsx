/**
 * FlippableCard — Stage 3.8.2 real implementation
 *
 * 3D Y-axis flip card with adaptive font sizing for both faces.
 *
 * Visual model (1:1 with old Capacitor FlippableCard.js):
 *   - Aspect ratio 600:951 (≈ 0.6667), portrait
 *   - Standard widths: 240px (small screen), 270px (default)
 *   - Front: keyword card image with quote_short on bottom parchment area
 *   - Back: category-back image with insight_full filling 84% center
 *   - Tap to flip (rotateY 0deg <-> 180deg, 600ms)
 *   - Purple glow shadow around card
 *
 * Asset paths (R2 cached via getCachedAssetUri):
 *   - Front: {keyword_id}-front.webp  (e.g. "mind-clarity-front.webp")
 *   - Back:  {category}-back.webp     (e.g. "mind-back.webp")
 *
 * Adaptive font algorithm (ported from old web):
 *   - Front quote: shorter text -> larger font (5.8% to 3.4% of card width)
 *   - Back insight: tries 14px down to 5px, picks largest size that fits
 *     within 78% width x 82% height with 1.5 line-height + 12% safety margin
 */
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Image } from 'expo-image';

import { getCachedAssetUri } from '@/lib/asset-cache';

const AR = 1024 / 1536; // 2:3 ratio matches R2 keyword card images

export type FlippableCardProps = {
  /** Filename to look up in asset-cache, e.g. "mind-clarity-front.webp". null falls back to gradient placeholder. */
  frontFilename?: string | null;
  /** Filename of category back, e.g. "mind-back.webp". null falls back to gradient placeholder. */
  backFilename?: string | null;
  /** Short quote shown on front parchment area. */
  quoteShort: string;
  /** Long insight shown filling back face. */
  insightFull: string;
  /** Card width in pixels. Height auto-derived from AR. */
  width: number;
  /** Optional callback when flip state changes. */
  onFlip?: (flipped: boolean) => void;
};

/**
 * Maps front quote character count to a font size factor.
 * Shorter text -> larger font (more impact).
 */
function frontFontSize(width: number, text: string): number {
  const len = text.length;
  let factor: number;
  // Tuned for R2 card art parchment area (~270px wide).
  // Bigger than old web because RN parchment region is tighter
  // and Inter italic-bold reads narrower than serif fonts.
  if (len <= 20) factor = 0.080;
  else if (len <= 35) factor = 0.068;
  else if (len <= 50) factor = 0.058;
  else factor = 0.048;
  return Math.max(13, Math.round(width * factor));
}

/**
 * Picks the largest font size (from a descending list) that fits insight_full
 * inside the back card's available space. Mirrors backFontSize from old web.
 */
function backFontSize(width: number, text: string, cardHeight: number): number {
  if (!text) return 13;
  // Tighter availH to leave 3-4 lines of breathing room at bottom.
  // 0.67 ensures the last text line is well above the bottom card border.
  const availH = cardHeight * 0.67;
  const availW = width * 0.78;
  const lineH = 1.5;
  const safetyMargin = 1.12;
  const scale = width / 270;
  // Min size raised to 9 — anything smaller is unreadable on real device.
  const baseSizes = [14, 13, 12, 11, 10, 9];

  for (const base of baseSizes) {
    const size = Math.round(base * scale * 10) / 10;
    if (size < 9) continue;
    const charWidthRatio =
      size >= 11 ? 0.54 : size >= 9 ? 0.56 : 0.58;
    const charsPerLine = Math.floor(availW / (size * charWidthRatio));
    if (charsPerLine <= 0) continue;
    const paragraphs = text.split('\n');
    let totalLines = 0;
    for (const para of paragraphs) {
      if (para.trim() === '') {
        totalLines += 0.5;
        continue;
      }
      totalLines += Math.ceil(para.length / charsPerLine);
    }
    const textHeight = totalLines * size * lineH * safetyMargin;
    if (textHeight <= availH) return size;
  }
  return Math.max(9, Math.round(9 * scale));
}

export function FlippableCard({
  frontFilename,
  backFilename,
  quoteShort,
  insightFull,
  width,
  onFlip,
}: FlippableCardProps) {
  const height = Math.round(width / AR);

  // Resolve cached URIs (null fallback shows gradient placeholder).
  const frontUri = frontFilename ? getCachedAssetUri(frontFilename) : null;
  const backUri = backFilename ? getCachedAssetUri(backFilename) : null;

  // Single shared value driving the flip. 0 = front, 180 = back.
  const rotation = useSharedValue(0);

  // Animated styles for both faces.
  // Front face: rotates from 0deg -> 180deg as rotation goes 0 -> 180.
  // Back face: rotates from 180deg -> 360deg (always 180deg ahead) so it shows
  //            up-right when card is flipped.
  // backfaceVisibility: 'hidden' lets each face hide itself when its
  //            rotation crosses 90deg. iOS supports this natively; Android
  //            behavior is OK in RN 0.81.
  const frontAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 1200 },
      { rotateY: `${rotation.value}deg` },
    ],
    opacity: interpolate(rotation.value, [0, 89.9, 90, 180], [1, 1, 0, 0]),
  }));

  const backAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 1200 },
      { rotateY: `${rotation.value + 180}deg` },
    ],
    opacity: interpolate(rotation.value, [0, 89.9, 90, 180], [0, 0, 1, 1]),
  }));

  const handlePress = () => {
    const isFlipped = rotation.value >= 90;
    const target = isFlipped ? 0 : 180;
    rotation.value = withTiming(target, {
      duration: 600,
      easing: Easing.inOut(Easing.ease),
    });
    onFlip?.(!isFlipped);
  };

  const qSize = frontFontSize(width, quoteShort || '');
  const iSize = backFontSize(width, insightFull || '', height);

  return (
    <View style={[styles.outerWrap, { width, height }]}>
      {/* Glow layer behind card */}
      <View
        style={[
          styles.glow,
          { width: width + 6, height: height + 6, borderRadius: 11 },
        ]}
      />

      <Pressable onPress={handlePress} style={styles.pressableWrap}>
        {/* FRONT face */}
        <Animated.View
          style={[
            styles.face,
            { width, height, borderRadius: 8 },
            frontAnimatedStyle,
          ]}
        >
          {frontUri ? (
            <Image
              source={{ uri: frontUri }}
              style={styles.faceImage}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.placeholderBg, styles.frontPlaceholder]}>
              <Text style={styles.placeholderStar}>{'✨'}</Text>
            </View>
          )}
          <View style={styles.frontTextArea}>
            <Text
              style={[styles.frontQuote, { fontSize: qSize }]}
              numberOfLines={4}
            >
              {quoteShort || ''}
            </Text>
          </View>
        </Animated.View>

        {/* BACK face */}
        <Animated.View
          style={[
            styles.face,
            styles.backFace,
            { width, height, borderRadius: 8 },
            backAnimatedStyle,
          ]}
        >
          {backUri ? (
            <Image
              source={{ uri: backUri }}
              style={styles.faceImage}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.placeholderBg, styles.backPlaceholder]} />
          )}
          <View style={styles.backTextArea}>
            <Text style={[styles.backInsight, { fontSize: iSize }]}>
              {insightFull || ''}
            </Text>
          </View>
        </Animated.View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  outerWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    backgroundColor: 'transparent',
    shadowColor: '#A855F7',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  pressableWrap: {
    width: '100%',
    height: '100%',
  },
  face: {
    position: 'absolute',
    top: 0,
    left: 0,
    overflow: 'hidden',
    backfaceVisibility: 'hidden',
    backgroundColor: '#1a1020',
  },
  backFace: {
    backgroundColor: '#0a2010',
  },
  faceImage: {
    width: '100%',
    height: '100%',
    position: 'absolute',
  },
  placeholderBg: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  frontPlaceholder: {
    backgroundColor: '#7C3AED',
  },
  backPlaceholder: {
    backgroundColor: '#0a2010',
  },
  placeholderStar: {
    fontSize: 64,
  },
  frontTextArea: {
    position: 'absolute',
    top: '78%',
    bottom: '5%',
    left: '10%',
    right: '10%',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  frontQuote: {
    color: '#1a1a1a',
    fontWeight: '700',
    fontStyle: 'italic',
    textAlign: 'center',
    lineHeight: 18,
  },
  backTextArea: {
    position: 'absolute',
    top: '12%',
    bottom: '20%',
    left: '12%',
    right: '12%',
    overflow: 'hidden',
  },
  backInsight: {
    color: '#1a1a1a',
    fontWeight: '500',
    lineHeight: 22,
  },
});
