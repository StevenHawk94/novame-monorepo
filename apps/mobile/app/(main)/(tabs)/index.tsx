import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';

import { requireAiConsent } from '@/lib/ai-consent';
import { haptics } from '@/lib/haptics';
import { hideSplashOnce } from '@/lib/splash';
import { fetchCompanion, getCachedCompanion, type CompanionState } from '@/lib/companion-api';
import { ICONS } from '@/lib/icons';
import { CompanionVideo } from '@/components/main/companion-video';
import { Image as ExpoImage } from 'expo-image';
import { getHomeSceneSource } from '@/lib/scenes';
import {
  advanceDefaultBubble,
  getFreshBubbleState,
  getLaunchDefaultBubble,
  type FreshBubble,
} from '@/lib/bubble-store';
import { useSubscriptionTier } from '@/lib/use-subscription-tier';
import { prefetchAppData } from '@/lib/prefetch';
import { loadTodayBubbles, type MemoryBubble } from '@/lib/home-bubbles';
import { MemoryBubbles } from '@/components/main/memory-bubbles';
import { AnnouncementGate } from '@/components/main/announcement-gate';

/**
 * Home. The companion lives here on a full-screen scene backdrop: a speech
 * bubble above the looping companion video, Focus + Reflect below, the settings
 * menu at top-left, and outfits / scenes / leaderboard at top-right. Tapping the
 * companion opens the interaction sheet with every Kit.
 *
 * The scene image fills the screen anchored to the top (tall screens scale up
 * from center so the bottom still covers; short screens keep the top and crop
 * the bottom). The companion is a transparent looping .mov.
 *
 * hideSplashOnce() must be called by whatever screen renders first, or the
 * native splash never lifts.
 */
function visibleAiBubble(isPaid: boolean): FreshBubble | null {
  // A cached AI line must never leak through after the account becomes Free.
  if (!isPaid) return null;
  return getFreshBubbleState();
}

export default function HomeScreen() {
  const router = useRouter();
  const isPaid = useSubscriptionTier() !== 'free';
  const [companion, setCompanion] = useState<CompanionState | null>(() => getCachedCompanion());
  const [bubbles, setBubbles] = useState<MemoryBubble[]>([]);
  const [, setCosmeticTick] = useState(0);
  const [defaultSpeech, setDefaultSpeech] = useState(getLaunchDefaultBubble);
  const [aiBubble, setAiBubble] = useState<FreshBubble | null>(() => visibleAiBubble(isPaid));
  const aiBubbleRef = useRef(aiBubble);
  const openingEntryRef = useRef(false);
  const [homeLayout, setHomeLayout] = useState({
    safeHeight: 0,
    sceneY: 0,
    videoY: 0,
    videoHeight: 240,
    entriesHeight: 68,
  });
  void companion;

  const applyAiBubble = useCallback((next: FreshBubble | null) => {
    const previous = aiBubbleRef.current;
    aiBubbleRef.current = next;
    setAiBubble(next);
    // Covers both a live timeout and returning from a long background pause.
    if (previous && !next && Date.now() >= previous.expiresAtMs) {
      setDefaultSpeech(advanceDefaultBubble());
    }
  }, []);

  useEffect(() => {
    applyAiBubble(visibleAiBubble(isPaid));
  }, [applyAiBubble, isPaid]);

  // A new Reflect replaces the old AI line and starts a fresh six-hour timer.
  // If the app stays open, expiry switches to the next local-time default line.
  useEffect(() => {
    if (!aiBubble) return;
    const remainingMs = aiBubble.expiresAtMs - Date.now();
    if (remainingMs <= 0) {
      applyAiBubble(null);
      return;
    }
    const timer = setTimeout(() => {
      applyAiBubble(null);
    }, remainingMs);
    return () => clearTimeout(timer);
  }, [aiBubble, applyAiBubble]);

  const onFirstPaint = useCallback(() => {
    hideSplashOnce();
  }, []);

  const recordLayout = useCallback((part: Partial<typeof homeLayout>) => {
    setHomeLayout((current) => {
      const next = { ...current, ...part };
      return Object.keys(part).every((key) => current[key as keyof typeof current] === next[key as keyof typeof next])
        ? current
        : next;
    });
  }, []);

  const onSafeLayout = useCallback((event: LayoutChangeEvent) => {
    onFirstPaint();
    recordLayout({ safeHeight: event.nativeEvent.layout.height });
  }, [onFirstPaint, recordLayout]);

  useFocusEffect(
    useCallback(() => {
      // The previous entry route has fully closed. Re-enable exactly one Home
      // launch; the ref prevents onPressIn + onPress/accessibility from ever
      // stacking duplicate transparent-modal routes.
      openingEntryRef.current = false;
      setCosmeticTick((t) => t + 1);
      applyAiBubble(visibleAiBubble(isPaid));
      void fetchCompanion().then((c) => {
        if (c) setCompanion(c);
      });
      void loadTodayBubbles().then(setBubbles);
      // Warm every tab's cache in the background (throttled) so switching
      // tabs paints instantly instead of cold-loading.
      prefetchAppData();
    }, [applyAiBubble, isPaid]),
  );

  const onBubblePopped = useCallback((bubbleId: string) => {
    setBubbles((prev) => prev.filter((b) => b.id !== bubbleId));
  }, []);

  const onReflect = () => {
    if (openingEntryRef.current) return;
    if (!requireAiConsent('/(main)/reflect')) return;
    openingEntryRef.current = true;
    void haptics.pageOpen();
    router.push('/(main)/reflect');
  };
  const onFocus = () => {
    if (openingEntryRef.current) return;
    openingEntryRef.current = true;
    void haptics.pageOpen();
    router.push('/(main)/focus');
  };
  const onPetTap = () => {
    void haptics.pageOpen();
    router.push('/(main)/companion-sheet');
  };

  const sceneImg = getHomeSceneSource();
  // Short screens (iPhone SE) can't spare 140pt above the companion — scale
  // the gap with the window so the video never crowds Focus/Reflect.
  const { height } = useWindowDimensions();
  const scenePadTop = Math.max(60, Math.round(height * 0.14));
  const videoBottom = homeLayout.sceneY + homeLayout.videoY + homeLayout.videoHeight;
  const availableBelowVideo = Math.max(0, homeLayout.safeHeight - videoBottom);
  const entriesTop = homeLayout.safeHeight > 0
    ? videoBottom + Math.max(0, (availableBelowVideo - homeLayout.entriesHeight) / 2)
    : undefined;

  return (
    <View style={styles.root} onLayout={onFirstPaint}>
      <ExpoImage
        source={sceneImg}
        style={styles.sceneBgImg}
        contentFit="cover"
        cachePolicy="memory-disk"
        priority="high"
      />
      <SafeAreaView style={styles.safe} edges={['top']} onLayout={onSafeLayout}>
        {/* Top bar: menu (left) + outfits / scenes / leaderboard (right) */}
        <View style={styles.topBar}>
          <Pressable onPress={() => { void haptics.pageOpen(); router.push('/(main)/(modals)/me'); }} hitSlop={8}>
            <Image source={ICONS.Menu} style={styles.topIcon} resizeMode="contain" />
          </Pressable>
          <View style={styles.topRight}>
            <Pressable onPress={() => { void haptics.pageOpen(); router.push('/(main)/(modals)/skin-select'); }} hitSlop={8}>
              <Image source={ICONS.Outfits} style={styles.topIcon} resizeMode="contain" />
            </Pressable>
            <Pressable onPress={() => { void haptics.pageOpen(); router.push('/(main)/(modals)/scene-select'); }} hitSlop={8}>
              <Image source={ICONS.Maps} style={styles.topIcon} resizeMode="contain" />
            </Pressable>
            {/* Leaderboard removed per v2.0 design (Home top bar = outfits + scenes only). */}
          </View>
        </View>

        {/* Scene: companion video at a FIXED spot; the speech bubble is
            anchored to the video's top edge and grows UPWARD as its text
            wraps, so the bunny never shifts with the line count. */}
        <View
          style={[styles.scene, { paddingTop: scenePadTop }]}
          onLayout={(event) => recordLayout({ sceneY: event.nativeEvent.layout.y })}
        >
          <View
            style={styles.videoSlot}
            onLayout={(event) => recordLayout({
              videoY: event.nativeEvent.layout.y,
              videoHeight: event.nativeEvent.layout.height,
            })}
          >
            <View style={styles.bubbleWrap}>
              <View style={styles.bubble}>
                <Text style={styles.bubbleText}>{aiBubble?.line ?? defaultSpeech}</Text>
                <View style={styles.bubbleTail} />
              </View>
            </View>
            <CompanionVideo onPress={onPetTap} onReady={onFirstPaint} />
          </View>
        </View>

        {/* Preserve the scene's original vertical allocation while the actual
            buttons are positioned at the midpoint between video and tab bar. */}
        <View style={{ height: homeLayout.entriesHeight + 16 }} />

        {/* Permanent entries: measured rather than bottom-anchored, so every
            screen size gets equal visual air above and below the row. */}
        <View style={[styles.ground, entriesTop != null ? { top: entriesTop } : styles.groundFallback]}>
          <View
            style={styles.entries}
            onLayout={(event) => recordLayout({ entriesHeight: event.nativeEvent.layout.height })}
          >
            <Pressable
              onPressIn={onFocus}
              onPress={onFocus}
              style={({ pressed }) => [styles.entryBtn, pressed && styles.entryBtnPressed]}
            >
              <Text style={styles.entryText}>Focus</Text>
            </Pressable>
            <Pressable
              onPressIn={onReflect}
              onPress={onReflect}
              style={({ pressed }) => [styles.entryBtn, pressed && styles.entryBtnPressed]}
            >
              <Text style={styles.entryText}>Reflect</Text>
            </Pressable>
          </View>

        </View>

        {/* Friend memory bubbles float over the scene; box-none so the pet,
            top bar, and Focus/Reflect stay tappable through the layer. */}
        <MemoryBubbles bubbles={bubbles} onPopped={onBubblePopped} />
        <AnnouncementGate />

      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#E8D5B0' },
  // Background art fills the screen, anchored top: tall screens scale up from
  // center so the bottom still covers; short screens keep the top, crop bottom.
  sceneBgImg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', pointerEvents: 'none' },
  safe: { flex: 1 },
  topBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 8,
  },
  topRight: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  topIcon: { width: 40, height: 40 },
  scene: { flex: 1, flexShrink: 1, alignItems: 'center', justifyContent: 'center' },
  // The video's 240×240 slot is what gets centered — a fixed box, so the
  // bunny's position never depends on the bubble. marginTop offsets roughly
  // half a typical bubble so the visual balance matches the old layout.
  videoSlot: { width: 240, height: 240, marginTop: 56, flexShrink: 1 },
  // Absolute above the slot, wider than it (so long lines can still wrap at
  // a comfortable width), anchored by its BOTTOM edge → extra lines grow up.
  bubbleWrap: {
    position: 'absolute', bottom: 248, left: -90, right: -90,
    alignItems: 'center',
  },
  bubble: {
    backgroundColor: 'rgba(244, 228, 193, 0.9)', borderRadius: 20, paddingHorizontal: 26, paddingVertical: 18,
    maxWidth: 330,
    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  bubbleTail: {
    position: 'absolute', bottom: -12, alignSelf: 'center',
    width: 0, height: 0, borderLeftWidth: 11, borderRightWidth: 11, borderTopWidth: 12,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: 'rgba(244, 228, 193, 0.9)',
  },
  bubbleText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#3A2E1A', textAlign: 'center', lineHeight: 23 },
  ground: { position: 'absolute', left: 20, right: 20, zIndex: 2 },
  groundFallback: { bottom: 16 },
  entries: { flexDirection: 'row', gap: 16 },
  entryBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(244, 228, 193, 0.9)', borderRadius: 18, paddingVertical: 20,
    borderWidth: 2, borderColor: '#2A2A2A',
    shadowColor: '#2A2A2A', shadowOpacity: 0.5, shadowRadius: 0, shadowOffset: { width: 3, height: 4 },
    elevation: 4,
  },
  entryBtnPressed: {
    shadowOffset: { width: 1, height: 1 },
    transform: [{ translateX: 2 }, { translateY: 3 }],
  },
  entryText: { fontSize: 20, fontFamily: 'Inter_700Bold', color: '#3A2E1A' },
});
