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
  Dimensions,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Carousel, {
  type ICarouselInstance,
} from 'react-native-reanimated-carousel';
import { useSharedValue } from 'react-native-reanimated';

import { BurstConfetti } from '@/components/growth/burst-confetti';
import { ExpBanner } from '@/components/growth/exp-banner';
import { FocusModeCard } from '@/components/growth/focus-mode-card';
import { PagerTabBar } from '@/components/ui/pager-tab-bar';
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
  getDailyTasksLastFetchedAtMs,
  type DailyTask,
} from '@/lib/daily-tasks-api';
import { getExpNeeded } from '@novame/core';
import {
  fetchWisdomsWithCache,
  getCachedWisdoms,
  type WisdomLog,
} from '@/lib/wisdoms-api';
import { WisdomLogRow } from '@/components/growth/wisdom-log-row';
import { supabase } from '@/lib/supabase';
import { haptics } from '@/lib/haptics';
import {
  incrementTaskCompletionCount,
  getTaskCompletionCount,
} from '@/lib/task-completion-count';
import { getPublishCount } from '@/lib/publish-count';
import {
  shouldShowRatingPrompt,
  markRatingPromptShown,
  emitRatingPromptRequest,
} from '@/lib/rating-prompt';
import { getCachedSubscriptionTier } from '@/lib/subscription';
import { storage as growthStorage } from '@/lib/storage';

// New design figure 1: hero illustration (samurai + black cat) sits to
// the right of the "Finish Your Tasks to Power Up Your Pal and Yourself!"
// title on the purple top section.
const CHARACTERS_IMAGE_SOURCE = require('../../../assets/images/growth/characters.png');

type SubTab = 'tasks' | 'logs';

const SCREEN_W = Dimensions.get('window').width;

// Cached hero-block height per screen width, so a cold start can paint the
// correct purple/dark split on the very first frame instead of flashing the
// dark root bg before content mounts. Measured via onLayout, persisted to
// MMKV (survives process kill). First-ever launch (no cache) falls back to
// an estimate; every cold start after that is pixel-accurate.
const HERO_H_KEY = `growth_hero_h_${Math.round(SCREEN_W)}`;
function getCachedHeroHeight(): number | null {
  const raw = growthStorage.getString(HERO_H_KEY);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function setCachedHeroHeight(h: number): void {
  growthStorage.set(HERO_H_KEY, String(Math.round(h)));
}

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

  // Carousel control: ref for tap-driven scrollTo, sharedValue for the
  // tab-bar underline slide animation. Carousel v4.x accepts the
  // SharedValue directly via onProgressChange (no JS callback hop).
  // See assets.tsx for the symmetric implementation.
  const carouselRef = useRef<ICarouselInstance>(null);
  const scrollProgress = useSharedValue(0);

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

  // ---- 2s cache reactivity poll (Stage 5.WR.2 instant-default) ----
  //
  // Mirrors the pattern in (tabs)/index.tsx and me.tsx: signing-in.tsx
  // writes default character state and fires fetchCharacterState in
  // the background. When the fetch resolves we want this tab to
  // observe the change without requiring a tab switch / focus event.
  useEffect(() => {
    const interval = setInterval(() => {
      const next = getCachedCharacterState();
      if (next && next.wpLastFetchedAtMs !== charState?.wpLastFetchedAtMs) {
        setCharState(next);
        setWpVisual(next.wp);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [charState]);

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
      // Gap B (Stage 6 Wisdom Insight series): in-process midnight
      // rollover detection. Every 60s tick checks whether the cached
      // daily-tasks fetch happened on a different LOCAL day than now.
      // If yes, the user has crossed midnight while the app stayed
      // open (a foreground 30+ min triggers Gap A's refreshAllCaches
      // and covers this too, but a user actively using the app
      // through midnight would never background long enough). Calls
      // refreshTasks (local function -- fetches + setRows) instead
      // of refreshDailyTasks (lib helper, fire-and-forget without
      // setState), so the new daily_love appears in the UI within
      // ~60s of midnight.
      refreshTickRef.current = setInterval(() => {
        // NOTE: intentionally NOT calling refreshChar() here. While the
        // user sits on this screen the EXP bar is optimistic-driven; a
        // periodic character-state fetch could land mid-animation and
        // rewind the bar. charState is reconciled on focus (entry) and
        // on blur (exit) instead. This interval only handles the midnight
        // daily-tasks rollover.
        const lastMs = getDailyTasksLastFetchedAtMs();
        if (lastMs !== null) {
          const lastDate = new Date(lastMs);
          const nowDate = new Date();
          const sameDay =
            lastDate.getFullYear() === nowDate.getFullYear() &&
            lastDate.getMonth() === nowDate.getMonth() &&
            lastDate.getDate() === nowDate.getDate();
          if (!sameDay) {
            void refreshTasks();
          }
        }
      }, 60_000);
      return () => {
        if (refreshTickRef.current) {
          clearInterval(refreshTickRef.current);
          refreshTickRef.current = null;
        }
        // Silent reconcile on leave: the user no longer sees the EXP bar,
        // so pulling authoritative character-state here corrects any drift
        // between the optimistic value and the server total without a
        // visible rewind. Next entry's focus refreshChar shows truth.
        void refreshChar();
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
        'WP: 0%',
        'Share a passing thought or a moment from your day to recharge and unlock Study Mode again.',
      );
      return;
    }
    void haptics.light();
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
    // Stage 6: payload no longer carries score (the score ring is gone
    // from the redesigned InsightView). cardCollection and aspireImpact
    // are also not serialized -- the wisdom-insight modal sets them to
    // null because "just unlocked" / "current aspire score" semantics
    // don't apply when re-reading a historical wisdom.
    const payload = encodeURIComponent(
      JSON.stringify({
        card: w.card,
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
    void haptics.medium();
    if (!userId) return;
    const target = rows.find((r) => r.task.id === taskId);
    if (!target || target.completing) return;

    // Phase 1: brief green-checkmark flash on the row itself (200ms).
    setRows((prev) =>
      prev.map((r) => (r.task.id === taskId ? { ...r, completing: true } : r)),
    );

    // Optimistic EXP increment using shared @novame/core formula so the bar
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
      // EXP bar is driven PURELY by the optimistic update above while the
      // user is on this screen — we deliberately do NOT reconcile from the
      // server here. Reconciling per-completion (whether via this response
      // or a separate fetch) makes the bar jitter/rewind under rapid taps:
      // responses arrive out of order, each carrying an intermediate
      // server snapshot, and every setState re-drives the bar animation.
      // Since the EXP reward is a fixed constant and the optimistic math
      // uses the same @novame/core formula as the server, the optimistic
      // value is authoritative-equivalent. Server truth is reconciled
      // silently on blur (see useFocusEffect cleanup) when the bar is off
      // screen, so any drift corrects without a visible rewind.
      // result.* is still used above for the EXP / level-up toasts.

      // Stage 6.RatingPrompt: increment lifetime task completion
      // counter + check if we should surface the rating prompt.
      // For subscribed users, completing 10/50/100 tasks is a
      // strong engagement signal independent of publish quota.
      // shouldShowRatingPrompt internally gates on subscription
      // status, cooldown, and prior expression -- safe to call
      // unconditionally on every successful task completion.
      incrementTaskCompletionCount();
      const publishCount = getPublishCount();
      const taskCompletionCount = getTaskCompletionCount();
      const isSubscribed = getCachedSubscriptionTier() !== 'free';
      if (
        shouldShowRatingPrompt({
          publishCount,
          taskCompletionCount,
          isSubscribed,
        })
      ) {
        markRatingPromptShown();
        // Delay so the EXP toast (+confetti burst on screen) has
        // a moment to register before the sheet covers the lower
        // half. 1.2s = roughly when the confetti has finished and
        // toast has begun to fade.
        setTimeout(() => {
          emitRatingPromptRequest();
        }, 1200);
      }
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

  // Carousel needs an explicit height. Compute available vertical
  // space: screen height minus top safe area, sub-tab header,
  // and bottom tab bar.
  //
  // Bottom tab bar real height (see bottom-tab-bar.tsx):
  //   row.height: 56
  //   borderTopWidth: 1
  //   paddingBottom: insets.bottom (home indicator safe area, 34
  //                                  on iPhone 13 Pro Max, 0 on SE)
  // Total = 56 + 1 + insets.bottom
  //
  // Previously the bottomTab height was hard-coded to 90, which
  // missed the 1px borderTopWidth -- the resulting 1px gap between
  // Carousel bottom and BottomTab top exposed the purple root,
  // showing as a thin purple line above the tab bar across both
  // sub-tabs (since root bg is purple).
  const screenH = Dimensions.get('window').height;
  const headerH = 56;
  const bottomTabH = 56 + 1 + insets.bottom;
  const carouselHeight = screenH - insets.top - headerH - bottomTabH;

  // Cold-start anti-flash: a two-tone backdrop (purple hero region on top,
  // dark task region below) painted UNDER the Carousel, so before content
  // mounts the user sees the correct page colors instead of the dark root
  // bg flashing through. The split sits at the bottom of the hero block.
  // Hero height is fixed for a given screen (fixed content: title + art +
  // Lv card + Focus Mode card), so we measure it once via onLayout and
  // cache it in MMKV; subsequent cold starts paint the exact split on the
  // first frame. First-ever launch falls back to ~42% of screen height.
  const [heroH, setHeroH] = useState<number>(
    () => getCachedHeroHeight() ?? Math.round(screenH * 0.42),
  );

  return (
    <View style={styles.root}>
      {/* Cold-start two-tone backdrop (under everything, no touch). Purple
          from the top down to the hero's bottom edge, dark below — matching
          the final layout's color split so a cold start never flashes the
          dark root bg before the Carousel content mounts. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={{ height: insets.top + headerH + heroH, backgroundColor: '#7C3AED' }} />
        <View style={{ flex: 1, backgroundColor: '#1A0F3D' }} />
      </View>
      {/* Status bar area: purple, matches segHeader. Sized to the top
          safe-area inset so it covers exactly the status bar region. */}
      <View style={[styles.statusBarBg, { height: insets.top }]} />
      {/* Sub-tab segmented header */}
      <View style={styles.segHeader}>
        <PagerTabBar
          tabs={['My Quests', 'My Logs']}
          scrollProgress={scrollProgress}
          activeIndex={subTab === 'tasks' ? 0 : 1}
          onTabPress={(i) => {
            const next: SubTab = i === 0 ? 'tasks' : 'logs';
            setSubTab(next);
            carouselRef.current?.scrollTo({ index: i, animated: true });
          }}
        />
      </View>

      <Carousel
        ref={carouselRef}
        loop={false}
        width={SCREEN_W}
        height={carouselHeight}
        data={[0, 1]}
        defaultIndex={subTab === 'tasks' ? 0 : 1}
        onProgressChange={scrollProgress}
        onSnapToItem={(idx) => {
          const next: SubTab = idx === 0 ? 'tasks' : 'logs';
          if (next !== subTab) setSubTab(next);
        }}
        onConfigurePanGesture={(panGesture) => {
          'worklet';
          panGesture.activeOffsetX([-10, 10]);
          panGesture.failOffsetY([-5, 5]);
        }}
        renderItem={({ index }) =>
          index === 0 ? (
            <View style={styles.myLogsPurpleBackdrop}>
              {/* Bottom-anchored dark overlay -- layered design pattern
                  for "purple top + dark bottom from any height" without
                  size math. The overlay sits below the ScrollView in
                  z-order (it's rendered first). ScrollView content has
                  its own purple hero + dark tasksBlock bg; the overlay
                  fills any gap between the last task and the bottom
                  tab bar, plus catches the bottom bounce area.
                  Root bg (purple) handles the top bounce area. */}
              <View
                style={styles.bottomDarkOverlay}
                pointerEvents="none"
              />
              <ScrollView
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
              >
              {/* Purple hero block -- "Finish Your Tasks to Power Up Your Pal
                  and Yourself!" title + characters illustration + Lv card +
                  Focus Mode card. Background is loading-page purple #7C3AED. */}
              <View
                style={styles.heroBlock}
                onLayout={(e) => {
                  const h = e.nativeEvent.layout.height;
                  if (h > 0 && Math.abs(h - heroH) > 1) {
                    setHeroH(h);
                    setCachedHeroHeight(h);
                  }
                }}
              >
                <View style={styles.heroTitleRow}>
                  <Text style={styles.heroTitle}>
                    Finish Your Daily Quests to Power Up with Your Pal!
                  </Text>
                  <Image
                    source={CHARACTERS_IMAGE_SOURCE}
                    style={styles.heroIllustration}
                    resizeMode="contain"
                  />
                </View>
                <ExpBanner level={level} expCurrent={expCurrent} expNeeded={expNeeded} />
                <FocusModeCard
                  mode={mode}
                  wp={wpVisual}
                  busy={switchingMode}
                  onStart={onStartFocus}
                />
              </View>
              <View style={styles.tasksBlock}>
                <Text style={styles.tasksHeader}>Growth Quests</Text>
                {tasksLoading ? (
                  <View style={styles.tasksLoading}>
                    <ActivityIndicator size="small" color="#A855F7" />
                  </View>
                ) : rows.length === 0 ? (
                  <View style={styles.tasksEmpty}>
                    <MaterialIcons name="check-circle" size={42} color="rgba(255,255,255,0.18)" />
                    <Text style={styles.tasksEmptyTitle}>All caught up</Text>
                    <Text style={styles.tasksEmptySub}>
                      Share a moment to unlock more quests.
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
              </ScrollView>
            </View>
          ) : (
            <View style={styles.myLogsPurpleBackdrop}>
              <ScrollView
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
              >
              <View style={styles.logsBlock}>
                {logsLoading && !logsLoaded ? (
                  <View style={styles.logsCenter}>
                    <ActivityIndicator size="small" color="#A855F7" />
                  </View>
                ) : logs.length === 0 ? (
                  <View style={styles.logsEmpty}>
                    <MaterialIcons name="auto-awesome" size={42} color="rgba(255,255,255,0.18)" />
                    <Text style={styles.logsEmptyTitle}>Nothing shared yet</Text>
                    <Text style={styles.logsEmptySub}>
                      Tap the mic to share your first moment
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
              </ScrollView>
            </View>
          )
        }
      />

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
    // Dark bg matches BottomTabBar's #0A0A0F. The 1px subpixel gap
    // between root and BottomTabBar (RN iOS layout rounding) now
    // shows the same dark color as the tab bar -- visually invisible.
    // The purple top region is provided by statusBarBg + segHeader +
    // hero block (each with their own purple bg), so the user never
    // sees the dark root color at the top.
    backgroundColor: '#0A0A0F',
  },
  // Purple status-bar overlay: covers the top safe-area inset region
  // so the dark root color is never visible above the segHeader.
  // Height is set inline from useSafeAreaInsets().top.
  statusBarBg: {
    backgroundColor: '#7C3AED',
  },
  // My Logs needs purple body bg since root is no longer purple.
  myLogsPurpleBackdrop: {
    flex: 1,
    backgroundColor: '#7C3AED',
  },
  // Layered overlay pattern:
  //   tabPane: full-flex container, transparent (lets root's purple
  //            show through during top bounce + as default).
  //   bottomDarkOverlay: absolute-positioned dark fill anchored to
  //            the bottom of tabPane. Catches any space below
  //            ScrollView content + the bottom bounce area.
  //   ScrollView (sibling, rendered after) sits on top with its
  //            own hero (purple) + tasksBlock (dark) backgrounds.
  // Result: purple at top, dark at bottom, automatically, without
  //         any size math or onLayout measurements.
  tabPane: {
    flex: 1,
  },
  bottomDarkOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    // 70% screen-height is a generous cushion: even on small phones
    // it covers the bottom-tab region + below any reasonable task
    // list, while on big phones it stays well below the hero. The
    // ScrollView's own dark tasksBlock paints over this overlay,
    // so the actual visible boundary is dictated by content, not
    // by this height value.
    height: '70%',
    backgroundColor: '#1A0F3D',
  },
  segHeader: {
    paddingHorizontal: 24,
    paddingTop: 8,
    backgroundColor: '#7C3AED',
  },
  scrollContent: {
    // Method C: backdrop View behind ScrollView provides the bottom
    // color fill. ScrollView content just stacks intrinsically; no
    // flexGrow + no paddingBottom needed -- the wrapping View
    // (myTasksContainer or myLogsContainer) handles all the "fill
    // to bottom" responsibility.
  },
  // Purple hero block. Height is intrinsic (driven by the title
  // wrap + illustration + Lv card + Focus Mode card). On any screen
  // size this just naturally takes the space it needs.
  heroBlock: {
    backgroundColor: '#7C3AED',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 18,
  },
  heroTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginBottom: 18,
    gap: 12,
  },
  heroTitle: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: '800',
    lineHeight: 26,
  },
  heroIllustration: {
    width: 130,
    height: 130,
  },
  tasksBlock: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 140,
    marginTop: 0,
    // Dark bg here paints over the bottom overlay starting from the
    // end of the hero block (no gap between hero and tasks). The
    // bottom overlay then continues the dark color past the last
    // task all the way down.
    backgroundColor: '#1A0F3D',
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
    paddingBottom: 140,
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
