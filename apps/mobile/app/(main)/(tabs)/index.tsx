import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';

import { VideoCharacter } from '@/components/main/video-character';
import {
  applyLocalWPDecay,
  fetchCharacterState,
  getCachedCharacterState,
  type CachedCharacterState,
} from '@/lib/character-state';
import { fetchSubscriptionTier } from '@/lib/subscription';
import { fetchMeStats } from '@/lib/me-stats';
import {
  getCharacterState,
  pickSpeechBubble,
  WP_HUNGER_THRESHOLD,
} from '@/lib/constants';
import { getCurrentSession } from '@/lib/auth';
import { haptics } from '@/lib/haptics';

/**
 * Home tab — the central NovaMe experience.
 *
 * Visual structure (1:1 mirror of old Capacitor HomeView, simplified per
 * Q-3.6-F = simplified background + Q-3.6-G = no skin-unlock / weekly
 * report business yet — those land in stage 3.10):
 *
 *   ┌──────────────────────────────────────┐
 *   │  ☰   bg-night.webp           🐾 📄 🏆│  Top bar (4 round buttons)
 *   │                                      │
 *   │       "Just chilling and growing..."  │  Speech bubble
 *   │              ▼                       │
 *   │     ┌─────────────────────┐          │
 *   │     │   VideoCharacter    │          │  Animated companion
 *   │     │   (10:9 aspect)     │          │
 *   │     └─────────────────────┘          │
 *   │                                      │
 *   │  ┌─Willpower─┐  ┌──EXP──┐            │
 *   │  │ 70/100 WP │  │ Lv.5  │            │  Progress bars
 *   │  │ ████░░░   │  │ ███░  │            │
 *   │  └───────────┘  └───────┘            │
 *   └──────────────────────────────────────┘
 *
 * Data flow:
 *   1. Mount → instant render from MMKV cache (no flash).
 *   2. Background fetchCharacterState() → server source of truth.
 *   3. Every 60s → background re-fetch.
 *   4. Every 30s → local WP visual decay tick (smooth bar).
 *
 * Interactions wired in 3.6:
 *   - Hamburger → /(main)/(modals)/me
 *   - Mic (in BottomTabBar) → /(main)/(modals)/record
 *
 * Interactions placeholder (filled in stage 3.10):
 *   - Skin button (paw icon) → skin-select modal + NewSkinUnlock popup
 *   - Weekly Report icon → wisdom-center API + weekly-report modal
 *   - Leaderboard → ranking modal
 *
 * Returning a no-op press handler for these placeholder buttons keeps
 * the layout / accessibility correct without committing to the wiring.
 */
export default function HomeTab() {
  const router = useRouter();

  // ---- State, initialized from MMKV cache so first render has no flash ----

  const [cachedState, setCachedState] = useState<CachedCharacterState | null>(
    () => getCachedCharacterState(),
  );
  const [loading, setLoading] = useState<boolean>(() => getCachedCharacterState() === null);
  const [wpVisual, setWpVisual] = useState<number>(
    () => getCachedCharacterState()?.wp ?? 0,
  );

  const userIdRef = useRef<string | null>(null);

  // ---- Initial fetch + 60s refresh interval ----

  // Re-sync cached state when the home tab regains focus. Modal overlays
  // like skin-select mutate the MMKV cache via switchOutfit() but do
  // not push to home tab's local state directly. Reading cache on focus
  // gives the user immediate visual feedback (new outfit) the moment
  // they close the modal, without depending on a tab switch / cold
  // re-mount to refresh.
  useFocusEffect(
    useCallback(() => {
      const fresh = getCachedCharacterState();
      if (fresh) setCachedState(fresh);
    }, []),
  );

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const session = await getCurrentSession();
      if (cancelled) return;
      if (!session?.user?.id) {
        setLoading(false);
        return;
      }
      userIdRef.current = session.user.id;
      try {
        const next = await fetchCharacterState(session.user.id);
        // Subscription tier is fetched in parallel — same authoritative
        // data trigger as character-state. Errors are swallowed because the
        // app degrades gracefully to cached tier (or "free" default).
        void fetchSubscriptionTier(session.user.id).catch(() => {});
        // Me-page stats prewarm — runs ~1.5s after Tier 1 loaders so it
        // never competes with the visible Home UI for bandwidth. The
        // user is unlikely to tap the hamburger within 1.5s of seeing
        // the home screen, so by the time they do open Me the cache is
        // hot and the modal renders instantly. Failure is silent — Me
        // shows "--" placeholders, every other section still works.
        const meStatsUserId = session.user.id;
        setTimeout(() => {
          if (cancelled) return;
          void fetchMeStats(meStatsUserId).catch(() => {});
        }, 1500);
        if (cancelled) return;
        setCachedState(next);
        setWpVisual(next.wp);
      } catch {
        // Network error is non-fatal — keep showing cached state.
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    refresh();
    const id = setInterval(refresh, 60000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // ---- Local WP visual decay every 30s ----

  useEffect(() => {
    if (!cachedState) return;
    const id = setInterval(() => {
      const next = applyLocalWPDecay(
        cachedState.wp,
        cachedState.mode,
        cachedState.wpLastFetchedAtMs,
      );
      setWpVisual(next);
    }, 30000);
    return () => clearInterval(id);
  }, [cachedState]);

  // ---- Speech bubble (regenerated when wp/mode/charName change) ----

  const bubble = useMemo(() => {
    if (!cachedState) return 'Loading...';
    const hasNoWisdoms = false; // wisdoms list integration lands in 3.7+
    return pickSpeechBubble(wpVisual, cachedState.mode, hasNoWisdoms, cachedState.charName);
  }, [cachedState, wpVisual]);

  // ---- Initial loading state ----

  if (loading && !cachedState) {
    return (
      <View style={styles.loadingRoot}>
        <ActivityIndicator size="large" color="#C084FC" />
      </View>
    );
  }

  // ---- Derived render values ----

  const charId = cachedState?.charId ?? 'char-1';
  const outfit = cachedState?.outfit ?? 1;
  const mode = cachedState?.mode ?? 'play';
  const level = cachedState?.level ?? 1;
  const expCurrent = cachedState?.expCurrent ?? 0;
  const expNeeded = cachedState?.expNeeded ?? 20;
  const videoState = getCharacterState(wpVisual, mode);
  const wpInt = Math.round(wpVisual);
  const expPct = expNeeded > 0 ? Math.min((expCurrent / expNeeded) * 100, 100) : 0;
  const wpPct = Math.min(Math.max(wpInt, 0), 100);

  const wpBarColor =
    wpInt <= 0
      ? 'rgba(255,255,255,0.1)'
      : wpInt <= WP_HUNGER_THRESHOLD
      ? '#DC2626'
      : mode === 'study'
      ? '#A855F7'
      : '#34D399';

  const handleMePress = () => {
    void haptics.light();
    router.push('/(main)/(modals)/me');
  };

  const handlePlaceholder = () => {
    // Stage 3.10 will wire these up.
    void haptics.light();
  };

  return (
    <View style={styles.root}>
      <Image
        source={require('@/../assets/images/home/bg-night.webp')}
        style={styles.bg}
        resizeMode="cover"
      />

      <SafeAreaView style={styles.content} edges={['top', 'left', 'right']}>
        {/* Top bar */}
        <View style={styles.topBar}>
          <TopBarButton icon="menu" onPress={handleMePress} />
          <View style={styles.topBarRight}>
            <TopBarButton
              icon="pets"
              onPress={() => router.push('/(main)/(modals)/skin-select')}
            />
            <TopBarButton
              icon="description"
              onPress={() => router.push('/(main)/(modals)/weekly-report')}
            />
            <TopBarButton
              icon="emoji-events"
              onPress={() => router.push('/(main)/(modals)/ranking')}
            />
            {/* Stage 3.8.1 DEV: reanimated v4 smoke test entry — DELETE before commit */}
          </View>
        </View>

        {/* Spacer */}
        <View style={styles.flexSpacer} />

        {/* Speech bubble */}
        <View style={styles.bubbleWrap}>
          <View style={styles.bubble}>
            <Text style={styles.bubbleText}>{`"${bubble}"`}</Text>
            <View style={styles.bubbleTail} />
          </View>
        </View>

        {/* Video */}
        <View style={styles.videoWrap}>
          <View style={styles.videoFrame}>
            <VideoCharacter characterId={charId} outfit={outfit} state={videoState} />
          </View>
        </View>

        {/* Progress bars (WP + EXP) */}
        <View style={styles.barsWrap}>
          <View style={styles.barCard}>
            <View style={styles.barHeader}>
              <Text style={styles.barLabel}>Willpower</Text>
              {mode === 'study' && wpInt > 0 ? (
                <Text style={styles.modeStudy}>Study</Text>
              ) : null}
              {mode === 'play' && wpInt > 0 ? (
                <Text style={styles.modePlay}>Chill</Text>
              ) : null}
            </View>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${wpPct}%`, backgroundColor: wpBarColor }]} />
            </View>
            <Text style={styles.barFooter}>{wpInt} / 100 WP</Text>
          </View>

          <View style={styles.barCard}>
            <View style={styles.barHeader}>
              <Text style={styles.barLabel}>EXP</Text>
              <Text style={styles.barLevel}>Lv.{level}</Text>
            </View>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${expPct}%`, backgroundColor: '#FBBF24' }]} />
            </View>
            <Text style={styles.barFooter}>
              {expCurrent} / {expNeeded}xp
            </Text>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

// ---- TopBarButton subcomponent ----

type IconName = keyof typeof MaterialIcons.glyphMap;

function TopBarButton({ icon, onPress }: { icon: IconName; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.topBarBtn}>
      <MaterialIcons name={icon} size={18} color="#FFFFFF" />
    </Pressable>
  );
}

// ---- styles ----

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0F0B2E',
  },
  loadingRoot: {
    flex: 1,
    backgroundColor: '#0F0B2E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bg: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },
  content: {
    flex: 1,
  },
  // Top bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 4,
  },
  topBarRight: {
    flexDirection: 'row',
    gap: 8,
  },
  topBarBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flexSpacer: {
    flex: 1,
    minHeight: 0,
  },
  // Speech bubble
  bubbleWrap: {
    paddingHorizontal: 16,
    marginBottom: 12,
    alignItems: 'center',
  },
  bubble: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 16,
    position: 'relative',
  },
  bubbleText: {
    color: '#1F2937',
    fontSize: 13,
    lineHeight: 18,
    fontFamily: 'Inter_600SemiBold',
    textAlign: 'center',
  },
  bubbleTail: {
    position: 'absolute',
    bottom: -6,
    left: '50%',
    marginLeft: -6,
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: 'rgba(255,255,255,0.92)',
  },
  // Video
  videoWrap: {
    paddingHorizontal: 16,
    marginBottom: 32,
  },
  videoFrame: {
    width: '100%',
    aspectRatio: 10 / 9,
    backgroundColor: 'transparent',
    borderRadius: 16,
    overflow: 'hidden',
  },
  // Progress bars
  barsWrap: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  barCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 16,
    padding: 12,
  },
  barHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  barLabel: {
    color: '#FFFFFF',
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  modeStudy: {
    color: '#FCD34D',
    fontSize: 8,
    fontFamily: 'Inter_700Bold',
  },
  modePlay: {
    color: '#86EFAC',
    fontSize: 8,
    fontFamily: 'Inter_700Bold',
  },
  barLevel: {
    color: '#C084FC',
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
  },
  barTrack: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
    marginBottom: 6,
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
  },
  barFooter: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
