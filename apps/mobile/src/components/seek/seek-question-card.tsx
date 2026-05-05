/**
 * SeekQuestionCard — Stage 3.9.A.1.1
 *
 * Single question card rendered in the Discover tab list.
 *
 * Layout: purple gradient surface containing
 *   - row 1: avatar + author name + (optional) tag pill
 *   - row 2: question text (max 4 lines)
 *   - row 3: wisdom count + "Offer Wisdom" CTA
 *
 * Tap on the card body opens question detail (modal route).
 * Tap on the CTA pill opens record overlay pre-bound to this question.
 */
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';

import type { SeekQuestion } from '@/lib/seek-types';

export type SeekQuestionCardProps = {
  question: SeekQuestion;
  onPress: () => void;
  onOfferWisdom: () => void;
};

export function SeekQuestionCard({ question, onPress, onOfferWisdom }: SeekQuestionCardProps) {
  const wisdomCountLabel =
    question.card_count === 1 ? '1 wisdom' : `${question.card_count} wisdoms`;

  return (
    <LinearGradient
      colors={['#B833F7', '#9333EA', '#A855F7']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.card}
    >
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.touchArea, pressed && styles.pressed]}
      >
        {/* Author row */}
        <View style={styles.authorRow}>
          <View style={styles.avatar}>
            {question.creator_avatar ? (
              <Image source={{ uri: question.creator_avatar }} style={styles.avatarImg} />
            ) : (
              <Text style={styles.avatarFallback}>🔮</Text>
            )}
          </View>
          <Text style={styles.authorName} numberOfLines={1}>
            {question.creator_name || 'WisdomSeeker'}
          </Text>
          {question.question_tag ? (
            <View style={styles.tagPill}>
              <Text style={styles.tagText}>{question.question_tag}</Text>
            </View>
          ) : null}
        </View>

        {/* Question text */}
        <Text style={styles.questionText} numberOfLines={4}>
          {question.question_text}
        </Text>

        {/* Footer */}
        <View style={styles.footer}>
          <View style={styles.wisdomCount}>
            <MaterialIcons name="chat-bubble-outline" size={14} color="rgba(255,255,255,0.55)" />
            <Text style={styles.wisdomCountText}>{wisdomCountLabel}</Text>
          </View>
          <Pressable onPress={onOfferWisdom} style={styles.offerBtnWrap}>
            <LinearGradient
              colors={['#F472B6', '#EC4899']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.offerBtn}
            >
              <MaterialIcons name="auto-awesome" size={14} color="#FFFFFF" />
              <Text style={styles.offerBtnText}>Offer Wisdom</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </Pressable>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    overflow: 'hidden',
    marginBottom: 16,
  },
  touchArea: {
    padding: 20,
  },
  pressed: {
    opacity: 0.85,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImg: {
    width: '100%',
    height: '100%',
  },
  avatarFallback: {
    fontSize: 16,
  },
  authorName: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  tagPill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
  tagText: {
    color: '#E9B0F7',
    fontSize: 10,
    fontWeight: '700',
  },
  questionText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 22,
    marginBottom: 16,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  wisdomCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  wisdomCountText: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
  },
  offerBtnWrap: {
    borderRadius: 999,
    shadowColor: '#EC4899',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 5,
  },
  offerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
  },
  offerBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
});
