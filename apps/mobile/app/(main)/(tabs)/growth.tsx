/**
 * Growth tab — Stage 3.9.A.2.3
 *
 * Stage 3.9.A.2.2 wired character-state cache + Focus Mode switch.
 * 3.9.A.2.3 wires daily-tasks API:
 *   - GET on focus
 *   - tap task -> optimistic complete + in-row confetti +
 *     top toast (+EXP gained) + level-up toast if applicable
 *   - re-fetch character-state to refresh EXP banner
 *
 * 3.9.A.2.4 wires My Logs. 3.9.A.2.5 wires study-claim modal.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BurstConfetti } from '@/components/growth/burst-confetti';
import { ExpBanner } from '@/components/growth/exp-banner';
import { FocusModeCard } from '@/components/growth/focus-mode-card';
import { Toast, type ToastVariant } from '@/components/ui/toast';
import {
  applyLocalWPDecay,
  fetchCharacterState,
  getCachedCharacterState,
  switchMode,
  type CachedCharacterState,
} from '@/lib/character-state';
import {
  completeDailyTask,
  fetchDailyTasks,
  fetchDailyTasksWithCache,
  getCachedDailyTasks,
  type DailyTask,
} from '@/lib/daily-tasks-api';
import { getExpNeeded } from '@/lib/exp-formula';
import {
  fetchWisdomsWithCache,
  getCachedWisdoms,
  type WisdomLog,
} from '@/lib/wisdoms-api';
import { WisdomLogRow } from '@/components/growth/wisdom-log-row';
import { supabase } from '@/lib/supabase';

type SubTab = 'tasks' | 'logs';

// Per-row UI flags layered on top of the server task data so we can
// drive the optimistic complete -> confetti -> remove animation
// without mutating the server response shape.
type RowState = {
  task: DailyTask;
  completing: boolean;   // confetti + checkmark visible, awaiting fade-out
};

// Row green-flash hold before disappearing. Confetti continues in a
// floating overlay so the burst plays to completion even after the
// row vanishes from the list.
const ROW_GREEN_FLASH_MS = 200;
const CONFETTI_DURATION_MS = 1000;

export default function GrowthTab() {
  const insets = useSafeAreaInsets();
  const [subTab, setSubTab] = useState<SubTab>('tasks');

  const [charState, setCharState] = useState<CachedCharacterState | null>(
    () => getCachedCharacterState(),
  );
  const [wpVisual, setWpVisual] = useState<number>(charState?.wp ?? 0);
  const [switchingMode, setSwitchingMode] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const [rows, setRows] = useState<RowState[]>(() => {
    // Stage 6 SWR: hydrate from cache so users see last-known tasks
    // instantly on tab switch (no flash of empty state).
    const cached = getCachedDailyTasks();
    return cached
      ? cached.map((t) => ({ task: t, completing: false }))
      : [];
  });
  const [tasksLoading, setTasksLoading] = useState(
    // Stage 6 SWR: only show spinner if no cache exists. Otherwise
    // skip loading state entirely so cache renders instantly.
    () => getCachedDailyTasks() === null,
  );
  // Floating confetti bursts that outlive the task row. Each entry is
  // a unique id; we render an absolute-positioned BurstConfetti per id
  // and clean it up after CONFETTI_DURATION_MS.
  const [floatingBursts, setFloatingBursts] = useState<string[]>([]);

  // === My Logs sub-tab state ===
  const [logs, setLogs] = useState<WisdomLog[]>(() => {
    const cached = getCachedWisdoms();
    return cached?.wisdoms ?? [];
  });
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsLoaded, setLogsLoaded] = useState(() => getCachedWisdoms() !== null);
  const [authorProfile, setAuthorProfile] = useState<{
    display_name: string;
    avatar_url: string | null;
  } | null>(null);
  const [toast, setToast] = useState<{ msg: string; variant: ToastVariant } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const decayTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshTickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user.id ?? null);
    });
  }, []);

  // Fetch the author profile (display_name + avatar_url) once we
  // know who the user is. All wisdom log rows share this since the
  // feed only shows the user's own wisdoms.
  useEffect(() => {
    if (!userId) return;
    void supabase
      .from('profiles')
      .select('display_name, avatar_url')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        if (data) {
          setAuthorProfile({
            display_name: data.display_name ?? 'You',
            avatar_url: data.avatar_url ?? null,
          });
        }
      });
  }, [userId]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const showToast = (msg: string, variant: ToastVariant, holdMs = 2200) => {
    setToast({ msg, variant });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), holdMs);
  };

  // === Character state ===
  // Stage 5.WR.2 (FIFTH pass): refreshChar race-condition guard.
  //
  // When the user taps multiple task completion buttons in quick
  // succession, each tap fires its own onCompleteTask → server POST →
  // refreshChar. Three concurrent refreshChars produce three
  // fetchCharacterState requests that resolve in unpredictable order.
  // Each resolution calls setCharState, which triggers exp-banner's
  // useEffect, which restarts the bar animation from prevTargetRef.
  // The result is the bar jumping between intermediate states the
  // server happens to have written when each fetch read (lv6 30/50
  // → 13/50 → 50/50 → 23/50, observed in user video). Visually this
  // reads as "the level-up animation playing twice."
  //
  // Industry-standard fix per Sebastien Lorber's race-conditions
  // article and the react-async-hook library: tag each refresh with
  // a monotonically increasing sequence number. When a response
  // arrives, only apply it if its seq matches the latest one issued.
  // Older in-flight responses are dropped — their setCharState
  // calls never run. Only the LAST request's data lands in state.
  //
  // AbortController would also work, but is heavier for this use
  // case: we don't need to cancel the HTTP request, only the setState.
  // The seq pattern is the lighter and more common React idiom.
  const refreshCharSeqRef = useRef(0);
  const refreshChar = useCallback(async () => {
    if (!userId) return;
    const seq = ++refreshCharSeqRef.current;
    try {
      const next = await fetchCharacterState(userId);
      // Drop stale response: a newer refreshChar has been issued.
      if (seq !== refreshCharSeqRef.current) return;
      setCharState(next);
      setWpVisual(next.wp);
    } catch (e) {
      // Don't gate the warn on seq — even stale failures are worth
      // logging in case of widespread network issues.
      console.warn('[growth] character-state refresh failed:', e);
    }
  }, [userId]);

  // === Tasks (Stage 6 SWR: cache-first) ===
  // Show cache instantly; fetch silently in background. Only show
  // loading spinner when there is no cache at all (first-ever load).
  const refreshTasks = useCallback(async () => {
    if (!userId) return;
    const cached = getCachedDailyTasks();
    const hasCache = cached !== null;
    if (!hasCache) setTasksLoading(true);
    try {
      const tasks = await fetchDailyTasksWithCache(userId);
      setRows(tasks.map((t) => ({ task: t, completing: false })));
    } catch (e) {
      console.warn('[growth] daily-tasks fetch failed:', e);
      // If we have stale cache, keep showing it; user notices nothing.
      // If no cache, leave loading state false so the empty UI shows.
    } finally {
      if (!hasCache) setTasksLoading(false);
    }
  }, [userId]);

  // Stage 6 SWR bugfix: useFocusEffect does NOT re-run when its deps
  // change (only on focus/blur). On cold start userId is null on
  // first focus tick, refreshTasks early-returns, and loading state
  // gets stuck at `true` forever. This effect closes the gap by
  // triggering refreshTasks the moment userId resolves.
  useEffect(() => {
    if (!userId) return;
    void refreshTasks();
  }, [userId, refreshTasks]);

  // Stage 6 SWR cache-first. If cache exists -> show instantly,
  // fetch silently. If no cache -> show spinner.
  const refreshLogs = useCallback(async () => {
    if (!userId) return;
    const hasCache = getCachedWisdoms() !== null;
    if (!hasCache) setLogsLoading(true);
    try {
      const res = await fetchWisdomsWithCache(userId, { limit: 30 });
      setLogs(res.wisdoms ?? []);
      setLogsLoaded(true);
    } catch (e) {
      console.warn('[growth] wisdoms fetch failed:', e);
    } finally {
      if (!hasCache) setLogsLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void refreshChar();
      void refreshTasks();
      refreshTickRef.current = setInterval(() => void refreshChar(), 60_000);
      return () => {
        if (refreshTickRef.current) {
          clearInterval(refreshTickRef.current);
          refreshTickRef.current = null;
        }
      };
    }, [refreshChar, refreshTasks]),
  );

  // Fetch logs when the user switches to the My Logs sub-tab.
  // Re-fetch every time so newly published wisdoms appear.
  useEffect(() => {
    if (subTab === 'logs') {
      void refreshLogs();
    }
  }, [subTab, refreshLogs]);

  useEffect(() => {
    if (!charState) return;
    const tick = () => {
      const decayed = applyLocalWPDecay(
        charState.wp,
        charState.mode,
        charState.wpLastFetchedAtMs,
      );
      setWpVisual(decayed);
    };
    tick();
    decayTickRef.current = setInterval(tick, 30_000);
    return () => {
      if (decayTickRef.current) {
        clearInterval(decayTickRef.current);
        decayTickRef.current = null;
      }
    };
  }, [charState]);

  useEffect(() => {
    if (charState?.mode === 'study' && wpVisual <= 0) {
      console.log('[growth] study-mode WP hit zero — claim modal pending (3.9.A.2.5)');
    }
  }, [charState?.mode, wpVisual]);

  const onStartFocus = async () => {
    if (!userId || switchingMode) return;
    if (wpVisual <= 0) {
      Alert.alert(
        'WP empty',
        'Wait for your companion to recover, then start study mode again.',
      );
      return;
    }
    setSwitchingMode(true);
    try {
      const next = await switchMode(userId, 'study');
      setCharState(next);
      setWpVisual(next.wp);
    } catch (e) {
      Alert.alert(
        'Could not start',
        e instanceof Error ? e.message : 'Try again in a moment.',
      );
    } finally {
      setSwitchingMode(false);
    }
  };

  // === Task completion flow ===
  // Industry-standard optimistic flow: the user sees the row vanish
  // and the EXP bar start filling immediately, before the server
  // round-trip completes. Server response then reconciles the level
  // (in case the optimistic exp pushed past a level boundary).
  // Logs sub-tab handlers. Read/Insight modals land in stage 3.10;
  // for now we just acknowledge the tap so the user knows it
  // registered and the buttons aren't dead.
  // Navigate to the Read modal with the wisdom payload encoded in
  // the URL. We use encodeURIComponent(JSON.stringify(...)) since
  // Hermes' btoa is not Unicode-safe (some user transcripts contain
  // non-ASCII characters).
  const onLogRead = (id: string) => {
    const w = logs.find((x) => x.id === id);
    if (!w) return;
    const payload = encodeURIComponent(
      JSON.stringify({
        text: w.text ?? '',
        description: w.description ?? null,
        createdAt: w.created_at,
      }),
    );
    router.push(`/(main)/(modals)/wisdom-text?payload=${payload}`);
  };

  const onLogInsight = (id: string) => {
    const w = logs.find((x) => x.id === id);
    if (!w) return;
    const payload = encodeURIComponent(
      JSON.stringify({
        card: w.card,
        score: w.card?.wisdom_score ?? 0,
        emotion: w.card?.wisdom_emotion ?? 'Reflective',
      }),
    );
    router.push(`/(main)/(modals)/wisdom-insight?payload=${payload}`);
  };

  // ... menu — stage 3.10 will surface delete + share options here.
  const onLogMenu = (id: string) => {
    console.log('[growth] onLogMenu', id);
    showToast('Options coming soon', 'info');
  };

  const onCompleteTask = async (taskId: string) => {
    if (!userId) return;
    const target = rows.find((r) => r.task.id === taskId);
    if (!target || target.completing) return;

    // Phase 1: brief green-checkmark flash on the row itself (200ms).
    setRows((prev) =>
      prev.map((r) => (r.task.id === taskId ? { ...r, completing: true } : r)),
    );

    // Optimistic EXP increment using local exp-formula so the bar
    // animates to its new value right away (water-flow effect).
    const reward = target.task.exp_reward;
    setCharState((prev) => {
      if (!prev) return prev;
      let newCurrent = prev.expCurrent + reward;
      let newLevel = prev.level;
      let newNeeded = prev.expNeeded;
      while (newCurrent >= newNeeded && newLevel < 99) {
        newCurrent -= newNeeded;
        newLevel += 1;
        newNeeded = getExpNeeded(newLevel);
      }
      return {
        ...prev,
        expCurrent: newCurrent,
        expNeeded: newNeeded,
        level: newLevel,
      };
    });

    // Phase 2: spawn the floating confetti burst immediately so the
    // user sees the burst start the moment they tap (no perceived lag).
    // The row stays visible with its green flash for ROW_GREEN_FLASH_MS
    // before being removed; the confetti runs above it the whole time.
    const burstId = `${taskId}-${Date.now()}`;
    setFloatingBursts((prev) => [...prev, burstId]);
    setTimeout(() => {
      setRows((prev) => prev.filter((r) => r.task.id !== taskId));
    }, ROW_GREEN_FLASH_MS);
    setTimeout(() => {
      setFloatingBursts((prev) => prev.filter((id) => id !== burstId));
    }, CONFETTI_DURATION_MS);

    // Fire-and-await the server. Surface toasts on result; reconcile
    // character-state with authoritative server values afterwards.
    try {
      const result = await completeDailyTask(userId, taskId);
      showToast(`+${result.expGained} EXP`, 'success');
      if (result.leveledUp) {
        setTimeout(() => {
          showToast(`\u{1F389} Level ${result.newLevel} reached!`, 'success', 3000);
        }, 600);
      }
      // Pull authoritative character state from server.
      void refreshChar();
    } catch (e) {
      // Roll back optimistic state on failure.
      setRows((prev) =>
        prev.map((r) => (r.task.id === taskId ? { ...r, completing: false } : r)),
      );
      void refreshChar();
      showToast(
        e instanceof Error ? e.message : 'Could not complete task',
        'error',
      );
    }
  };

  const level = charState?.level ?? 1;
  const expCurrent = charState?.expCurrent ?? 0;
  const expNeeded = charState?.expNeeded ?? 20;
  const mode = charState?.mode ?? 'play';

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Sub-tab segmented header */}
      <View style={styles.segHeader}>
        <Pressable onPress={() => setSubTab('tasks')} style={styles.segBtn}>
          <Text style={[styles.segText, subTab === 'tasks' && styles.segTextActive]}>
            My Tasks
          </Text>
          {subTab === 'tasks' ? <View style={styles.segUnderline} /> : null}
        </Pressable>
        <Pressable onPress={() => setSubTab('logs')} style={styles.segBtn}>
          <Text style={[styles.segText, subTab === 'logs' && styles.segTextActive]}>
            My Logs
          </Text>
          {subTab === 'logs' ? <View style={styles.segUnderline} /> : null}
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {subTab === 'tasks' ? (
          <>
            <ExpBanner level={level} expCurrent={expCurrent} expNeeded={expNeeded} />
            <FocusModeCard
              mode={mode}
              wp={wpVisual}
              busy={switchingMode}
              onStart={onStartFocus}
            />
            <View style={styles.tasksBlock}>
            <Text style={styles.tasksHeader}>Daily Tasks</Text>
            {tasksLoading ? (
              <View style={styles.tasksLoading}>
                <ActivityIndicator size="small" color="#A855F7" />
              </View>
            ) : rows.length === 0 ? (
              <View style={styles.tasksEmpty}>
                <MaterialIcons name="check-circle" size={42} color="rgba(255,255,255,0.18)" />
                <Text style={styles.tasksEmptyTitle}>All caught up</Text>
                <Text style={styles.tasksEmptySub}>
                  Share a wisdom to unlock more tasks
                </Text>
              </View>
            ) : (
              rows.map((r) => (
                <TaskRow
                  key={r.task.id}
                  task={r.task}
                  completing={r.completing}
                  onPress={() => onCompleteTask(r.task.id)}
                />
              ))
            )}
            </View>
          </>
        ) : (
          <View style={styles.logsBlock}>
            {logsLoading && !logsLoaded ? (
              <View style={styles.logsCenter}>
                <ActivityIndicator size="small" color="#A855F7" />
              </View>
            ) : logs.length === 0 ? (
              <View style={styles.logsEmpty}>
                <MaterialIcons name="auto-awesome" size={42} color="rgba(255,255,255,0.18)" />
                <Text style={styles.logsEmptyTitle}>No wisdoms yet</Text>
                <Text style={styles.logsEmptySub}>
                  Tap the mic to share your first one
                </Text>
              </View>
            ) : (
              logs.map((w) => (
                <WisdomLogRow
                  key={w.id}
                  wisdom={w}
                  authorName={authorProfile?.display_name ?? 'You'}
                  authorAvatar={authorProfile?.avatar_url ?? null}
                  onRead={onLogRead}
                  onInsight={onLogInsight}
                  onMenu={onLogMenu}
                />
              ))
            )}
          </View>
        )}
      </ScrollView>

      {/* Floating confetti bursts spawned by completed tasks. They
          sit above the ScrollView so the row vanishing doesn't cut
          them short. */}
      {floatingBursts.length > 0 ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {floatingBursts.map((id) => (
            <BurstConfetti key={id} />
          ))}
        </View>
      ) : null}

      {toast ? <Toast visible={!!toast} message={toast.msg} variant={toast.variant} /> : null}
    </View>
  );
}

function TaskRow({
  task,
  completing,
  onPress,
}: {
  task: DailyTask;
  completing: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={completing}
      style={({ pressed }) => [
        styles.taskRow,
        completing && styles.taskRowCompleting,
        pressed && !completing && { opacity: 0.85 },
      ]}
    >
      <Text style={styles.taskText}>
        {task.task_text}
      </Text>
      <View style={styles.taskRight}>
        <Text style={styles.taskExpText}>+{task.exp_reward}</Text>
        <MaterialIcons name="bolt" size={14} color="#F5B042" />
        <View style={[styles.taskCheck, completing && styles.taskCheckDone]}>
          <MaterialIcons name="check" size={20} color="#FFFFFF" />
        </View>
      </View>

    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#1A0F3D',
  },
  segHeader: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  segBtn: {
    paddingVertical: 12,
    marginRight: 24,
    alignItems: 'flex-start',
  },
  segText: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 22,
    fontWeight: '800',
  },
  segTextActive: {
    color: '#FFFFFF',
  },
  segUnderline: {
    height: 3,
    backgroundColor: '#A855F7',
    borderRadius: 999,
    marginTop: 4,
    width: '100%',
  },
  scrollContent: {
    paddingBottom: 120,
  },
  tasksBlock: {
    paddingHorizontal: 16,
    marginTop: 24,
  },
  tasksHeader: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 12,
  },
  tasksLoading: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  tasksEmpty: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 6,
  },
  tasksEmptyTitle: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 15,
    fontWeight: '600',
    marginTop: 8,
  },
  tasksEmptySub: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 12,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 20,
    marginBottom: 12,
    overflow: 'hidden',
  },
  taskRowCompleting: {
    backgroundColor: '#F3E8FF',
  },
  taskText: {
    color: '#1F1F1F',
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
    marginRight: 12,
    lineHeight: 21,
  },
  taskRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  taskExpText: {
    color: '#A855F7',
    fontSize: 16,
    fontWeight: '800',
  },
  taskCheck: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#A855F7',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  taskCheckDone: {
    backgroundColor: '#22C55E',
  },
  logsBlock: {
    paddingHorizontal: 16,
    marginTop: 24,
  },
  logsCenter: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  logsEmpty: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 40,
  },
  logsEmptyTitle: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 15,
    fontWeight: '600',
    marginTop: 12,
  },
  logsEmptySub: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 12,
  },
});
