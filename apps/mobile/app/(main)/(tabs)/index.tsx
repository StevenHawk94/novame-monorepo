import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';

import { requireAiConsent } from '@/lib/ai-consent';
import { prioritizeR2Image } from '@/lib/download-queue';
import { useR2AssetRevision } from '@/lib/use-r2-asset-revision';
import { haptics } from '@/lib/haptics';
import { fetchCompanion, getCachedCompanion, type CompanionState } from '@/lib/companion-api';
import { ICONS } from '@/lib/icons';
import { CompanionVideo } from '@/components/main/companion-video';
import { HomeEntryImage } from '@/components/main/home-entry-gate';
import { useHomeEntry } from '@/lib/use-home-entry';
import { failHomeEntry, getHomeEntryState, markHomeEntryAsset } from '@/lib/home-entry-readiness';
import { getHomeSceneSource } from '@/lib/scenes';
import {
  advanceDefaultBubble,
  getFreshBubbleState,
  getLaunchDefaultBubble,
  subscribeToReflectBubble,
  type FreshBubble,
} from '@/lib/bubble-store';
import { useSubscriptionTierState } from '@/lib/use-subscription-tier';
import { prefetchAppData } from '@/lib/prefetch';
import { getCachedTodayBubbles, loadTodayBubbles, type MemoryBubble } from '@/lib/home-bubbles';
import { MemoryBubbles } from '@/components/main/memory-bubbles';
import { AnnouncementGate } from '@/components/main/announcement-gate';
import { useNavigationAction } from '@/lib/use-navigation-action';
import { FeatureGuideModal } from '@/components/main/feature-guide-modal';
import { getCachedFriendFeedPage, getCachedPairing } from '@/lib/friends-api';
import { storage } from '@/lib/storage';
import { kFirstPartnerReflectGuide } from '@/shared/storage/keys';
import { syncWidgetLatestFriend } from '@/lib/widget-sync';
import { getCachedFriendFeed } from '@/lib/friends-api';
import { consumeHomeRefresh, subscribeHomeRefresh } from '@/lib/home-refresh-signal';

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
function visibleAiBubble(tier: ReturnType<typeof useSubscriptionTierState>): FreshBubble | null {
  // A cached AI line must never leak through after the account becomes Free.
  // `null` is not Free: it means the current account's local entitlement is
  // still hydrating. User-scoped caches are cleared together on account
  // switches, so a bubble that exists in this state belongs to this account.
  if (tier === 'free') return null;
  return getFreshBubbleState();
}

export default function HomeScreen() {
  const homeEntry = useHomeEntry();
  const r2AssetRevision = useR2AssetRevision();
  const router = useRouter();
  const subscriptionTier = useSubscriptionTierState();
  const [companion, setCompanion] = useState<CompanionState | null>(() => getCachedCompanion());
  const [bubbles, setBubbles] = useState<MemoryBubble[]>(getCachedTodayBubbles);
  const [firstPartnerReflect, setFirstPartnerReflect] = useState<{
    partnerId: string;
    name: string;
  } | null>(null);
  const [, setCosmeticTick] = useState(0);
  const [defaultSpeech, setDefaultSpeech] = useState(getLaunchDefaultBubble);
  const [aiBubble, setAiBubble] = useState<FreshBubble | null>(() => visibleAiBubble(subscriptionTier));
  const aiBubbleRef = useRef(aiBubble);
  const navigate = useNavigationAction();
  const [measuredLayoutParts, setMeasuredLayoutParts] = useState<string[]>([]);
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
    applyAiBubble(visibleAiBubble(subscriptionTier));
  }, [applyAiBubble, subscriptionTier]);

  useEffect(() => {
    // R2 icon replacements finish asynchronously after the feed itself. Push
    // the newly cached image paths into both native widgets on that revision,
    // instead of leaving the widget on its previous bundled image.
    void syncWidgetLatestFriend(getCachedFriendFeed(), getCachedPairing());
  }, [r2AssetRevision]);

  // Reflect finalization writes MMKV before its route closes. Subscribe to
  // that local write so Home is already showing the new line when revealed,
  // rather than repainting from the default after the back transition.
  useEffect(() => subscribeToReflectBubble(() => {
    applyAiBubble(visibleAiBubble(subscriptionTier));
  }), [applyAiBubble, subscriptionTier]);

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

  const recordLayout = useCallback((part: Partial<typeof homeLayout>) => {
    setMeasuredLayoutParts((current) => {
      const added = Object.keys(part).filter((key) => !current.includes(key));
      return added.length ? [...current, ...added] : current;
    });
    setHomeLayout((current) => {
      const next = { ...current, ...part };
      return Object.keys(part).every((key) => current[key as keyof typeof current] === next[key as keyof typeof next])
        ? current
        : next;
    });
  }, []);

  const onSafeLayout = useCallback((event: LayoutChangeEvent) => {
    recordLayout({ safeHeight: event.nativeEvent.layout.height });
  }, [recordLayout]);

  const refreshHomeBubbles = useCallback(async (force = false) => {
    const nextBubbles = await loadTodayBubbles({ force });
    setBubbles(nextBubbles);
    // Mark data ready only after the bubble state is queued for the mounted
    // Home. HomeEntryGate adds two paint frames before reveal, so users never
    // see an empty Home followed by bubbles/feed popping into place.
    const entry = getHomeEntryState();
    if (entry.pending) {
      requestAnimationFrame(() => markHomeEntryAsset('home-data', entry.attempt));
    }
    const pairing = getCachedPairing();
    const page = getCachedFriendFeedPage();
    const partner = pairing?.paired ? pairing.partner : null;
    if (!partner || nextBubbles.length === 0 || page.hasMore || page.feed.length !== 1) return;
    if (storage.getString(kFirstPartnerReflectGuide.name) === partner.userId) return;
    setFirstPartnerReflect({ partnerId: partner.userId, name: partner.displayName || 'YOUR PERSON' });
  }, []);

  // Notification taps and modal close paths can reveal Home without causing a
  // tab focus transition. Refresh immediately and bypass the five-minute feed
  // cache; consumeHomeRefresh also preserves cold-start taps until this screen
  // has mounted.
  useEffect(() => subscribeHomeRefresh(() => {
    // Notification entry owns the pending refresh through HomeEntryGate. Its
    // attempt effect below consumes the pulse exactly once and waits for it;
    // ordinary modal-close refreshes still update Home without a full gate.
    if (getHomeEntryState().pending) return;
    consumeHomeRefresh();
    void refreshHomeBubbles(true);
  }), [refreshHomeBubbles]);

  useEffect(() => {
    if (!homeEntry.pending || homeEntry.target !== 'home') return;
    const signaledRefresh = consumeHomeRefresh();
    void refreshHomeBubbles(homeEntry.forceData || signaledRefresh);
  }, [homeEntry.pending, homeEntry.attempt, homeEntry.forceData, homeEntry.target, refreshHomeBubbles]);

  useFocusEffect(
    useCallback(() => {
      // Cache refreshes are independent of the bounded navigation tap guard.
      // A slow read or a queued automatic prompt never disables Home.
      setCosmeticTick((t) => t + 1);
      applyAiBubble(visibleAiBubble(subscriptionTier));
      void fetchCompanion().then((c) => {
        if (c) setCompanion(c);
      });
      // A pending entry attempt is handled by the effect above so its forced
      // notification refresh cannot race a second cache-first request.
      if (!getHomeEntryState().pending) {
        void refreshHomeBubbles(consumeHomeRefresh());
      }
      // Warm every tab's cache in the background (throttled) so switching
      // tabs paints instantly instead of cold-loading.
      prefetchAppData();
    }, [applyAiBubble, refreshHomeBubbles, subscriptionTier]),
  );

  const onBubblePopped = useCallback((bubbleId: string) => {
    setBubbles((prev) => prev.filter((b) => b.id !== bubbleId));
  }, []);

  const onReflect = () => navigate(() => {
    // Lock before the consent gate: onPressIn + onPress can both fire for one
    // physical tap, and the gate returns early for a first-time user.
    if (!requireAiConsent('/(main)/reflect')) return;
    void haptics.pageOpen();
    router.push('/(main)/reflect');
  });
  const onFocus = () => navigate(() => {
    void haptics.pageOpen();
    router.push('/(main)/focus');
  });
  const onPetTap = () => navigate(() => {
    void haptics.pageOpen();
    router.push('/(main)/companion-sheet');
  });

  const openHomeModal = (route: '/(main)/(modals)/me' | '/(main)/(modals)/skin-select' | '/(main)/(modals)/scene-select') => navigate(() => {
    void haptics.pageOpen();
    router.push(route);
  });

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

  useEffect(() => {
    if (!homeEntry.pending || entriesTop == null || measuredLayoutParts.length < 5) return;
    // All measurements have committed, including the repositioned Focus /
    // Reflect row. Retry can reuse these measurements without remounting Home.
    const frame = requestAnimationFrame(() => markHomeEntryAsset('home-layout', homeEntry.attempt));
    return () => cancelAnimationFrame(frame);
  }, [homeEntry.pending, homeEntry.attempt, homeLayout, measuredLayoutParts, entriesTop]);

  return (
    <View style={styles.root}>
      <HomeEntryImage
        asset="scene"
        source={sceneImg}
        style={styles.sceneBgImg}
        contentFit="cover"
        cachePolicy="memory-disk"
        priority="high"
        recyclingKey={`home-scene:${r2AssetRevision}`}
        onError={() => {
          if (typeof sceneImg === 'object' && sceneImg.uri) prioritizeR2Image(sceneImg.uri);
        }}
      />
      <SafeAreaView style={styles.safe} edges={['top']} onLayout={onSafeLayout}>
        {/* Top bar: menu (left) + outfits / scenes / leaderboard (right) */}
        <View style={styles.topBar}>
          <Pressable onPress={() => openHomeModal('/(main)/(modals)/me')} hitSlop={8}>
            <HomeEntryImage asset="menu" source={ICONS.Menu} style={styles.topIcon} contentFit="contain" />
          </Pressable>
          <View style={styles.topRight}>
            <Pressable onPress={() => openHomeModal('/(main)/(modals)/skin-select')} hitSlop={8}>
              <HomeEntryImage asset="outfits" source={ICONS.Outfits} style={styles.topIcon} contentFit="contain" />
            </Pressable>
            <Pressable onPress={() => openHomeModal('/(main)/(modals)/scene-select')} hitSlop={8}>
              <HomeEntryImage asset="scenes" source={ICONS.Maps} style={styles.topIcon} contentFit="contain" />
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
            <CompanionVideo
              key={homeEntry.attempt}
              waitForInitialAsset={homeEntry.attempt > 0}
              onPress={onPetTap}
              onReady={() => markHomeEntryAsset('companion', homeEntry.attempt)}
              onError={() => failHomeEntry(homeEntry.attempt)}
            />
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
        <FeatureGuideModal
          guide="memories"
          manual
          enabled={!homeEntry.pending && !!firstPartnerReflect}
          title={`${firstPartnerReflect?.name ?? 'your person'} just reflected for the first time`}
          body="Every reflection becomes a bubble of little moments. Pop one to see what’s inside."
          button="Pop a Bubble"
          onDismiss={() => {
            if (firstPartnerReflect) {
              storage.set(kFirstPartnerReflectGuide.name, firstPartnerReflect.partnerId);
            }
            setFirstPartnerReflect(null);
          }}
        />
        {!homeEntry.pending && <AnnouncementGate />}

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
