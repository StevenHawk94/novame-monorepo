import { useEffect, useLayoutEffect, useRef, useState, type PropsWithChildren } from 'react';
import {
  ActivityIndicator, AppState, BackHandler, Image as NativeImage, Platform,
  StyleSheet, View,
} from 'react-native';
import { Image as ExpoImage, type ImageProps } from 'expo-image';
import { router, useSegments } from 'expo-router';

import {
  failHomeEntry, finishHomeEntry, homeEntryIsReady, markHomeEntryAsset,
  beginHomeEntry, HOME_ENTRY_TIMEOUT_MS, isFriendsEntryRoute,
  isHomeEntryRoute, retryHomeEntry, timeoutHomeEntry, type HomeEntryAsset,
} from '@/lib/home-entry-readiness';
import { useHomeEntry } from '@/lib/use-home-entry';
import { ICONS } from '@/lib/icons';
import { GridBackground } from '@/components/ui/grid-background';
import { hideSplashOnce } from '@/lib/splash';
import { registerOverlay, useOverlayPresent } from '@/lib/overlay-presence';
import { useRatingTransitionBusy } from '@/lib/rating-navigation';
import { fetchAppConfig } from '@/lib/app-config-api';
import { getCurrentSession } from '@/lib/auth';
import { prepareUnreadAnnouncement } from '@/lib/announcements-api';
import { markAndroidP0UiReady } from '@/lib/download-queue';

const ANDROID_ENTRY_TIMEOUT_MS = 750;

/** Track final display for diagnostics; image callbacks never gate navigation. */
export function HomeEntryImage({ asset, onDisplay, onError, ...props }: ImageProps & { asset: HomeEntryAsset }) {
  const { attempt } = useHomeEntry();
  // Metro's numeric source is already a packaged Android drawable. Rendering
  // it with React Native's native Image path gives core navigation art an
  // independent fallback from expo-image/Glide's module bridge. Remote URIs
  // and every iOS image continue through expo-image unchanged.
  if (Platform.OS === 'android' && typeof props.source === 'number') {
    const resizeMode = props.contentFit === 'cover'
      ? 'cover'
      : props.contentFit === 'fill'
        ? 'stretch'
        : props.contentFit === 'none'
          ? 'center'
          : 'contain';
    return (
      <NativeImage
        key={attempt}
        source={props.source}
        style={props.style}
        resizeMode={resizeMode}
        onLoad={() => { markHomeEntryAsset(asset, attempt); onDisplay?.(); }}
        onError={(event) => {
          const error = event.nativeEvent.error || 'Bundled image render failed';
          console.warn('[assets/android] bundled image render failed', { asset, error });
          failHomeEntry(attempt);
          onError?.({ error });
        }}
      />
    );
  }
  return (
    <ExpoImage
      {...props}
      key={attempt}
      transition={0}
      onDisplay={() => { markHomeEntryAsset(asset, attempt); onDisplay?.(); }}
      onError={(error) => {
        if (Platform.OS === 'android') {
          console.warn('[assets/android] native image render failed', {
            asset,
            error: typeof error === 'object' && error && 'error' in error
              ? String(error.error)
              : String(error),
          });
        }
        failHomeEntry(attempt);
        onError?.(error);
      }}
    />
  );
}

/** Briefly cover an active external-entry destination for its first paint. */
export function HomeEntryGate({ children }: PropsWithChildren) {
  const entry = useHomeEntry();
  const segments = useSegments();
  const atHome = isHomeEntryRoute(segments);
  const atFriends = isFriendsEntryRoute(segments);
  const otherOverlay = useOverlayPresent();
  const transitionBusy = useRatingTransitionBusy();
  const overlayOwner = useRef({}).current;
  const atTarget = entry.target === 'current'
    || (entry.target === 'home' && atHome)
    || (entry.target === 'friends' && atFriends);
  const visible = entry.pending && atTarget;
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [after, setAfter] = useState<'notification-settings' | null>(null);
  // iOS keeps its proven visual-readiness hand-off. Android must not depend
  // on an image callback that R8/device-specific decoding can suppress.
  // Android skips native image callback gating, but Home data/copy readiness
  // is deterministic JavaScript state and must settle before the cover lifts.
  const androidHomeDataReady = entry.target !== 'home'
    || (entry.ready.includes('home-data') && entry.ready.includes('home-copy'));
  const ready = Platform.OS === 'android' ? androidHomeDataReady : homeEntryIsReady();

  useLayoutEffect(() => {
    if (!entry.resumeRequired || otherOverlay) return;
    beginHomeEntry({
      target: atHome ? 'home' : atFriends ? 'friends' : 'current',
      forceHomeData: atHome || atFriends,
    });
  }, [atFriends, atHome, entry.resumeRequired, otherOverlay]);

  useLayoutEffect(() => {
    if (visible) return registerOverlay(overlayOwner);
  }, [visible, overlayOwner]);

  useEffect(() => () => {
    // Auth/navigation may interrupt this first mount. Its native views no
    // longer exist, so their display callbacks cannot count for the next one.
    retryHomeEntry();
  }, []);

  useEffect(() => {
    if (!entry.pending && !after) return;
    setForeground(AppState.currentState === 'active');
    const sub = AppState.addEventListener('change', (value) => setForeground(value === 'active'));
    return () => sub.remove();
  }, [entry.pending, after]);

  useEffect(() => {
    if (!entry.pending) return;
    const attempt = entry.attempt;
    // Dialog/config copy is the only shared data that is deliberately checked
    // on every real entry. Existing cached UI remains underneath the cover.
    void Promise.allSettled([
      fetchAppConfig({ noCache: true }),
      getCurrentSession().then((session) => (
        session?.user?.id ? prepareUnreadAnnouncement(session.user.id) : null
      )),
    ]).then(() => markHomeEntryAsset('entry-copy', attempt));
  }, [entry.pending, entry.attempt]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [visible]);

  useEffect(() => {
    if (!visible || !atTarget || !foreground || !ready || transitionBusy) return;
    // Leave two frames for the already-mounted destination's first paint.
    // Do not reveal while the native stack is still moving Home into place:
    // its temporary content background is the deep-brown frame users saw.
    // Backgrounding or unmounting cancels both queued frames.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        setAfter(finishHomeEntry(entry.attempt, Platform.OS === 'android'));
        markAndroidP0UiReady();
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, atTarget, entry.attempt, foreground, ready, transitionBusy]);

  useEffect(() => {
    if (!visible || !foreground) return;
    // Never trap an entry on slow network or a missing native display event.
    // The cached destination is already mounted underneath, so fail open.
    const timeoutMs = Platform.OS === 'android' && entry.target !== 'home'
      ? ANDROID_ENTRY_TIMEOUT_MS : HOME_ENTRY_TIMEOUT_MS;
    const timer = setTimeout(() => setAfter(timeoutHomeEntry(entry.attempt)), timeoutMs);
    return () => clearTimeout(timer);
  }, [visible, entry.attempt, foreground]);

  useEffect(() => {
    if (entry.pending || !atHome || !foreground || !after) return;
    const frame = requestAnimationFrame(() => {
      setAfter(null);
      router.push('/(main)/(modals)/notification-settings');
    });
    return () => cancelAnimationFrame(frame);
  }, [entry.pending, atHome, foreground, after]);

  // When no entry is pending, any authenticated destination owns the native
  // splash hand-off. Home/Paired entries hide it from the cover's own layout.
  return (
    <View
      style={styles.root}
      onLayout={!visible ? hideSplashOnce : undefined}
    >
      <View
        style={styles.root}
        pointerEvents={visible ? 'none' : 'auto'}
        accessibilityElementsHidden={visible}
        importantForAccessibility={visible ? 'no-hide-descendants' : 'auto'}
      >
        {children}
      </View>
      {visible ? (
        <View style={styles.cover} accessibilityViewIsModal onLayout={hideSplashOnce}>
          <GridBackground />
          <ExpoImage source={ICONS.obBunnyHead} style={styles.bunny} contentFit="contain" />
          <ActivityIndicator size="small" color="#8A6240" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  cover: { ...StyleSheet.absoluteFillObject, zIndex: 100, elevation: 100, backgroundColor: '#F8E2C1', alignItems: 'center', justifyContent: 'center' },
  bunny: { width: 132, height: 158, marginBottom: 24 },
});
