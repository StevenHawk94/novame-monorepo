/**
 * Seek Question Detail — Stage 3.9.A.1.3
 *
 * Modal screen showing one community question along with all wisdom
 * cards offered for it. Reached from Discover tab by tapping a card.
 *
 * Data flow:
 *   - Question data is passed via router param `q` (base64 JSON of
 *     SeekQuestion). This avoids re-fetching question metadata when
 *     the user already has it from the list page.
 *   - Cards are fetched from /api/seek-questions?questionId=X. Returns
 *     { cards: SeekCard[] }.
 *   - Save state per card uses /api/card-saves (POST/DELETE).
 *
 * Layout:
 *   - Top: back button + question text + author + tag + wisdom count
 *   - Middle: vertical list of FlippableCard with save bookmark
 *   - Bottom: fixed Offer Wisdom CTA (router.push to record overlay
 *     pre-bound with this question's keyword)
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { apiClient } from '@/lib/api';
import { getStandardCardWidth } from '@/lib/card-dimensions';
import { saveCard, unsaveCard } from '@/lib/card-saves-api';
import { supabase } from '@/lib/supabase';
import { SeekCardRow } from '@/components/seek/seek-card-row';
import type { SeekCard, SeekQuestion } from '@/lib/seek-types';
import { haptics } from '@/lib/haptics';
import { requireAiConsent } from '@/lib/ai-consent';

type FetchResp = { cards?: SeekCard[] };

const { width: SCREEN_W } = Dimensions.get('window');
const CARD_WIDTH = getStandardCardWidth(SCREEN_W);

function decodeQuestionParam(q: string | undefined): SeekQuestion | null {
  if (!q) return null;
  try {
    // Mirrors the URI-encoded payload produced by discover.tsx.
    // Hermes' atob throws on non-ASCII so we always use URI encoding.
    return JSON.parse(decodeURIComponent(q)) as SeekQuestion;
  } catch {
    return null;
  }
}

export default function SeekQuestionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string; q?: string }>();
  const questionFromParam = decodeQuestionParam(params.q);
  const questionId = questionFromParam?.id ?? params.id ?? '';

  const [question, setQuestion] = useState<SeekQuestion | null>(questionFromParam);
  const [cards, setCards] = useState<SeekCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [savingCardId, setSavingCardId] = useState<string | null>(null);

  // Resolve current user id once (used by save guard + API).
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user.id ?? null);
    });
  }, []);

  const load = useCallback(async () => {
    if (!questionId) {
      setError('Missing question id');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<FetchResp & { question?: SeekQuestion }>(
        `/api/seek-questions?questionId=${encodeURIComponent(questionId)}`,
      );
      setCards(data.cards ?? []);
      // Prefer server question if present (more authoritative than param).
      if (data.question) setQuestion(data.question);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load wisdoms');
    } finally {
      setLoading(false);
    }
  }, [questionId]);

  // Re-fetch on every focus (initial mount + every time the user
  // returns to this modal from another screen, e.g. back from record
  // overlay after publishing a wisdom). This guarantees newly-offered
  // wisdoms appear without manual pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onToggleSave = async (card: SeekCard) => {
    if (!userId || savingCardId) return;
    setSavingCardId(card.id);
    const wasSaved = !!card.is_saved;
    // Optimistic update
    setCards((prev) =>
      prev.map((c) => (c.id === card.id ? { ...c, is_saved: !wasSaved } : c)),
    );
    const result = wasSaved
      ? await unsaveCard(userId, card.id)
      : await saveCard(userId, card.id);
    if (!result.success) {
      // Roll back
      setCards((prev) =>
        prev.map((c) => (c.id === card.id ? { ...c, is_saved: wasSaved } : c)),
      );
    }
    setSavingCardId(null);
  };

  const offerWisdom = () => {
    void haptics.light();
    if (!question) return;
    const sp = new URLSearchParams({
      questionId: question.id,
      forceKeyword: question.question_tag || '',
      questionText: question.question_text,
    });
    const target = `/(main)/(modals)/record?${sp.toString()}`;
    // AI consent gate: pushes consent modal with this target as `next`
    // if not agreed. The modal will router.replace to `target` after
    // Agree; we must NOT push it again here on the false path.
    const proceed = requireAiConsent(target);
    if (!proceed) return;
    router.push(target as never);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <Pressable onPress={() => { void haptics.light(); router.back(); }} style={styles.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={22} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.topTitle}>Wisdoms</Text>
        <View style={styles.topBarSpacer} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#A855F7" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <MaterialIcons name="cloud-off" size={48} color="rgba(255,255,255,0.25)" />
          <Text style={styles.errorTitle}>Couldn{'\u2019'}t load wisdoms</Text>
          <Text style={styles.errorSub}>{error}</Text>
          <Pressable onPress={() => { void haptics.light(); void load(); }} style={styles.retryBtn}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : !question ? (
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Question not found</Text>
        </View>
      ) : (
        <FlatList
          data={cards}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <QuestionHeader question={question} cardCount={cards.length} />
          }
          ListEmptyComponent={
            <View style={styles.emptyBlock}>
              <MaterialIcons name="auto-awesome" size={42} color="rgba(255,255,255,0.18)" />
              <Text style={styles.emptyTitle}>No wisdoms yet</Text>
              <Text style={styles.emptySub}>Be the first to offer one</Text>
            </View>
          }
          renderItem={({ item }) => (
            <SeekCardRow
              card={item}
              cardWidth={CARD_WIDTH}
              saved={!!item.is_saved}
              canSave={!!userId && item.user_id !== userId}
              saving={savingCardId === item.id}
              onToggleSave={() => void onToggleSave(item)}
            />
          )}
        />
      )}

      {/* Bottom CTA */}
      {question ? (
        <View style={[styles.ctaWrap, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable onPress={offerWisdom} style={styles.ctaBtnWrap}>
            <LinearGradient
              colors={['#F472B6', '#EC4899']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.ctaBtn}
            >
              <MaterialIcons name="auto-awesome" size={18} color="#FFFFFF" />
              <Text style={styles.ctaText}>Offer Wisdom</Text>
            </LinearGradient>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function QuestionHeader({ question, cardCount }: { question: SeekQuestion; cardCount: number }) {
  return (
    <View style={styles.qHeader}>
      <View style={styles.qAuthorRow}>
        <View style={styles.qAvatar}>
          {question.creator_avatar ? (
            <Image source={{ uri: question.creator_avatar }} style={styles.qAvatarImg} />
          ) : (
            <Text style={styles.qAvatarFallback}>🔮</Text>
          )}
        </View>
        <Text style={styles.qAuthorName} numberOfLines={1}>
          {question.creator_name || 'WisdomSeeker'}
        </Text>
        {question.question_tag ? (
          <View style={styles.qTag}>
            <Text style={styles.qTagText}>{question.question_tag}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.qText}>{question.question_text}</Text>
      <Text style={styles.qCount}>
        {cardCount} {cardCount === 1 ? 'wisdom offered' : 'wisdoms offered'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0F0B2E',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  topBarSpacer: {
    width: 40,
    height: 40,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 80,
    gap: 8,
  },
  errorTitle: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 15,
    fontWeight: '600',
    marginTop: 12,
  },
  errorSub: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
  },
  retryBtn: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(168,85,247,0.18)',
  },
  retryText: {
    color: '#C084FC',
    fontSize: 13,
    fontWeight: '700',
  },
  listContent: {
    paddingTop: 4,
    paddingBottom: 120,
  },
  qHeader: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 24,
  },
  qAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  qAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qAvatarImg: {
    width: '100%',
    height: '100%',
  },
  qAvatarFallback: {
    fontSize: 14,
  },
  qAuthorName: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  qTag: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(168,85,247,0.2)',
  },
  qTagText: {
    color: '#E9B0F7',
    fontSize: 10,
    fontWeight: '700',
  },
  qText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 26,
    marginBottom: 12,
  },
  qCount: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    fontWeight: '600',
  },
  emptyBlock: {
    alignItems: 'center',
    paddingTop: 60,
    paddingBottom: 40,
    gap: 6,
  },
  emptyTitle: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 15,
    fontWeight: '600',
    marginTop: 12,
  },
  emptySub: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 13,
  },
  ctaWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: 'rgba(15,11,46,0.95)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  ctaBtnWrap: {
    borderRadius: 999,
    shadowColor: '#EC4899',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 14,
    elevation: 5,
  },
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 999,
  },
  ctaText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
