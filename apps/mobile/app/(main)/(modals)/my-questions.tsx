/**
 * My Questions — Stage 3.9.A.1.5
 *
 * Lists all questions submitted by the current user, with status
 * badges and rejection reasons (when applicable).
 *
 * Statuses (per server seek_questions table):
 *   - pending           : awaiting admin review (yellow)
 *   - approved+published: live in Discover (green)
 *   - rejected          : declined by admin (red, shows reason)
 *
 * "approved + not yet published" is not a real state — admin approval
 * publishes immediately.
 *
 * Data:
 *   GET /api/user-questions?userId=X
 *     -> { questions: { id, question_text, status, is_published,
 *                       card_count, created_at, rejection_reason }[] }
 *
 * Note: rejection_reason was added to the SELECT in stage 3.9.A.1.5.
 * Until the apps/api deploy lands, rejected items will show the
 * generic "Rejected" badge without a reason. Once the server returns
 * the field, the reason block surfaces automatically.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { apiClient } from '@/lib/api';
import { supabase } from '@/lib/supabase';

type MyQuestionStatus = 'pending' | 'approved' | 'rejected';

type MyQuestion = {
  id: string;
  question_text: string;
  status: MyQuestionStatus;
  is_published: boolean;
  card_count: number;
  created_at: string;
  rejection_reason: string | null;
};

type FetchResp = { questions?: MyQuestion[] };

type DerivedState = 'pending' | 'live' | 'rejected';

function deriveState(q: MyQuestion): DerivedState {
  if (q.status === 'rejected') return 'rejected';
  if (q.status === 'approved' && q.is_published) return 'live';
  return 'pending';
}

type StateMeta = {
  label: string;
  bg: string;
  fg: string;
  icon: keyof typeof MaterialIcons.glyphMap;
};

const STATE_META: Record<DerivedState, StateMeta> = {
  pending: {
    label: 'Awaiting review',
    bg: 'rgba(251,191,36,0.18)',
    fg: '#FCD34D',
    icon: 'hourglass-empty',
  },
  live: {
    label: 'Live in Discover',
    bg: 'rgba(34,197,94,0.18)',
    fg: '#86EFAC',
    icon: 'check-circle',
  },
  rejected: {
    label: 'Rejected',
    bg: 'rgba(239,68,68,0.18)',
    fg: '#FCA5A5',
    icon: 'cancel',
  },
};

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
}

export default function MyQuestionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [questions, setQuestions] = useState<MyQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'initial') setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) {
        setError('Please sign in first');
        return;
      }
      const data = await apiClient.get<FetchResp>(
        `/api/user-questions?userId=${encodeURIComponent(userId)}`,
      );
      setQuestions(data.questions ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load questions');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load('initial');
  }, [load]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={22} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.topTitle}>My Questions</Text>
        <View style={styles.topBarSpacer} />
      </View>

      {/* Body */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#A855F7" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <MaterialIcons name="cloud-off" size={48} color="rgba(255,255,255,0.25)" />
          <Text style={styles.errorTitle}>Couldn{'\u2019'}t load questions</Text>
          <Text style={styles.errorSub}>{error}</Text>
          <Pressable onPress={() => void load('initial')} style={styles.retryBtn}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : questions.length === 0 ? (
        <View style={styles.center}>
          <MaterialIcons name="inbox" size={48} color="rgba(255,255,255,0.18)" />
          <Text style={styles.emptyTitle}>No questions yet</Text>
          <Text style={styles.emptySub}>
            Your submitted questions will appear here for tracking.
          </Text>
        </View>
      ) : (
        <FlatList
          data={questions}
          keyExtractor={(q) => q.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => <QuestionRow q={item} />}
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
    </View>
  );
}

function QuestionRow({ q }: { q: MyQuestion }) {
  const state = deriveState(q);
  const meta = STATE_META[state];
  const showReason = state === 'rejected' && !!q.rejection_reason && q.rejection_reason.trim().length > 0;

  return (
    <View style={styles.card}>
      {/* Status badge + date */}
      <View style={styles.cardHeader}>
        <View style={[styles.badge, { backgroundColor: meta.bg }]}>
          <MaterialIcons name={meta.icon} size={13} color={meta.fg} />
          <Text style={[styles.badgeText, { color: meta.fg }]}>{meta.label}</Text>
        </View>
        <Text style={styles.cardDate}>{formatDate(q.created_at)}</Text>
      </View>

      {/* Question text */}
      <Text style={styles.cardQuestion}>{q.question_text}</Text>

      {/* Footer:
         - live   -> wisdom count
         - rejected with reason -> reason block
         - pending -> nothing extra
      */}
      {state === 'live' ? (
        <View style={styles.cardFooter}>
          <MaterialIcons name="chat-bubble-outline" size={13} color="rgba(255,255,255,0.45)" />
          <Text style={styles.cardCount}>
            {q.card_count} {q.card_count === 1 ? 'wisdom offered' : 'wisdoms offered'}
          </Text>
        </View>
      ) : null}

      {showReason ? (
        <View style={styles.reasonBlock}>
          <Text style={styles.reasonLabel}>Reason</Text>
          <Text style={styles.reasonText}>{q.rejection_reason}</Text>
        </View>
      ) : null}
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
  emptyTitle: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 15,
    fontWeight: '600',
    marginTop: 12,
  },
  emptySub: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 18,
  },
  listContent: {
    padding: 16,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  cardDate: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 11,
    fontWeight: '500',
  },
  cardQuestion: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 21,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  cardCount: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    fontWeight: '500',
  },
  reasonBlock: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(239,68,68,0.18)',
  },
  reasonLabel: {
    color: '#FCA5A5',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  reasonText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    lineHeight: 19,
  },
});
