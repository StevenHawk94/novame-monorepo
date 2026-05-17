/**
 * InsightView — Stage 3.9.A.2.4
 *
 * Pure presentation of a generated wisdom_card insight payload. Used
 * by record.tsx (after publish) and by the My Logs Insight modal
 * (re-viewing a previously published wisdom). The component knows
 * nothing about haptics, paywalls, or character-state — those side
 * effects live in the parent wrapper.
 *
 * Renders:
 *   - "WISDOM INSIGHT" title
 *   - Score ring (0-100) + emotion label
 *   - FlippableCard (front: keyword art + quote, back: insight_full)
 *   - Card B "Feel Seen" glass card
 *   - Card C "Root Insight" glass card
 *   - Tasks block (only when at least one task exists)
 *
 * Anything optional (B/C/tasks/quote/insight_full) degrades gracefully
 * when null so the modal works on legacy wisdoms predating those columns.
 */
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { MaterialIcons } from '@expo/vector-icons';

import { FlippableCard } from '@/components/cards/FlippableCard';
import { getStandardCardWidth } from '@/lib/card-dimensions';
import { Dimensions } from 'react-native';

const INSIGHT_RING_R = 38;
const INSIGHT_RING_C = 2 * Math.PI * INSIGHT_RING_R;

/**
 * Slug-to-display-name map. Server returns `keyword_id` like
 * `mind-clarity`; we render the human-readable label. New keyword_ids
 * fall back to 'Clarity'.
 */
export const KEYWORD_ID_TO_NAME: Record<string, string> = {
  'mind-clarity': 'Clarity',
  'mind-grounding': 'Grounding',
  'mind-focus': 'Focus',
  'mind-curiosity': 'Curiosity',
  'mind-stillness': 'Stillness',
  'mind-objectivity': 'Objectivity',
  'mind-adaptability': 'Adaptability',
  'mind-unlearning': 'Unlearning',
  'mind-vision': 'Vision',
  'mind-acceptance': 'Acceptance',
  'mind-humor': 'Humor',
  'mind-intuition': 'Intuition',
  'heart-resilience': 'Resilience',
  'heart-boundaries': 'Boundaries',
  'heart-self-compassion': 'Self-Compassion',
  'heart-courage': 'Courage',
  'heart-vulnerability': 'Vulnerability',
  'heart-empathy': 'Empathy',
  'heart-gratitude': 'Gratitude',
  'heart-patience': 'Patience',
  'heart-forgiveness': 'Forgiveness',
  'heart-release': 'Release',
  'heart-balance': 'Balance',
  'heart-joy': 'Joy',
  'action-initiative': 'Initiative',
  'action-consistency': 'Consistency',
  'action-discipline': 'Discipline',
  'action-decisiveness': 'Decisiveness',
  'action-purpose': 'Purpose',
  'action-rest': 'Rest',
  'action-resourcefulness': 'Resourcefulness',
  'action-accountability': 'Accountability',
  'action-boldness': 'Boldness',
  'action-endurance': 'Endurance',
  'action-communication': 'Communication',
  'action-momentum': 'Momentum',
  'connection-sovereignty': 'Sovereignty',
  'connection-authenticity': 'Authenticity',
  'connection-inspiration': 'Inspiration',
  'connection-generosity': 'Generosity',
  'connection-trust': 'Trust',
  'connection-reciprocity': 'Reciprocity',
  'connection-collaboration': 'Collaboration',
  'connection-leadership': 'Leadership',
  'connection-harmony': 'Harmony',
  'connection-legacy': 'Legacy',
  'connection-respect': 'Respect',
  'connection-loyalty': 'Loyalty',
};

/**
 * Extract `{ title, body }` from a server-merged "Title: xxx\n<body>"
 * string. Falls back to empty title and full string as body if the
 * regex doesn't match.
 */
export function splitTitleBody(raw: string): { title: string; body: string } {
  if (!raw) return { title: '', body: '' };
  const m = raw.match(/^Title:\s*(.+?)\n([\s\S]*)$/);
  if (m) return { title: m[1].trim(), body: m[2].trim() };
  return { title: '', body: raw };
}

/**
 * Card data shape consumed by the view. Compatible with both:
 *   - record.tsx PublishedCardData (post-publish response)
 *   - WisdomCardEmbed (My Logs feed payload)
 */
export type InsightCardData = {
  keyword_id?: string | null;
  keyword?: string | null;
  quote_short?: string | null;
  insight_full?: string | null;
  card_b?: string | null;
  card_c?: string | null;
  task_1?: string | null;
  task_2?: string | null;
};

export type InsightViewProps = {
  card: InsightCardData | null;
  score: number;
  emotion: string;
};

export function InsightView({ card, score, emotion }: InsightViewProps) {
  const keywordId = card?.keyword_id ?? 'mind-clarity';
  const frontFilename = `${keywordId}-front.webp`;
  const backFilename = `${keywordId.split('-')[0]}-back.webp`;

  const quoteShort =
    card?.quote_short ?? 'Reflection turns experience into wisdom.';

  const b = splitTitleBody(card?.card_b ?? '');
  const c = splitTitleBody(card?.card_c ?? '');

  const hasTasks = !!(card?.task_1 || card?.task_2);

  const safeScore = Math.max(0, Math.min(100, Math.round(score)));
  const ringDashOffset = INSIGHT_RING_C * (1 - safeScore / 100);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>WISDOM INSIGHT</Text>

      <View style={styles.metaRow}>
        <View style={styles.scoreCol}>
          <View style={styles.scoreRingWrap}>
            <Svg width={90} height={90} viewBox="0 0 90 90">
              {/* Stage 6.RecordVisual: pink ring on purple bg + brighter track. */}
              <Circle
                cx={45}
                cy={45}
                r={INSIGHT_RING_R}
                fill="none"
                stroke="rgba(255,255,255,0.25)"
                strokeWidth={6}
              />
              <Circle
                cx={45}
                cy={45}
                r={INSIGHT_RING_R}
                fill="none"
                stroke="#EC4899"
                strokeWidth={6}
                strokeLinecap="round"
                strokeDasharray={`${INSIGHT_RING_C}`}
                strokeDashoffset={`${ringDashOffset}`}
                transform="rotate(-90 45 45)"
              />
            </Svg>
            <View pointerEvents="none" style={styles.scoreCenter}>
              <Text style={styles.scoreValue}>{safeScore}</Text>
              <Text style={styles.scoreMax}>/100</Text>
            </View>
          </View>
          <View style={styles.scoreLabelRow}>
            <MaterialIcons name="star" size={14} color="#FACC15" />
            <Text style={styles.scoreLabel}>Wisdom Score</Text>
          </View>
        </View>

        <View style={styles.emotionCol}>
          <MaterialIcons name="sentiment-satisfied" size={36} color="#FFFFFF" />
          <Text style={styles.emotionCaption}>Wisdom Emotion:</Text>
          <Text style={styles.emotionValue}>{emotion || 'Thoughtful'}</Text>
        </View>
      </View>

      <View style={styles.cardWrap}>
        <FlippableCard
          frontFilename={frontFilename}
          backFilename={backFilename}
          quoteShort={quoteShort}
          insightFull={card?.insight_full ?? ''}
          width={getStandardCardWidth(Dimensions.get('window').width)}
        />
      </View>
      <Text style={styles.flipHint}>Tap to flip</Text>

      {b.body ? (
        <View style={styles.glassCard}>
          <View style={styles.glassHeader}>
            <MaterialIcons name="psychology" size={18} color="#FFFFFF" />
            {b.title ? <Text style={styles.glassTitle}>{b.title}</Text> : null}
          </View>
          <Text style={styles.glassBody}>{b.body}</Text>
        </View>
      ) : null}

      {c.body ? (
        <View style={styles.glassCard}>
          <View style={styles.glassHeader}>
            <MaterialIcons name="school" size={18} color="#FFFFFF" />
            {c.title ? <Text style={styles.glassTitle}>{c.title}</Text> : null}
          </View>
          <Text style={styles.glassBody}>{c.body}</Text>
        </View>
      ) : null}

      {hasTasks ? (
        <View style={styles.tasksCard}>
          <View style={styles.glassHeader}>
            <MaterialIcons name="task-alt" size={18} color="#FACC15" />
            <Text style={styles.glassTitle}>YOUR WISDOM TASKS</Text>
          </View>
          {card?.task_1 ? (
            <View style={styles.taskRow}>
              <Text style={styles.taskBolt}>⚡</Text>
              <Text style={styles.taskText}>{card.task_1}</Text>
            </View>
          ) : null}
          {card?.task_2 ? (
            <View style={styles.taskRow}>
              <Text style={styles.taskBolt}>⚡</Text>
              <Text style={styles.taskText}>{card.task_2}</Text>
            </View>
          ) : null}
          <Text style={styles.taskHint}>
            Complete these tasks from your character page to earn EXP!
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    // Stage 6.RecordVisual: 32 -> 80 for fullScreenModal status-bar clearance.
    paddingTop: 80,
    paddingBottom: 16,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginBottom: 28,
    letterSpacing: 1.5,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    marginBottom: 28,
  },
  scoreCol: {
    alignItems: 'center',
  },
  scoreRingWrap: {
    width: 90,
    height: 90,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreCenter: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreValue: {
    color: '#FFFFFF',
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
  },
  scoreMax: {
    // Stage 6.RecordVisual: bumped 0.4 -> 0.85 for purple bg legibility.
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
  scoreLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  scoreLabel: {
    // Stage 6.RecordVisual: 0.6 -> 0.85 + bumped 12 -> 13.
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  emotionCol: {
    alignItems: 'center',
  },
  emotionCaption: {
    // Stage 6.RecordVisual: 0.5 -> 0.85 + size 10 -> 12.
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: 6,
  },
  emotionValue: {
    // Stage 6.RecordVisual: was light purple #C084FC (low contrast on bg).
    // Now pure white + bumped 13 -> 15.
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginTop: 2,
  },
  cardWrap: {
    alignItems: 'center',
    marginBottom: 8,
  },
  flipHint: {
    // Stage 6.RecordVisual: 0.2 (invisible) -> 0.85 + size 10 -> 12.
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    marginBottom: 24,
  },
  glassCard: {
    // Stage 6.RecordVisual: slightly more solid for legibility on purple bg.
    width: '100%',
    padding: 20,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    marginBottom: 16,
  },
  glassHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  glassTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    flexShrink: 1,
  },
  glassBody: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    lineHeight: 23,
  },
  tasksCard: {
    width: '100%',
    padding: 20,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    marginBottom: 16,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 10,
  },
  taskBolt: {
    color: '#FACC15',
    fontSize: 14,
    marginTop: 2,
  },
  taskText: {
    // Stage 6.RecordVisual: 0.7 -> #FFFFFF for legibility.
    flex: 1,
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    lineHeight: 23,
  },
  taskHint: {
    // Stage 6.RecordVisual: 0.3 (invisible) -> 0.85.
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    marginTop: 12,
  },
});
