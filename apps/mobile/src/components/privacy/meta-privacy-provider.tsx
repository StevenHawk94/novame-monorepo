import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import {
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';

import { ScreenOverlay } from '@/components/ui/screen-overlay';
import { GridBackground } from '@/components/ui/grid-background';
import { disableMetaAnalytics, initializeMetaAnalytics } from '@/lib/meta-analytics';
import { hasSeenIntro } from '@/lib/onboarding';
import { hideSplashOnce } from '@/lib/splash';
import { storage } from '@/lib/storage';
import { ICONS } from '@/lib/icons';
import { kMetaPrivacyChoice } from '@/shared/storage/keys';

type MetaPrivacyChoice = 'granted' | 'denied';
type PrivacyRegion = 'checking' | 'eea_uk' | 'other' | 'unknown';
type PromptMode = 'required' | 'preferences' | null;

type MetaPrivacyContextValue = {
  applies: boolean;
  choice: MetaPrivacyChoice | null;
  ensureConsentBeforeHome(): Promise<void>;
  openPreferences(): void;
};

const MetaPrivacyContext = createContext<MetaPrivacyContextValue | null>(null);
const PRIVACY_URL = 'https://www.burrow-app.com/privacy';
// Direct mobile connections to the Vercel edge can take 10-12 seconds from
// China. This request runs in the background and does not hold the app UI.
const REGION_TIMEOUT_MS = 20_000;
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, '');

function savedChoice(): MetaPrivacyChoice | null {
  const value = storage.getString(kMetaPrivacyChoice.name);
  return value === 'granted' || value === 'denied' ? value : null;
}

async function fetchPrivacyRegion(): Promise<PrivacyRegion> {
  // Explicit local override makes the two consent branches testable without
  // pretending device locale or App Store country is a reliable location.
  const override = __DEV__
    ? process.env.EXPO_PUBLIC_META_PRIVACY_REGION_OVERRIDE?.trim().toLowerCase()
    : undefined;
  if (override === 'eea_uk') return 'eea_uk';
  if (override === 'other') return 'other';

  const controller = new AbortController();
  const startedAt = Date.now();
  const timer = setTimeout(() => controller.abort(), REGION_TIMEOUT_MS);
  try {
    if (!API_BASE_URL) throw new Error('Missing EXPO_PUBLIC_API_URL');

    // This endpoint is intentionally public. Do not route it through the
    // authenticated ApiClient: resolving the Supabase session during a cold
    // launch can consume the whole timeout before the network request starts,
    // leaving Meta disabled as an unknown region on both platforms.
    const raw = await fetch(`${API_BASE_URL}/api/privacy-region`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!raw.ok) throw new Error(`Privacy region request failed: ${raw.status}`);
    const response = await raw.json() as {
      success?: boolean;
      region?: 'eea_uk' | 'other' | 'unknown';
    };
    const resolved = response.success && response.region
      ? response.region
      : 'unknown';
    if (__DEV__) {
      console.info(
        '[meta-privacy] region resolved:',
        resolved,
        `(${Date.now() - startedAt}ms)`,
      );
    }
    return resolved;
  } catch (error) {
    console.warn('[meta-privacy] region lookup failed; Meta remains disabled:', error);
    return 'unknown';
  } finally {
    clearTimeout(timer);
  }
}

export function MetaPrivacyProvider({ children }: PropsWithChildren) {
  const initialReturningUser = useRef(hasSeenIntro()).current;
  const initialChoice = useRef(savedChoice()).current;
  const choiceRef = useRef<MetaPrivacyChoice | null>(initialChoice);
  const [choice, setChoice] = useState<MetaPrivacyChoice | null>(initialChoice);
  const [region, setRegion] = useState<PrivacyRegion>(
    initialChoice ? 'eea_uk' : 'checking',
  );
  const [promptMode, setPromptMode] = useState<PromptMode>(null);
  const regionPromise = useRef<Promise<PrivacyRegion> | null>(null);
  const decisionWaiters = useRef<Array<() => void>>([]);

  const resolveRegion = useCallback((): Promise<PrivacyRegion> => {
    if (choiceRef.current) return Promise.resolve('eea_uk');
    if (region !== 'checking') return Promise.resolve(region);
    if (regionPromise.current) return regionPromise.current;

    regionPromise.current = fetchPrivacyRegion().then((resolved) => {
      setRegion(resolved);
      if (resolved === 'other') initializeMetaAnalytics();
      // Unknown is deliberately fail-closed: no prompt based on a guess, and
      // no Meta initialization until a later launch can classify the region.
      return resolved;
    });
    return regionPromise.current;
  }, [region]);

  useEffect(() => {
    if (initialChoice === 'granted') initializeMetaAnalytics();
    else if (initialChoice === 'denied') disableMetaAnalytics();

    void resolveRegion().then((resolved) => {
      if (initialReturningUser && resolved === 'eea_uk' && !choiceRef.current) {
        setPromptMode('required');
      }
    });
  }, [initialChoice, initialReturningUser, resolveRegion]);

  const choose = useCallback((next: MetaPrivacyChoice) => {
    choiceRef.current = next;
    storage.set(kMetaPrivacyChoice.name, next);
    setChoice(next);
    setRegion('eea_uk');
    setPromptMode(null);
    if (next === 'granted') initializeMetaAnalytics();
    else disableMetaAnalytics();
    const waiters = decisionWaiters.current.splice(0);
    waiters.forEach((resolve) => resolve());
  }, []);

  const ensureConsentBeforeHome = useCallback(async () => {
    const resolved = await resolveRegion();
    if (resolved !== 'eea_uk' || choiceRef.current) return;
    setPromptMode('required');
    await new Promise<void>((resolve) => decisionWaiters.current.push(resolve));
  }, [resolveRegion]);

  const openPreferences = useCallback(() => setPromptMode('preferences'), []);
  const closePreferences = useCallback(() => setPromptMode(null), []);
  const value = useMemo<MetaPrivacyContextValue>(() => ({
    applies: region === 'eea_uk' || choice !== null,
    choice,
    ensureConsentBeforeHome,
    openPreferences,
  }), [choice, ensureConsentBeforeHome, openPreferences, region]);

  // Never hold the native splash while IP classification is in flight. Meta
  // remains disabled during `checking`/`unknown`; a confirmed EEA/UK response
  // still gates measurement behind the consent surface.
  const startupBlocking = initialReturningUser
    && region === 'eea_uk'
    && choice === null;

  return (
    <MetaPrivacyContext.Provider value={value}>
      {startupBlocking ? (
        <ConsentSurface
          preferences={false}
          onAllow={() => choose('granted')}
          onDeny={() => choose('denied')}
        />
      ) : (
        <>
          {children}
          <ScreenOverlay
            visible={promptMode !== null}
            onRequestClose={promptMode === 'preferences' ? closePreferences : () => {}}
            statusBarTranslucent
            navigationBarTranslucent
          >
            <ConsentSurface
              preferences={promptMode === 'preferences'}
              onClose={closePreferences}
              onAllow={() => choose('granted')}
              onDeny={() => choose('denied')}
            />
          </ScreenOverlay>
        </>
      )}
    </MetaPrivacyContext.Provider>
  );
}

export function useMetaPrivacy(): MetaPrivacyContextValue {
  const value = useContext(MetaPrivacyContext);
  if (!value) throw new Error('useMetaPrivacy must be used inside MetaPrivacyProvider');
  return value;
}

function ConsentSurface({
  preferences,
  onAllow,
  onDeny,
  onClose,
}: {
  preferences: boolean;
  onAllow(): void;
  onDeny(): void;
  onClose?: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.surface} onLayout={hideSplashOnce}>
      <GridBackground base="#F8E2C1" line="#E9CFA8" cell={28} lineWidth={1.2} />
      {preferences && onClose ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={[styles.close, { top: insets.top + 14 }]}
        >
          <MaterialIcons name="close" size={24} color="#FFFFFF" />
        </Pressable>
      ) : null}
      <View style={[styles.card, { marginTop: insets.top + 24, marginBottom: insets.bottom + 24 }]}>
        <Image source={ICONS.obBunnyHead} style={styles.bunny} contentFit="contain" />
        <Text style={styles.title}>Help improve Burrow</Text>
        <Text style={styles.body}>
          With your permission, Burrow will share limited app activity and device information with Meta to measure whether our ads are effective and improve our campaigns.
        </Text>
        <View style={styles.detailCard}>
          <Text style={styles.detailText}>
            This includes events such as first launch, completing onboarding, your first reflection, and starting a trial.
          </Text>
          <Text style={styles.detailText}>
            We never send your reflection content, messages, name, email, or friend information to Meta.
          </Text>
        </View>
        <Pressable accessibilityRole="button" onPress={onAllow} style={styles.allowButton}>
          <Text style={styles.allowText}>Allow measurement</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onDeny} style={styles.denyButton}>
          <Text style={styles.denyText}>Don’t allow</Text>
        </Pressable>
        <Pressable onPress={() => { void Linking.openURL(PRIVACY_URL); }} hitSlop={8}>
          <Text style={styles.privacyLink}>Privacy Policy</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  surface: {
    flex: 1,
    backgroundColor: '#F8E2C1',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  close: {
    position: 'absolute',
    zIndex: 2,
    left: 20,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#56361D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 480,
    borderRadius: 30,
    backgroundColor: '#FFF8E8',
    borderWidth: 2,
    borderColor: '#E6C99F',
    paddingHorizontal: 24,
    paddingVertical: 26,
    alignItems: 'center',
  },
  bunny: { width: 88, height: 92, marginBottom: 8 },
  title: {
    color: '#3F2917',
    fontFamily: 'Inter_900Black',
    fontSize: 27,
    lineHeight: 33,
    textAlign: 'center',
  },
  body: {
    marginTop: 14,
    color: '#513923',
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  detailCard: {
    width: '100%',
    marginTop: 18,
    borderRadius: 18,
    backgroundColor: '#F4E4C9',
    padding: 16,
    gap: 10,
  },
  detailText: {
    color: '#5B4028',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    lineHeight: 19,
  },
  allowButton: {
    width: '100%',
    minHeight: 58,
    marginTop: 20,
    borderRadius: 19,
    backgroundColor: '#56361D',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  allowText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 17 },
  denyButton: {
    width: '100%',
    minHeight: 52,
    marginTop: 10,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#6B4A2F',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  denyText: { color: '#56361D', fontFamily: 'Inter_700Bold', fontSize: 16 },
  privacyLink: {
    marginTop: 18,
    color: '#6A4A2D',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    textDecorationLine: 'underline',
  },
});
