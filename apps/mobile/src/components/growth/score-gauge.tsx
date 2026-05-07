import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

/**
 * Large half-circle gauge for the Growth Center "Better Self Match"
 * card (Stage 3.10.3 A). Same SVG technique as MiniGauge but bigger:
 * the gauge is the focal point of its card, score sits inside the arc
 * in 32px black weight, and the match label drops below the arc in
 * the gauge color.
 *
 * Score domain matches MiniGauge (30 - 100, default 70). Color
 * thresholds are also identical so the two surfaces never disagree.
 */

const ARC_PATH = 'M 20 90 A 80 80 0 0 1 180 90';
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

export type ScoreGaugeProps = {
  score: number;
};

export function ScoreGauge({ score }: ScoreGaugeProps) {
  const clamped = Math.max(30, Math.min(100, score));
  const pct = (clamped - 30) / 70;
  const dashLen = pct * ARC_LENGTH;

  const color = getColor(score);
  const label = getLabel(score);

  return (
    <View style={styles.wrap}>
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
  wrap: {
    alignItems: 'center',
  },
  svgWrap: {
    width: 200,
    height: 100,
    overflow: 'hidden',
    position: 'relative',
  },
  scoreOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 4,
    alignItems: 'center',
  },
  scoreText: {
    fontSize: 32,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    marginTop: 8,
  },
});
