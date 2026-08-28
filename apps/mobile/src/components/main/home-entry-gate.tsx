import { useEffect, useLayoutEffect, useRef, useState, type PropsWithChildren } from 'react';
import { ActivityIndicator, AppState, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image as ExpoImage, type ImageProps } from 'expo-image';
import { router, useSegments } from 'expo-router';

import {
  failHomeEntry, finishHomeEntry, homeEntryIsReady, markHomeEntryAsset,
  beginHomeEntry, isHomeEntryRoute, retryHomeEntry, type HomeEntryAsset,
} from '@/lib/home-entry-readiness';
import { useHomeEntry } from '@/lib/use-home-entry';
import { ICONS } from '@/lib/icons';
import { haptics } from '@/lib/haptics';
import { GridBackground } from '@/components/ui/grid-background';
import { hideSplashOnce } from '@/lib/splash';
import { registerOverlay, useOverlayPresent } from '@/lib/overlay-presence';

/** Images must be displayed in their final native view, not merely downloaded. */
export function HomeEntryImage({ asset, onDisplay, onError, ...props }: ImageProps & { asset: HomeEntryAsset }) {
  const { attempt } = useHomeEntry();
  return (
    <ExpoImage
      {...props}
      key={attempt}
      transition={0}
      onDisplay={() => { markHomeEntryAsset(asset, attempt); onDisplay?.(); }}
      onError={(error) => { failHomeEntry(attempt); onError?.(error); }}
    />
  );
}

/** Cover Home AND its tab bar while the same views paint at their final size. */
export function HomeEntryGate({ children }: PropsWithChildren) {
  const entry = useHomeEntry();
  const atHome = isHomeEntryRoute(useSegments());
  const otherOverlay = useOverlayPresent();
  const overlayOwner = useRef({}).current;
  const visible = atHome && entry.pending;
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [after, setAfter] = useState<'notification-settings' | null>(null);
  const ready = homeEntryIsReady();

  useLayoutEffect(() => {
    if (atHome && entry.resumeRequired && !otherOverlay) beginHomeEntry();
  }, [atHome, entry.resumeRequired, otherOverlay]);

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
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [visible]);

  useEffect(() => {
    if (!visible || !foreground || !ready) return;
    // Leave a paint between the last native display/layout event and reveal.
    // Backgrounding or unmounting cancels both queued frames.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setAfter(finishHomeEntry(entry.attempt)));
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, entry.attempt, foreground, ready]);

  useEffect(() => {
    if (!visible || !foreground || ready || entry.failed) return;
    // A corrupt asset / missing native callback must not mean an endless
    // spinner. Retry remounts only the visual assets, not auth or navigation.
    const timer = setTimeout(() => failHomeEntry(entry.attempt), 12000);
    return () => clearTimeout(timer);
  }, [visible, entry.attempt, foreground, ready, entry.failed]);

  useEffect(() => {
    if (entry.pending || !atHome || !foreground || !after) return;
    const frame = requestAnimationFrame(() => {
      setAfter(null);
      router.push('/(main)/(modals)/notification-settings');
    });
    return () => cancelAnimationFrame(frame);
  }, [entry.pending, atHome, foreground, after]);

  return (
    <View style={styles.root}>
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
          {entry.failed ? (
            <>
              <Text style={styles.message}>Home is taking longer to get ready.</Text>
              <Pressable accessibilityRole="button" style={styles.retry} onPress={() => { void haptics.light(); retryHomeEntry(); }}>
                <Text style={styles.retryText}>Try Again</Text>
              </Pressable>
            </>
          ) : (
            <>
              <ActivityIndicator size="small" color="#8A6240" />
              <Text style={styles.message}>Getting your burrow ready…</Text>
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  cover: { ...StyleSheet.absoluteFillObject, zIndex: 100, elevation: 100, backgroundColor: '#F8E2C1', alignItems: 'center', justifyContent: 'center' },
  bunny: { width: 132, height: 158, marginBottom: 24 },
  message: { marginTop: 16, marginHorizontal: 24, textAlign: 'center', color: '#6F4F34', fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  retry: { marginTop: 20, paddingVertical: 14, paddingHorizontal: 32, borderRadius: 18, backgroundColor: '#4A3220' },
  retryText: { color: '#FFF4E3', fontFamily: 'Inter_700Bold', fontSize: 16 },
});
