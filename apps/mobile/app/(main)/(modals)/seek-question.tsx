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
 *   - Bottom: fixed Offer Wisdom CTA (router.push to record screen
 *     pre-bound with this question's keyword)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View, Alert,} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image as ExpoImage } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { apiClient } from '@/lib/api';
import { getStandardCardWidth } from '@/lib/card-dimensions';
import { buildAssetUrl, dirForFilename } from '@/lib/asset-cache';
import { blockWisdomCard } from '@/lib/wisdom-card-blocks';
import { reportWisdomCard } from '@/lib/wisdom-card-reports';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import {
  ReportSheet,
  type ReportSheetRef,
} from '@/components/seek/report-sheet';
import { supabase } from '@/lib/supabase';
import { SeekCardRow } from '@/components/seek/seek-card-row';
import type { SeekCard, SeekQuestion } from '@/lib/seek-types';
import {
  getCachedSeekCards,
  setCachedSeekCards,
  invalidateSeekCards,
  isFresh,
} from '@/lib/seek-cards-cache';
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
  const reportSheetRef = useRef<ReportSheetRef>(null);
  // Set when the user leaves to offer their own wisdom; the return
  // focus then force-refreshes (bypassing TTL) so their new card
  // shows even inside the 60s freshness window.
  const pendingOfferRef = useRef(false);

  // Resolve current user id once (used by save guard + API).
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user.id ?? null);
    });
  }, []);

  // Prefetch front + back faces for a list of cards into expo-image's
  // cache. capMs bounds the wait so we never hang the spinner / render;
  // FlippableCard renders these exact R2 URLs (cachePolicy memory-disk),
  // so a warm prefetch is an instant cache hit.
  const prefetchCardFaces = useCallback(
    async (list: SeekCard[], capMs: number) => {
      try {
        const R2_BASE = 'https://media.novameapp.com';
        const filenames: string[] = [];
        for (const c of list) {
          if (!c.keyword_id) continue;
          filenames.push(`${c.keyword_id}-front.webp`);
          filenames.push(`${c.keyword_id.split('-')[0]}-back.webp`);
        }
        const urls = Array.from(new Set(filenames)).map((fn) =>
          buildAssetUrl(R2_BASE, dirForFilename(fn), fn),
        );
        if (urls.length > 0) {
          await Promise.race([
            ExpoImage.prefetch(urls),
            new Promise((resolve) => setTimeout(resolve, capMs)),
          ]);
        }
      } catch {
        // Prefetch failure is non-fatal — images stream in as a fallback.
      }
    },
    [],
  );

  // SWR loader (cache-then-network, TTL=60s). force=true bypasses the
  // freshness short-circuit (used after the user offers their own wisdom
  // so their new card shows on return without waiting for TTL to expire).
  const load = useCallback(
    async (force = false) => {
      if (!questionId) {
        setError('Missing question id');
        setLoading(false);
        return;
      }

      // Cache hit -> render immediately (fast open, no full-screen
      // spinner). We still SHORT-prefetch faces (2s cap) before swapping
      // in, so a hit always reveals the COMPLETE card even if expo-image
      // evicted the images since the last visit.
      const cached = getCachedSeekCards(questionId, userId);
      if (cached) {
        await prefetchCardFaces(cached.cards, 2000);
        setCards(cached.cards);
        if (cached.question) setQuestion(cached.question);
        setLoading(false);
        // Fresh and not forced -> trust cache, skip the network entirely.
        if (!force && isFresh(cached)) return;
        // Stale or forced -> fall through to a SILENT background refresh
        // (loading already false; the old snapshot stays on screen).
      } else {
        // Cache miss (first visit) -> full spinner.
        setLoading(true);
      }

      setError(null);
      try {
        // Append userId so the server can filter out cards this user
        // has blocked. Without userId the server skips the block filter
        // and returns all cards — used as a transitional path during
        // sign-out / before session is resolved.
        const userIdParam = userId ? `&userId=${encodeURIComponent(userId)}` : '';
        const data = await apiClient.get<FetchResp & { question?: SeekQuestion }>(
          `/api/seek-questions?questionId=${encodeURIComponent(questionId)}${userIdParam}`,
        );
        const fetched = data.cards ?? [];
        const q = data.question ?? cached?.question ?? null;

        // Cache MISS -> wait (4s cap) for faces before first paint so the
        // reveal is complete. Background refresh (cards already on screen)
        // -> no blocking; unchanged cards are warm, new ones stream in.
        if (!cached) {
          await prefetchCardFaces(fetched, 4000);
        }

        setCards(fetched);
        if (data.question) setQuestion(data.question);
        setCachedSeekCards(questionId, userId, fetched, q);
      } catch (e) {
        // Only surface an error if there is nothing on screen (true miss).
        // On a background refresh we keep the cached snapshot visible.
        if (!cached) {
          setError(e instanceof Error ? e.message : 'Failed to load wisdoms');
        }
      } finally {
        setLoading(false);
      }
    },
    [questionId, userId, prefetchCardFaces],
  );

  // Re-fetch on every focus (initial mount + every time the user
  // returns to this modal from another screen, e.g. back from record
  // overlay after publishing a wisdom). This guarantees newly-offered
  // wisdoms appear without manual pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      // After offering your own wisdom, force a refresh (bypass TTL) so
      // your new card appears on return even inside the 60s window.
      if (pendingOfferRef.current) {
        pendingOfferRef.current = false;
        invalidateSeekCards(questionId, userId);
        void load(true);
      } else {
        void load(false);
      }
    }, [load, questionId, userId]),
  );

  const onBlock = async (card: SeekCard) => {
    if (!userId) return;
    // Optimistic: snapshot current list, remove the card immediately.
    // If the server fails, we restore by reinserting at the original
    // position so the user's mental model of card order stays intact.
    const snapshot = cards;
    const idx = snapshot.findIndex((c) => c.id === card.id);
    setCards((prev) => prev.filter((c) => c.id !== card.id));
    const result = await blockWisdomCard(userId, card.id);
    if (result.success) {
      // Keep the cache consistent so the blocked card cannot reappear
      // from a still-fresh cache hit on the next visit.
      setCachedSeekCards(
        questionId,
        userId,
        snapshot.filter((c) => c.id !== card.id),
        question,
      );
    }
    if (!result.success) {
      // Roll back: insert at original index.
      setCards((prev) => {
        const next = [...prev];
        const safeIdx = Math.min(idx, next.length);
        next.splice(safeIdx, 0, card);
        return next;
      });
      Alert.alert(
        'Could not block',
        result.error ?? 'Please try again.',
      );
    }
  };

  // Open the report sheet for the given card. The sheet collects
  // reason + detail, then calls handleReportSubmit on Submit.
  const onReport = (card: SeekCard) => {
    reportSheetRef.current?.present(card.id);
  };

  // Called by ReportSheet after the user selects a reason and submits.
  // Posts the report to the server (which also auto-blocks the card
  // for this user per Apple-compliant UGC moderation flow), then
  // optimistically drops the card from the list with rollback on
  // failure -- same pattern as onBlock.
  //
  // Apple App Store Guideline 1.2 compliance: we surface a confirmation
  // dialog promising 24-hour admin review so users know reports are
  // taken seriously, not silently dropped.
  const handleReportSubmit = async (
    cardId: string,
    reason: Parameters<typeof reportWisdomCard>[2],
    detail: string,
  ) => {
    if (!userId) return;
    const snapshot = cards;
    const idx = snapshot.findIndex((c) => c.id === cardId);
    const original = snapshot[idx];
    // Optimistic remove.
    setCards((prev) => prev.filter((c) => c.id !== cardId));
    const result = await reportWisdomCard(userId, cardId, reason, detail);
    if (result.success) {
      // Keep the cache consistent (reported card is auto-blocked).
      setCachedSeekCards(
        questionId,
        userId,
        snapshot.filter((c) => c.id !== cardId),
        question,
      );
    }
    if (!result.success) {
      // Roll back to original list position.
      if (original) {
        setCards((prev) => {
          const next = [...prev];
          const safeIdx = Math.min(idx, next.length);
          next.splice(safeIdx, 0, original);
          return next;
        });
      }
      Alert.alert(
        'Could not submit report',
        result.error ?? 'Please try again.',
      );
      return;
    }
    Alert.alert(
      'Report submitted',
      result.alreadyReported
        ? 'You\u2019ve already reported this wisdom. Our team will review it within 24 hours.'
        : 'Thanks for letting us know. Our team will review this within 24 hours and take action if it violates our community guidelines.',
    );
  };

  const offerWisdom = () => {
    void haptics.light();
    if (!question) return;
    const sp = new URLSearchParams({
      questionId: question.id,
      forceKeyword: question.question_tag || '',
      questionText: question.question_text,
    });
    const target = `/(main)/record?${sp.toString()}`;
    // AI consent gate: pushes consent modal with this target as `next`
    // if not agreed. The modal will router.replace to `target` after
    // Agree; we must NOT push it again here on the false path.
    // Mark so the return focus force-refreshes (see useFocusEffect).
    pendingOfferRef.current = true;
    const proceed = requireAiConsent(target);
    if (!proceed) return;
    router.push(target as never);
  };

  return (
    <BottomSheetModalProvider>
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
              <Text style={styles.emptySub}>Be the first to offer your wisdom.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <SeekCardRow
              card={item}
              cardWidth={CARD_WIDTH}
              canBlock={!!userId && item.user_id !== userId}
              onBlock={() => void onBlock(item)}
              onReport={() => onReport(item)}
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
              <Text style={styles.ctaText}>Share Wisdom</Text>
            </LinearGradient>
          </Pressable>
        </View>
      ) : null}

      {/* Report sheet -- mounted inside a local BottomSheetModalProvider
          so its portal lives in THIS modal's view hierarchy, not the
          parent root (which is hidden behind the native modal). Without
          the local Provider, gorhom's portal would render under the
          modal window and the sheet would be invisible / unreachable.
          Apple App Store Guideline 1.2 (UGC moderation) requires this
          report mechanism. */}
      <ReportSheet
        ref={reportSheetRef}
        onSubmit={(cardId, reason, detail) =>
          void handleReportSubmit(cardId, reason, detail)
        }
      />
    </View>
    </BottomSheetModalProvider>
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
