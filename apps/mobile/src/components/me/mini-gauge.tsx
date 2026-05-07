import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

/**
 * Half-circle gauge for the "Better Self Match" entry on the Me page
 * (Stage 3.10.1) -- also reused by stage 3.10.3 character-data overlay.
 *
 * Score domain: 30 - 100 (matches old web MeView mini-gauge math, where
 * scores below 30 still pin the bar to empty). The default mid-tier
 * score returned by the server is 70 (see /api/me-stats and
 * profiles.better_self_score column default).
 *
 * Color thresholds:
 *   80+   green  (High Match)
 *   60-79 yellow (Medium Match)
 *   <60   red    (Low Match)
 *
 * Implementation note: react-native-svg ships with Expo SDK 54 (already
 * a transitive dependency at v15.12.1). We use SVG rather than nested
 * Views with rotated borders because the latter requires hacky
 * transform-origin + masking and breaks under reanimated layout pass.
 */

const ARC_PATH = 'M 20 90 A 80 80 0 0 1 180 90';
// Stroke length of the arc above (computed once: pi * 80 ~= 251).
const ARC_LENGTH = 251;

function getColor(score: number): string {
  if (score >= 80) return '#22C55E';
  if (score >= 60) return '#EAB308';
  return '#EF4444';
}

function getLabel(score: number): string {
  if (score >= 80) return 'High Match';
  if (score >= 60) return 'Medium Match';
  return 'Low Match';
}

export type MiniGaugeProps = {
  score: number;
};

export function MiniGauge({ score }: MiniGaugeProps) {
  const clamped = Math.max(30, Math.min(100, score));
  const pct = (clamped - 30) / 70;
  const dashLen = pct * ARC_LENGTH;

  const color = getColor(score);
  const label = getLabel(score);

  return (
    <View style={styles.row}>
      <View style={styles.svgWrap}>
        <Svg viewBox="0 0 200 100" width="100%" height="100%">
          <Path
            d={ARC_PATH}
            stroke="rgba(255,255,255,0.1)"
            strokeWidth={16}
            strokeLinecap="round"
            fill="none"
          />
          <Path
            d={ARC_PATH}
            stroke={color}
            strokeWidth={16}
            strokeLinecap="round"
            strokeDasharray={`${dashLen} ${ARC_LENGTH}`}
            fill="none"
          />
        </Svg>
        <View style={styles.scoreOverlay} pointerEvents="none">
          <Text style={styles.scoreText}>{score}%</Text>
        </View>
      </View>
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  svgWrap: {
    width: 96,
    height: 48,
    overflow: 'hidden',
    position: 'relative',
  },
  scoreOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
  },
  scoreText: {
    fontSize: 18,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
  },
});
