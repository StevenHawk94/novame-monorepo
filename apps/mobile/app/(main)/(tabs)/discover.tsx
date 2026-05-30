/**
 * Discover tab — Stage 3.9.A.1.2
 *
 * Question feed from the community. Fetches from /api/seek-questions
 * on mount and via pull-to-refresh.
 *
 * Each question card opens a detail screen (3.9.A.1.3) and an
 * "Offer Wisdom" CTA opens the record overlay pre-bound to that
 * question (forceKeyword + questionId in query params).
 *
 * FAB action sheet exposes "Ask New Question" (3.9.A.1.4) and
 * "My Questions" (3.9.A.1.5).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';

import { SeekQuestionCard } from '@/components/seek/seek-question-card';
import type { SeekQuestion } from '@/lib/seek-types';
import { haptics } from '@/lib/haptics';
import { requireAiConsent } from '@/lib/ai-consent';
import {
  fetchSeekQuestionsWithCache,
  getCachedSeekQuestions,
} from '@/lib/seek-questions-cache';

type FetchResp = { questions?: SeekQuestion[] };

export default function DiscoverTab() {
  // Keywords selected via the filter modal. Persisted only in memory
  // (Q-3.9.A.2-batchD: session-only). The filter modal hands them
  // back via a `filter` route param (comma-separated).
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
  const filterParam = useLocalSearchParams<{ filter?: string }>().filter;

  // Sync the param into state on every mount/focus. An empty string
  // means "show all" (Reset button case).
  useEffect(() => {
    if (filterParam === undefined) return;
    const next = (filterParam || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    setSelectedKeywords(next);
  }, [filterParam]);

  // Re-fetch whenever the filter set changes. We depend on the
  // joined string so the effect doesn't fire on every render with a
  // fresh array reference but identical contents.
  const filterKey = selectedKeywords.join(',');
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  const router = useRouter();
  // Stage 6 follow-up (infinite-scroll): PAGE_SIZE matches the server-
  // side default in /api/seek-questions route.js (commit 59b6e23).
  // Changing it here without changing the server-side ?limit default
  // would break the hasMore signal (= returned.length === PAGE_SIZE).
  const PAGE_SIZE = 20;

  const [questions, setQuestions] = useState<SeekQuestion[]>(
    () => getCachedSeekQuestions('') ?? [],
  );
  const [loading, setLoading] = useState(
    () => getCachedSeekQuestions('') === null,
  );
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fabOpen, setFabOpen] = useState(false);
  // Infinite-scroll state. `page` is 0-indexed and starts at 0 (the
  // cached / first fetch). `hasMore` defaults to true so the very
  // first scroll-end can trigger a fetch even before we know whether
  // page 0 was full -- the loadMore guard re-checks before firing.
  // `loadingMore` debounces rapid onEndReached fires (FlatList can
  // fire it multiple times during fast scroll).
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    // Stage 6 SWR: only show spinner if no cache. Pull-to-refresh
    // (mode='refresh') always shows refresh indicator regardless.
    const hasCache = getCachedSeekQuestions(filterKey) !== null;
    if (mode === 'initial' && !hasCache) setLoading(true);
    else if (mode === 'refresh') setRefreshing(true);
    setError(null);
    try {
      const qs = await fetchSeekQuestionsWithCache(
        filterKey,
        selectedKeywords,
        { limit: PAGE_SIZE, offset: 0 },
      );
      setQuestions(qs);
      // Reset infinite-scroll state for the new view (filter change,
      // refresh, or focus return all funnel through here).
      setPage(0);
      setHasMore(qs.length === PAGE_SIZE);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load questions');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedKeywords, filterKey]);

  // onEndReached handler: fetches the next page when the user scrolls
  // close to the bottom of the list. Bailout conditions:
  //   - loadingMore: in-flight fetch (FlatList fires onEndReached
  //     multiple times during fast scroll; this debounces).
  //   - !hasMore: previous page returned less than PAGE_SIZE, so we
  //     know we're at the end.
  //   - !questions.length: nothing rendered yet; the initial load
  //     handles the first page.
  // Failure mode: a thrown fetch leaves hasMore = true so the user
  // can retry by continuing to scroll (or refresh) -- we don't
  // pessimistically disable the feed on transient network errors.
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || questions.length === 0) return;
    setLoadingMore(true);
    try {
      const nextOffset = (page + 1) * PAGE_SIZE;
      const more = await fetchSeekQuestionsWithCache(
        filterKey,
        selectedKeywords,
        { limit: PAGE_SIZE, offset: nextOffset },
      );
      setQuestions((prev) => [...prev, ...more]);
      setPage((p) => p + 1);
      setHasMore(more.length === PAGE_SIZE);
    } catch (e) {
      console.warn('[discover] loadMore failed:', e);
      // Do NOT set hasMore=false on error: user can scroll again to
      // retry. setQuestions stays unchanged.
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, questions.length, page, filterKey, selectedKeywords]);

  // Re-fetch on every focus (initial mount + every time the user
  // returns to this tab). Keeps the question list + each card's
  // wisdom count fresh after the user offers a wisdom and the modal
  // pops back here.
  useFocusEffect(
    useCallback(() => {
      void load('initial');
    }, [load]),
  );

  const openQuestionDetail = (q: SeekQuestion) => {
    // Pass full question payload so the detail screen can render
    // header instantly without a second fetch. Detail screen still
    // re-syncs from server when fetching cards.
    //
    // We URI-encode the JSON instead of base64 because Hermes' btoa
    // throws on non-ASCII characters (emoji, CJK, smart quotes), all
    // of which appear in user-authored question text.
    const encoded = encodeURIComponent(JSON.stringify(q));
    router.push(`/(main)/(modals)/seek-question?id=${encodeURIComponent(q.id)}&q=${encoded}`);
  };

  const offerWisdom = (q: SeekQuestion) => {
    const params = new URLSearchParams({
      questionId: q.id,
      forceKeyword: q.question_tag || '',
      questionText: q.question_text,
    });
    const target = `/(main)/record?${params.toString()}`;
    // AI consent gate: pushes consent modal with this target as `next`
    // if not agreed. The modal will router.replace to `target` after
    // Agree; we must NOT push it again here on the false path.
    const proceed = requireAiConsent(target);
    if (!proceed) return;
    router.push(target as never);
  };

  const askNew = () => {
    void haptics.light();
    setFabOpen(false);
    router.push('/(main)/(modals)/new-question');
  };

  const myQuestions = () => {
    void haptics.light();
    setFabOpen(false);
    router.push('/(main)/(modals)/my-questions');
  };

  // Open the filter modal, pre-seeded with the current selection so
  // the user sees what's already chosen.
  const openFilter = () => {
    void haptics.light();
    const csv = selectedKeywords.join(',');
    router.push({
      pathname: '/(main)/(modals)/discover-filter',
      params: csv ? { selected: csv } : {},
    });
  };

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Questions from the Community</Text>
        <Pressable
          onPress={openFilter}
          hitSlop={12}
          style={({ pressed }) => [
            styles.filterBtn,
            selectedKeywords.length > 0 && styles.filterBtnActive,
            pressed && { opacity: 0.7 },
          ]}
        >
          <MaterialIcons
            name="tune"
            size={22}
            color={selectedKeywords.length > 0 ? '#FFFFFF' : 'rgba(255,255,255,0.6)'}
          />
          {selectedKeywords.length > 0 ? (
            <View style={styles.filterBadge}>
              <Text style={styles.filterBadgeText}>{selectedKeywords.length}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      {/* Body */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#A855F7" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <MaterialIcons name="cloud-off" size={48} color="rgba(255,255,255,0.25)" />
          <Text style={styles.errorTitle}>Unable to Load Questions</Text>
          <Text style={styles.errorSub}>{error}</Text>
          <Pressable onPress={() => { void haptics.light(); void load('initial'); }} style={styles.retryBtn}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : questions.length === 0 ? (
        <View style={styles.center}>
          <MaterialIcons name="help-outline" size={48} color="rgba(255,255,255,0.2)" />
          <Text style={styles.emptyText}>No questions yet</Text>
          <Text style={styles.emptySub}>Tap + to ask the community</Text>
        </View>
      ) : (
        <FlatList
          data={questions}
          keyExtractor={(q) => q.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <SeekQuestionCard
              question={item}
              onPress={() => openQuestionDetail(item)}
              onOfferWisdom={() => offerWisdom(item)}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load('refresh')}
              tintColor="#FFFFFF"
              title="Pull to refresh"
              titleColor="rgba(255,255,255,0.6)"
            />
          }
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footerLoader}>
                <ActivityIndicator color="rgba(255,255,255,0.5)" />
              </View>
            ) : null
          }
        />
      )}

      {/* FAB */}
      <Pressable onPress={() => { void haptics.light(); setFabOpen(true); }} style={styles.fab}>
        <MaterialIcons name="add" size={28} color="#FFFFFF" />
      </Pressable>

      {/* FAB Action Sheet */}
      <Modal
        visible={fabOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setFabOpen(false)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setFabOpen(false)}>
          <View style={styles.sheet}>
            <Pressable onPress={askNew} style={styles.sheetBtn}>
              <MaterialIcons name="help-outline" size={22} color="#FFFFFF" />
              <Text style={styles.sheetBtnText}>Ask New Question</Text>
            </Pressable>
            <View style={styles.sheetDivider} />
            <Pressable onPress={myQuestions} style={styles.sheetBtn}>
              <MaterialIcons name="format-list-bulleted" size={22} color="#FFFFFF" />
              <Text style={styles.sheetBtnText}>My Questions</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  filterBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  filterBtnActive: {
    backgroundColor: 'rgba(168,85,247,0.25)',
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.55)',
  },
  filterBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 999,
    backgroundColor: '#A855F7',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#0F0B2E',
  },
  filterBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  root: {
    flex: 1,
    backgroundColor: '#0F0B2E',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 14,
    backgroundColor: 'rgba(15,11,46,0.95)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  listContent: {
    padding: 16,
    paddingBottom: 120,
  },
  // Stage 6 follow-up (infinite-scroll): footer slot below the last
  // SeekQuestionCard. Renders an ActivityIndicator while loadMore
  // is in flight; null otherwise (FlatList collapses it). The 20px
  // padding gives the spinner some breathing room above the FAB.
  footerLoader: {
    paddingVertical: 20,
    alignItems: 'center',
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
  emptyText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 12,
  },
  emptySub: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 12,
    marginTop: 2,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 100,
    width: 56,
    height: 56,
    borderRadius: 28,
    // Stage 6.PinkPalette: purple -> pink (matches PhasePublishing
    // Transform, PhaseRecording pause button, Insight button on My
    // Logs rows, Study Mode Start button).
    backgroundColor: '#EC4899',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#A855F7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#1a1640',
    paddingTop: 12,
    paddingBottom: 40,
    paddingHorizontal: 8,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  sheetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 18,
    paddingHorizontal: 20,
  },
  sheetBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  sheetDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginHorizontal: 20,
  },
});
