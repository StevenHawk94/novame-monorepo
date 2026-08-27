import {
  Children, cloneElement, createContext, isValidElement, useCallback,
  useContext, useEffect, useId, useMemo, useRef, useState,
  type ReactElement, type ReactNode,
} from 'react';
import { ActivityIndicator, AppState, StyleSheet, View } from 'react-native';
import { Image, type ImageProps } from 'expo-image';
import { hideSplashOnce } from '../../lib/splash';

type PageContextValue = { playing: boolean; imageReady: (key: string) => void };
const PageContext = createContext<PageContextValue | null>(null);

// These views are the REAL destination pages, laid out at their final size.
// Keeping a downloaded file in a cache alone still leaves a decode/mount gap.
export function onboardingMountedPages(
  displayed: string | null, requested: string, next: string | null,
): string[] {
  if (displayed !== requested) return [...new Set([displayed, requested].filter((id): id is string => id !== null))];
  return next ? [displayed, next] : [displayed];
}

type PageProps = {
  id: string;
  imageCount?: number;
  children: ReactNode;
  // Supplied by OnboardingPager, never persisted as app/user state.
  visible?: boolean;
  requested?: boolean;
  interactive?: boolean;
  foreground?: boolean;
  onReady?: (id: string) => void;
};

/** At most the visible page + one destination. Old pages are released. */
export function OnboardingPager({
  requestedPage, nextPage, children,
}: { requestedPage: string; nextPage: string | null; children: ReactNode }) {
  const [displayed, setDisplayed] = useState<string | null>(null);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [showWaiting, setShowWaiting] = useState(false);
  const latestRequest = useRef(requestedPage);
  latestRequest.current = requestedPage;
  const pending = displayed !== requestedPage;
  const mounted = onboardingMountedPages(displayed, requestedPage, nextPage);
  const onReady = useCallback((id: string) => {
    if (id === latestRequest.current) setDisplayed(id);
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    setShowWaiting(false);
    if (!pending) return;
    // No spinner flicker on the normal, already-warm hand-off.
    const timer = setTimeout(() => setShowWaiting(true), 200);
    return () => clearTimeout(timer);
  }, [pending, requestedPage]);

  useEffect(() => {
    if (!displayed) return;
    // Hide the initial native splash only AFTER the prepared page is revealed.
    const frame = requestAnimationFrame(hideSplashOnce);
    return () => cancelAnimationFrame(frame);
  }, [displayed]);

  return (
    <View style={styles.pager}>
      {Children.map(children, (child) => {
        if (!isValidElement<PageProps>(child) || !mounted.includes(child.props.id)) return null;
        return cloneElement(child as ReactElement<PageProps>, {
          key: child.props.id,
          visible: child.props.id === displayed,
          requested: child.props.id === requestedPage,
          interactive: !pending && child.props.id === displayed,
          foreground,
          onReady,
        });
      })}
      {showWaiting && pending && (
        <View pointerEvents="none" style={displayed ? styles.waiting : styles.initialWaiting}>
          <ActivityIndicator color="#4A3220" accessibilityLabel="Preparing the next page" />
        </View>
      )}
    </View>
  );
}

export function OnboardingPage({
  id, imageCount = 0, visible = false, requested = false,
  interactive = false, foreground = true, onReady, children,
}: PageProps) {
  const [laidOut, setLaidOut] = useState(false);
  const [images, setImages] = useState<Set<string>>(() => new Set());
  const ready = laidOut && images.size >= imageCount;
  const imageReady = useCallback((key: string) => {
    setImages((current) => current.has(key) ? current : new Set([...current, key]));
  }, []);
  const context = useMemo(() => ({
    playing: visible && foreground, imageReady,
  }), [visible, foreground, imageReady]);

  useEffect(() => {
    if (!requested || !ready) return;
    // onDisplay means the drawable is assigned (unlike onLoad/file prefetch).
    // Let that native commit settle before revealing the already-mounted page.
    const frame = requestAnimationFrame(() => onReady?.(id));
    return () => cancelAnimationFrame(frame);
  }, [id, requested, ready, onReady]);

  useEffect(() => {
    if (!requested || ready) return;
    // A missing Metro asset/native callback must never trap onboarding,
    // especially purchase completion → naming. Normal local images don't wait.
    const timer = setTimeout(() => onReady?.(id), 8000);
    return () => clearTimeout(timer);
  }, [id, requested, ready, onReady]);

  return (
    <PageContext.Provider value={context}>
      <View
        collapsable={false}
        onLayout={() => setLaidOut(true)}
        pointerEvents={interactive ? 'auto' : 'none'}
        accessibilityElementsHidden={!visible}
        importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
        style={[StyleSheet.absoluteFill, { opacity: visible ? 1 : 0, zIndex: visible ? 1 : 0 }]}
      >
        {children}
      </View>
    </PageContext.Provider>
  );
}

/** Onboarding-only wrapper: no global image-cache or ItemSprite changes. */
export function OnboardingImage({ animated = false, ...props }: ImageProps & { animated?: boolean }) {
  const page = useContext(PageContext);
  const key = useId();
  const imageRef = useRef<Image>(null);
  const [displayed, setDisplayed] = useState(false);
  const playing = page?.playing ?? true;

  useEffect(() => {
    if (!animated || !displayed) return;
    const image = imageRef.current;
    // Changing autoplay alone doesn't start an already-decoded GIF on SDK 54.
    if (playing) void image?.startAnimating().catch(() => {});
    else void image?.stopAnimating().catch(() => {});
    return () => { void image?.stopAnimating().catch(() => {}); };
  }, [animated, displayed, playing]);

  return (
    <Image
      {...props}
      ref={imageRef}
      transition={0}
      autoplay={animated && playing}
      onDisplay={() => {
        setDisplayed(true);
        page?.imageReady(key);
        props.onDisplay?.();
      }}
      onError={(event) => {
        // Fail open for a broken asset, instead of blocking the user's flow.
        page?.imageReady(key);
        props.onError?.(event);
      }}
    />
  );
}

const styles = StyleSheet.create({
  pager: { flex: 1 },
  waiting: { position: 'absolute', right: 0, top: 0, zIndex: 2, padding: 8 },
  initialWaiting: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
});
