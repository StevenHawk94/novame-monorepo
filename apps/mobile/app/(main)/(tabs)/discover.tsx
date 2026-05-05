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
import { useFocusEffect, useRouter } from 'expo-router';

import { apiClient } from '@/lib/api';
import { SeekQuestionCard } from '@/components/seek/seek-question-card';
import type { SeekQuestion } from '@/lib/seek-types';

type FetchResp = { questions?: SeekQuestion[] };

export default function DiscoverTab() {
  const router = useRouter();
  const [questions, setQuestions] = useState<SeekQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fabOpen, setFabOpen] = useState(false);

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'initial') setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const data = await apiClient.get<FetchResp>('/api/seek-questions');
      setQuestions(data.questions ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load questions');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

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
    router.push(`/(main)/(modals)/record?${params.toString()}`);
  };

  const askNew = () => {
    setFabOpen(false);
    router.push('/(main)/(modals)/new-question');
  };

  const myQuestions = () => {
    setFabOpen(false);
    router.push('/(main)/(modals)/my-questions');
  };

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Questions From Community</Text>
        <MaterialIcons name="tune" size={22} color="rgba(255,255,255,0.4)" />
      </View>

      {/* Body */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#A855F7" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <MaterialIcons name="cloud-off" size={48} color="rgba(255,255,255,0.25)" />
          <Text style={styles.errorTitle}>Couldn\'t load questions</Text>
          <Text style={styles.errorSub}>{error}</Text>
          <Pressable onPress={() => void load('initial')} style={styles.retryBtn}>
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
        />
      )}

      {/* FAB */}
      <Pressable onPress={() => setFabOpen(true)} style={styles.fab}>
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
    backgroundColor: '#A855F7',
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
