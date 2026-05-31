/**
 * FlippableCard — Stage 6 (boxShadow glow + improved typography)
 *
 * 3D Y-axis flip card with adaptive font sizing for both faces.
 *
 * Visual model:
 *   - Aspect ratio 600:951 (≈ 0.6667), portrait
 *   - Width comes from getStandardCardWidth() (single formula across app)
 *   - Tap to flip (rotateY 0deg <-> 180deg, 600ms)
 *   - Domain-colored multi-layer boxShadow halo (Mind=blue, Heart=pink,
 *     Action=yellow, Connection=green), rotates with the card.
 *
 * Typography:
 *   - Front quote: dynamic size from text length (13-22px range)
 *     positioned with frontTextArea top:76% (lifted 2pt from prior 78%)
 *   - Back insight: dynamic algorithm picks the LARGEST size that both
 *     fits AND fills at least 85% of the available height (≤15%
 *     whitespace target). If a size fits with >15% slack, we try a
 *     larger one. Range 11-18px.
 *
 * disabled prop:
 *   - When the parent (e.g. a Carousel) is mid-swipe, set disabled=true
 *     so the tap-to-flip Pressable becomes a no-op. This prevents the
 *     "swipe and flip happen simultaneously" bug.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Image } from 'expo-image';

// Stage 6.InsightPrefetch: getCachedAssetUri import removed — see
// the R2_BASE comment in the component body for the rationale.
// (asset-cache is still imported in other components for video assets.)

const AR = 1024 / 1536;

const DOMAIN_GLOW: Record<string, string> = {
  mind: '#3B82F6',
  heart: '#EC4899',
  action: '#FACC15',
  connection: '#22C55E',
};
const DEFAULT_GLOW = '#A855F7';

function getDomainGlow(
  frontFilename?: string | null,
  backFilename?: string | null,
): string {
  const source = frontFilename ?? backFilename ?? '';
  const firstSegment = source.split('-')[0];
  return DOMAIN_GLOW[firstSegment] ?? DEFAULT_GLOW;
}

function buildGlowBoxShadow(color: string): string {
  return [
    `0px 0px 4px 1px ${color}CC`,
    `0px 0px 10px 2px ${color}80`,
    `0px 0px 18px 4px ${color}33`,
  ].join(', ');
}

export type FlippableCardProps = {
  frontFilename?: string | null;
  backFilename?: string | null;
  quoteShort: string;
  insightFull: string;
  width: number;
  onFlip?: (flipped: boolean) => void;
  defaultSide?: 'front' | 'back';
  /**
   * When true, tap-to-flip is disabled. Used by parent Carousel during
   * a swipe so a finger that ends up dragging doesn't also trigger flip.
   */
  disabled?: boolean;
};

/**
 * Front quote: shorter text → larger font.
 * Range 13px (long, ≥51 chars) to 22px (short, ≤20 chars).
 */
function frontFontSize(width: number, text: string): number {
  const len = text.length;
  let factor: number;
  if (len <= 20) factor = 0.084;       // bumped up slightly for impact
  else if (len <= 35) factor = 0.072;
  else if (len <= 50) factor = 0.060;
  else factor = 0.050;
  return Math.max(13, Math.round(width * factor));
}

/**
 * Back insight typography: pick the largest size that completely fits.
 *
 * Returns BOTH font size AND lineHeightRatio (line-height multiplier),
 * so callers can compress vertical spacing when text would otherwise
 * overflow.
 *
 * Priority order:
 *   1. Find the largest font size from [18..11] where, with default
 *      lineHeightRatio 1.5, the full text fits within availH. Use it.
 *      Short content gets large fonts; long content drops to smaller
 *      ones — same as before.
 *   2. If even size=11 with lineHeightRatio 1.5 overflows, keep
 *      size=11 and shrink lineHeightRatio down through 1.4, 1.3, 1.2
 *      to reclaim vertical space. Stop at the first ratio that fits.
 *   3. If 11px + lineHeightRatio 1.2 still doesn't fit (backend
 *      character limits should prevent this), return that as the
 *      final fallback — readability beats clipping.
 *
 * Range 11-18px. lineHeightRatio range 1.2-1.5.
 */
function backFontSize(
  width: number,
  text: string,
  cardHeight: number,
): { size: number; lineHeightRatio: number } {
  if (!text) return { size: 14, lineHeightRatio: 1.5 };
  // Real backTextArea inset: top 12% + bottom 10% → 78% of card height.
  // Real backTextArea inset: left 12% + right 12% → 76% of card width.
  // Slightly conservative compared to the full parchment artwork so
  // text has a small breathing buffer from the decorative gold border.
  const availH = cardHeight * 0.78;
  const availW = width * 0.76;
  // No safety buffer — availH/availW already represent the TRUE usable
  // region. Previous 1.08 buffer caused under-estimation of fit and
  // forced the algorithm to drop to smaller font + tighter line-height
  // even when content actually fit at a larger size.
  const safetyMargin = 1.04;
  const scale = width / 270;
  const baseSizes = [18, 17.5, 17, 16.5, 16, 15.5, 15, 14.5, 14, 13.5, 13, 12.5, 12, 11.5, 11];

  function totalLinesFor(size: number): number {
    // Inter is a narrow sans-serif. Empirical avg glyph width ratio:
    //   - At sizes ≥14:  ~0.48 (regular weight)
    //   - At sizes 12-13: ~0.50
    //   - At sizes ≤11:   ~0.52 (smaller sizes hint to slightly wider)
    // These are tuned conservatively — slight over-estimate of glyph
    // width is safer than under-estimate (which causes content overflow).
    const charWidthRatio =
      size >= 14 ? 0.47 : size >= 12 ? 0.48 : 0.50;
    const charsPerLine = Math.floor((availW / (size * charWidthRatio)) * 0.88);
    if (charsPerLine <= 0) return Infinity;
    const paragraphs = text.split('\n');
    let totalLines = 0;
    for (const para of paragraphs) {
      if (para.trim() === '') {
        totalLines += 0.5;
        continue;
      }
      totalLines += Math.ceil(para.length / charsPerLine);
    }
    return totalLines;
  }

  // Priority 1: largest font that fits at the real effective line-height (1.4).
  for (const base of baseSizes) {
    const size = Math.round(base * scale * 10) / 10;
    if (size < 11) continue;
    const lines = totalLinesFor(size);
    const textHeight = lines * size * 1.4 * safetyMargin;
    if (textHeight <= availH) {
      return { size, lineHeightRatio: 1.4 };
    }
  }

  // Priority 2: smallest font (11) with progressively tighter line-height.
  // Reached only when even 11px @ lh 1.5 overflows.
  const minSize = Math.max(11, Math.round(11 * scale));
  const lines = totalLinesFor(minSize);
  for (const ratio of [1.4, 1.3, 1.2]) {
    const textHeight = lines * minSize * ratio * safetyMargin;
    if (textHeight <= availH) {
      return { size: minSize, lineHeightRatio: ratio };
    }
  }

  // Priority 3: tightest readable. Backend char limits should prevent
  // ever reaching here.
  return { size: minSize, lineHeightRatio: 1.2 };
}

export function FlippableCard({
  frontFilename,
  backFilename,
  quoteShort,
  insightFull,
  width,
  onFlip,
  defaultSide = 'front',
  disabled = false,
}: FlippableCardProps) {
  const height = Math.round(width / AR);

  // Stage 6.InsightPrefetch: switched from asset-cache file:// URIs to
  // direct R2 URLs. Two reasons:
  //
  //   1. expo-image's prefetch() and <Image source> share a single
  //      cache, keyed by URL string. The PhasePublishing pipeline
  //      prefetches these exact R2 URLs and waits for their onLoad
  //      before navigating to insight; the renderer here must use
  //      the SAME URL strings so the cache lookup hits.
  //   2. expo-image manages its own disk cache, so we get the same
  //      offline-after-first-load behavior asset-cache provided,
  //      without maintaining two separate caches for the same files.
  //
  // asset-cache is still active in the project for videos and for
  // onboarding's step-8 pre-warm; we just don't use it for the
  // insight-screen card art anymore.
  const R2_BASE = 'https://media.novameapp.com';
  const frontUri = frontFilename ? `${R2_BASE}/${frontFilename}` : null;
  const backUri = backFilename ? `${R2_BASE}/${backFilename}` : null;

  const rotation = useSharedValue(defaultSide === 'back' ? 180 : 0);

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
    if (disabled) return; // mid-swipe, ignore tap
    const isFlipped = rotation.value >= 90;
    const target = isFlipped ? 0 : 180;
    rotation.value = withTiming(target, {
      duration: 600,
      easing: Easing.inOut(Easing.ease),
    });
    onFlip?.(!isFlipped);
  };

  const qSize = frontFontSize(width, quoteShort || '');
  const iTypo = backFontSize(width, insightFull || '', height);
  const glowColor = getDomainGlow(frontFilename, backFilename);
  const glow = buildGlowBoxShadow(glowColor);

  return (
    <View style={[styles.outerWrap, { width, height }]}>
      <Pressable onPress={handlePress} style={styles.pressableWrap}>
        <Animated.View
          style={[
            styles.face,
            {
              width,
              height,
              borderRadius: 8,
              boxShadow: glow,
            },
            frontAnimatedStyle,
          ]}
        >
          <View style={[styles.faceInner, { borderRadius: 8 }]}>
            {frontUri ? (
              <Image
                source={{ uri: frontUri }}
                style={styles.faceImage}
                contentFit="cover"
                cachePolicy="memory-disk"
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
                allowFontScaling={false}
              >
                {quoteShort || ''}
              </Text>
            </View>
          </View>
        </Animated.View>

        <Animated.View
          style={[
            styles.face,
            styles.backFace,
            {
              width,
              height,
              borderRadius: 8,
              boxShadow: glow,
            },
            backAnimatedStyle,
          ]}
        >
          <View style={[styles.faceInner, { borderRadius: 8 }]}>
            {backUri ? (
              <Image
                source={{ uri: backUri }}
                style={styles.faceImage}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
            ) : (
              <View style={[styles.placeholderBg, styles.backPlaceholder]} />
            )}
            <View style={styles.backTextArea}>
              <Text
                style={[
                  styles.backInsight,
                  {
                    fontSize: iTypo.size,
                    lineHeight: iTypo.size * iTypo.lineHeightRatio,
                  },
                ]}
                allowFontScaling={false}
              >
                {insightFull || ''}
              </Text>
            </View>
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
  pressableWrap: {
    width: '100%',
    height: '100%',
  },
  face: {
    position: 'absolute',
    top: 0,
    left: 0,
    backfaceVisibility: 'hidden',
    backgroundColor: '#1a1020',
  },
  backFace: {
    backgroundColor: '#0a2010',
  },
  faceInner: {
    width: '100%',
    height: '100%',
    overflow: 'hidden',
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
    top: '76%',          // ← lifted 2pt from 78%
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
    lineHeight: 20,
  },
  backTextArea: {
    position: 'absolute',
    top: '12%',
    bottom: '10%',
    left: '12%',
    right: '12%',
    overflow: 'hidden',
  },
  backInsight: {
    color: '#1a1a1a',
    fontWeight: '500',
    // lineHeight is set inline based on backFontSize() output so it
    // can compress (1.2-1.5×) to fit long insights.
  },
});