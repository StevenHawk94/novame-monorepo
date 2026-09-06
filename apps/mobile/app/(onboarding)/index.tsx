import { createContext, useContext, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { Linking, ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text as NativeText, TextInput, useWindowDimensions, View } from 'react-native';
import { appAlert } from '@/components/ui/app-dialog';
import { Image as ExpoImage } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { haptics } from '../../src/lib/haptics';
import { ICONS } from '../../src/lib/icons';
import { GridBackground } from '../../src/components/ui/grid-background';
import { ItemSprite } from '../../src/components/ui/item-sprite';
import { OnboardingImage, OnboardingPage, OnboardingPager } from '../../src/components/onboarding/onboarding-pager';
import { beginHomeEntry, deferHomeEntryNotification } from '../../src/lib/home-entry-readiness';
import { ITEM_IMAGES } from '../../src/lib/item-images.g';
import {
  enableFeatureGuidesForNewUser,
} from '../../src/lib/feature-guides';
import {
  markIntroSeen,
  setBunnyName,
  setChosenCompanion,
  setOnboardingChoices,
} from '../../src/lib/onboarding';
import { logOnboardingCompleted } from '../../src/lib/meta-analytics';
import { useMetaPrivacy } from '../../src/components/privacy/meta-privacy-provider';
import {
  connectProviderOrSignIn, ensureSession,
  sendPasswordlessEmailOtp, verifyPasswordlessEmailOtp,
  type PasswordlessEmailMode,
} from '../../src/lib/auth';
import { supabase } from '../../src/lib/supabase';
import { reportOnboardingChoices, updateDisplayName } from '../../src/lib/account-api';
import {
  fetchSubscriptionProducts,
  initIAP,
  onPurchaseComplete,
  onPurchaseError,
  purchaseSubscription,
} from '../../src/lib/iap';
import {
  markNotifPromptedAfterPurchase,
  shouldPromptNotifAfterPurchase,
} from '../../src/lib/notification-settings';
import { DEFAULT_PLUS_BENEFITS } from '../../src/lib/plus-benefits';

/**
 * Burrow story flow on the beige grid: hook → who/what-blocks questions →
 * branch feedback → how-it-works pages → creator's words → the two-people
 * paywall → plans → Name Your Bunny → done. GUEST MODE: the first operation
 * that needs a backend identity (including purchase) creates one ANONYMOUS
 * session with no forced sign-in; Connect Your Account only appears after a
 * successful purchase, and is skippable there too.
 */
const INK = '#4A2F17';
const CARD = '#FFF4E3';
const BTN = '#4A3220';

/**
 * Android renders this copy noticeably larger across common display-density
 * and font-scale combinations. Keep iOS typography unchanged, while Android
 * scales between 70% on compact phones and 90% on roomy phones/foldables.
 * Both axes participate so a wide but short landscape/foldable window does
 * not accidentally receive oversized type.
 */
const OnboardingTextScaleContext = createContext(1);

function androidOnboardingTextScale(width: number, height: number): number {
  if (Platform.OS !== 'android') return 1;
  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);
  const availableRatio = Math.min(shortSide / 430, longSide / 932);
  const room = Math.max(0, Math.min(1, (availableRatio - 0.78) / 0.22));
  return 0.7 + room * 0.2;
}

function Text({ style, maxFontSizeMultiplier, ...props }: ComponentProps<typeof NativeText>) {
  const scale = useContext(OnboardingTextScaleContext);
  const flat = StyleSheet.flatten(style);
  const fontSize = typeof flat?.fontSize === 'number' ? flat.fontSize * scale : undefined;
  const lineHeight = typeof flat?.lineHeight === 'number' ? flat.lineHeight * scale : undefined;

  return (
    <NativeText
      {...props}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? (Platform.OS === 'android' ? 1.15 : undefined)}
      style={[
        style,
        Platform.OS === 'android' && (fontSize !== undefined || lineHeight !== undefined)
          ? { fontSize, lineHeight }
          : null,
      ]}
    />
  );
}

const WHO_OPTIONS = [
  { key: 'partner', icon: ICONS.obWhoPartner, label: 'My partner' },
  { key: 'parent', icon: ICONS.obWhoMomDad, label: 'My mom or dad' },
  { key: 'child', icon: ICONS.obWhoSonDaughter, label: 'My son or daughter' },
  { key: 'bestie', icon: ICONS.obWhoFriends, label: 'My best friend' },
  { key: 'special', icon: ICONS.obWhoSpecial, label: 'Someone special' },
];

const BLOCKER_OPTIONS = [
  { key: 'A', label: 'Our days get busy' },
  { key: 'B', label: 'We live far apart' },
  { key: 'C', label: 'I don’t want to overwhelm them' },
  { key: 'D', label: 'I’m not always sure what to say' },
];

const BLOCKER_FEEDBACK: Record<string, { title: string; body: string }> = {
  A: {
    title: 'It’s easy to care deeply and still miss the little things.',
    body: 'By the time you finally talk, the small moments that made up the day are often already gone.',
  },
  B: {
    title: 'Distance doesn’t only separate places. It separates everyday moments.',
    body: 'You hear the big updates, but miss the little moments that make you feel part of their life.',
  },
  C: {
    title: 'You shouldn’t have to choose between checking in and giving them space.',
    body: 'Sometimes the gentlest connection begins with small moments they can share in their own time.',
  },
  D: {
    title: 'Closeness doesn’t always need a big conversation.',
    body: 'Sometimes the little moments from their day are all it takes to make talking feel natural again.',
  },
};

const INSIGHT_CAROUSEL_CARDS = [
  {
    label: 'LOW-BATTERY MODE',
    title: 'Not Ignoring You. Just Full.',
    observation: 'Their days have been feeling a little too packed lately. They may not have much social energy left to give.',
    meaning: 'Give them room without disappearing. Care can be quiet, too.',
    takeaway: 'Send a no-reply-needed check-in.',
  },
  {
    label: 'QUIET WIN ALERT',
    title: 'They Did Something Kind of Big',
    observation: 'They recently pushed through something they were nervous about and may be playing it cooler than they feel.',
    meaning: 'This is your cue to be their personal hype person.',
    takeaway: 'Make a little fuss about it.',
  },
  {
    label: 'GENTLE NUDGE',
    title: 'They’ve Been Running on Empty',
    observation: 'They’ve been in go-go-go mode for a while, with very little space to actually reset.',
    meaning: 'A warm check-in or a tiny distraction might land better than “How are you?”',
    takeaway: 'Bring them something soft and silly.',
  },
] as const;

function OnboardingInsightCard({
  card, width,
}: {
  card: (typeof INSIGHT_CAROUSEL_CARDS)[number];
  width: number;
}) {
  return (
    <View style={[styles.insightCarouselCard, { width }]}>
      <View style={styles.insightCarouselBadge}>
        <Text style={styles.insightCarouselBadgeText}>{card.label}</Text>
      </View>
      <Text style={styles.insightCarouselTitle}>{card.title}</Text>
      <Text style={styles.insightCarouselObservation}>{card.observation}</Text>
      <Text style={styles.insightCarouselMeaning}>{card.meaning}</Text>
      <View style={styles.insightCarouselAction}>
        <MaterialIcons name="chat-bubble-outline" size={17} color="#8C523D" />
        <Text style={styles.insightCarouselActionText}>{card.takeaway}</Text>
      </View>
    </View>
  );
}

// Ob5's tappable sample reflection (Mom's card). Keep these IDs on the
// current v25 catalog: the pre-v19 category-prefixed IDs no longer have bundled
// art and render as empty tiles.
const SAMPLE_AVATAR = require('../../assets/profile/default-3.webp');
const SAMPLE_DAY = [
  { itemId: 'memory.0896_avocado', displayName: 'Avocado', category: 'Food & Drink', note: 'Started the morning with avocado toast before a busy day.' },
  { itemId: 'memory.0132_banh_mi', displayName: 'Banh Mi', category: 'Food & Drink', note: 'Picked up a banh mi for a quick lunch between errands.' },
  { itemId: 'memory.4095_workbench', displayName: 'Workbench', category: 'Chores & Home Care', note: 'Spent the afternoon fixing a small project at the workbench.' },
  { itemId: 'memory.2851_toilet', displayName: 'Toilet', category: 'Chores & Home Care', note: 'Finally finished the bathroom clean-up I had been putting off.' },
  { itemId: 'memory.0005_baking', displayName: 'Baking', category: 'Food & Drink', note: 'Baked something sweet after dinner and saved a piece for tomorrow.' },
  { itemId: 'memory.1363_movie_theater', displayName: 'Movie Theater', category: 'Entertainment & Leisure', note: 'Ended the day with a cozy movie and finally slowed down.' },
];

type Step =
  | 'start' | 'someone' | 'who' | 'blocker' | 'feedback' | 'imagine'
  | 'how' | 'space' | 'insights' | 'boundaries' | 'creator'
  | 'paywall' | 'plans' | 'name' | 'connect';

const FLOW: Step[] = [
  'start', 'someone', 'who', 'blocker', 'feedback', 'imagine',
  'how', 'space', 'insights', 'boundaries', 'creator',
  'paywall', 'plans', 'name',
];

export default function OnboardingScreen() {
  const { ensureConsentBeforeHome } = useMetaPrivacy();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const onboardingTextScale = useMemo(
    () => androidOnboardingTextScale(width, height),
    [height, width],
  );
  const androidNameInputType = Platform.OS === 'android'
    ? { fontSize: 17 * onboardingTextScale }
    : null;
  const androidCodeInputType = Platform.OS === 'android'
    ? { fontSize: 22 * onboardingTextScale }
    : null;
  const router = useRouter();
  const [idx, setIdx] = useState(0);
  const [insightCardIndex, setInsightCardIndex] = useState(0);
  const insightCarouselRef = useRef<ScrollView>(null);
  const [who, setWho] = useState<string | null>(null);
  const [blocker, setBlocker] = useState<string | null>(null);
  const [sampleDetailsOpen, setSampleDetailsOpen] = useState(false);
  const [plan, setPlan] = useState<'yearly' | 'monthly'>('yearly');
  const [purchasing, setPurchasing] = useState(false);
  const [purchased, setPurchased] = useState(false);
  const [name, setName] = useState('');
  const [finishing, setFinishing] = useState(false);
  const [linkEmail, setLinkEmail] = useState('');
  const [linking, setLinking] = useState(false);
  const [linkCode, setLinkCode] = useState('');
  const [linkPhase, setLinkPhase] = useState<'enter' | 'verify'>('enter');
  const [linkMode, setLinkMode] = useState<PasswordlessEmailMode>('change');
  // Store-localized prices (industry standard: StoreKit's displayPrice is the
  // truth per storefront/currency). The design-stub strings only show while
  // products haven't loaded (dev/simulator without StoreKit config).
  const [priceYearly, setPriceYearly] = useState<string | null>(null);
  const [priceMonthly, setPriceMonthly] = useState<string | null>(null);
  const [perMonth, setPerMonth] = useState<string | null>(null);
  const [compareAt, setCompareAt] = useState<string | null>(null);
  const pricesFetched = useRef(false);
  const insightCardWidth = Math.min(340, Math.max(240, width - 82));
  const insightCardStep = insightCardWidth + 14;

  useEffect(() => {
    const offComplete = onPurchaseComplete(() => {
      setPurchasing(false);
      setPurchased(true);
      setIdx(FLOW.indexOf('name'));
    });
    const offError = onPurchaseError((error) => {
      setPurchasing(false);
      setPurchased(false);
      appAlert(
        error.code === 'pending' ? 'Payment Pending' : 'Purchase didn’t go through',
        error.message || 'You can subscribe anytime from the app.',
      );
    });
    return () => {
      offComplete();
      offError();
    };
  }, []);


  const step: Step = useMemo(
    () => (idx >= FLOW.length ? 'connect' : FLOW[idx]),
    [idx],
  );

  useEffect(() => {
    if (step !== 'paywall' && step !== 'plans') return;
    if (pricesFetched.current) return;
    pricesFetched.current = true;
    void (async () => {
      try {
        await initIAP();
        const products = await fetchSubscriptionProducts();
        const byId = new Map(products.map((pr) => [pr.id, pr]));
        const yearly = byId.get('novame.plus.yearly');
        const monthly = byId.get('novame.plus.monthly');
        if (yearly?.displayPrice) setPriceYearly(yearly.displayPrice);
        if (monthly?.displayPrice) setPriceMonthly(monthly.displayPrice);
        // Derived lines share the store currency symbol from displayPrice.
        const num = (v: unknown) => (typeof v === 'number' ? v : parseFloat(String(v ?? '')));
        const symbol = (dp?: string) => dp?.replace(/[\d.,\s]/g, '') || '$';
        const yNum = num(yearly?.price);
        const mNum = num(monthly?.price);
        if (Number.isFinite(yNum) && yNum > 0 && yearly?.displayPrice) {
          setPerMonth(`${symbol(yearly.displayPrice)}${(yNum / 12).toFixed(2)}`);
        }
        if (Number.isFinite(mNum) && mNum > 0 && monthly?.displayPrice) {
          setCompareAt(`${symbol(monthly.displayPrice)}${(mNum * 12).toFixed(2)}`);
        }
      } catch {
        // stay on the stub strings; purchase still resolves real pricing
      }
    })();
  }, [step]);

  function next() {
    void haptics.light();
    setIdx((i) => i + 1);
  }

  function onTryFree() {
    void haptics.medium();
    setIdx(FLOW.indexOf('plans'));
  }

  function finishPurchasedOnboarding() {
    const promptNotification = shouldPromptNotifAfterPurchase();
    if (promptNotification) {
      markNotifPromptedAfterPurchase();
      deferHomeEntryNotification();
    }
    router.replace({
      pathname: '/(auth)/signing-in',
      params: promptNotification ? { after: 'notification-settings' } : {},
    } as never);
  }

  function confirmSkipPurchasedAccountConnection() {
    appAlert(
      'Keep your account safe',
      'We strongly recommend connecting an account. This helps keep your data and memories safe and recoverable if you change phones, reinstall the app, or clear app data.',
      [
        { text: 'Close Anyway', style: 'cancel', onPress: finishPurchasedOnboarding },
        { text: 'Keep Connecting' },
      ],
    );
  }

  async function onStartPlan() {
    if (purchasing) return;
    void haptics.medium();
    setPurchasing(true);
    try {
      // Onboarding reaches the paywall before the name step that normally
      // creates guest mode. Prepare the same durable anonymous UUID here so
      // purchasing never requires Apple/Google/email account binding.
      const [sessionReady] = await Promise.all([
        ensureSession(),
        initIAP(),
      ]);
      if (!sessionReady) {
        throw new Error(
          'We couldn’t prepare your account for purchase. Check your connection and try again.',
        );
      }
      const outcome = await purchaseSubscription(
        plan === 'yearly' ? 'novame.plus.yearly' : 'novame.plus.monthly',
      );
      if (outcome.kind === 'cancelled') {
        setPurchasing(false);
      } else if (outcome.kind === 'scheduled') {
        setPurchasing(false);
        setIdx(FLOW.indexOf('name'));
      }
      // A completed StoreKit sheet is not enough to grant Plus. The global
      // listener above advances only after the API verifies and records it.
    } catch (e) {
      // Surface the underlying StoreKit reason — a silent catch made
      // failures undiagnosable (2026-08-07).
      const detail = e instanceof Error ? e.message : String(e);
      console.warn('[onboarding] purchase failed:', detail);
      appAlert(
        'Purchase didn’t go through',
        `You can subscribe anytime from the app.\n\n(${detail})`,
      );
      setPurchasing(false);
    }
  }

  async function onFinishName() {
    if (finishing) return;
    void haptics.medium();
    setFinishing(true);
    if (name.trim()) setBunnyName(name);
    setChosenCompanion('pet1');
    setOnboardingChoices(who ?? '', blocker ?? '');
    // EEA/UK users decide before any Meta event is emitted and before Home is
    // revealed. Everyone else passes through without seeing a prompt.
    await ensureConsentBeforeHome();
    // Arm before auth can redirect independently on SIGNED_IN. UUID creation
    // and the purchase/name/connect sequence are otherwise unchanged.
    beginHomeEntry();
    logOnboardingCompleted();
    markIntroSeen();
    // Guest mode: an anonymous session carries the whole app. Connect only
    // pops after payment (skippable); everyone else goes straight in.
    const ok = await ensureSession();
    setFinishing(false);
    if (!ok) {
      router.replace('/(auth)/sign-in');
      return;
    }
    enableFeatureGuidesForNewUser();
    // The onboarding name is also the user's default display name (2026-08-09
    // ruling) — write it to profiles so friends/partners see a real name
    // instead of the signup seed ('user'). Fire-and-forget.
    void supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id;
      if (!uid) return;
      if (name.trim()) void updateDisplayName(uid, name.trim().slice(0, 15)).catch(() => {});
      if (who && blocker) void reportOnboardingChoices(uid, who, blocker).catch(() => {});
    });
    if (purchased) {
      setIdx(FLOW.length); // → connect
    } else {
      router.replace('/(auth)/signing-in');
    }
  }

  async function onLinkProvider(provider: 'apple' | 'google') {
    if (linking) return;
    void haptics.pageOpen();
    setLinking(true);
    const res = await connectProviderOrSignIn(provider);
    setLinking(false);
    if (res.ok) {
      appAlert(
        res.mode === 'linked' ? 'Account connected' : 'Welcome back!',
        res.mode === 'linked'
          ? 'Your memories are now safe on this account.'
          : 'Your account and memories have been restored.',
        [{ text: 'OK', onPress: () => { void haptics.pageOpen(); finishPurchasedOnboarding(); } }],
      );
    } else if (!res.cancelled) {
      appAlert(
        'Could not connect',
        res.error ?? 'You can connect your account anytime from settings.',
      );
    }
  }

  async function onLinkEmail() {
    const email = linkEmail.trim();
    if (!email.includes('@') || linking) return;
    setLinking(true);
    const result = await sendPasswordlessEmailOtp(email);
    setLinking(false);
    if (!result.ok || !result.mode) {
      appAlert('Could not connect', result.error ?? 'You can connect your account anytime from settings.');
      return;
    }
    setLinkMode(result.mode);
    setLinkPhase('verify');
  }

  async function onVerifyLinkCode() {
    const token = linkCode.trim();
    if (token.length !== 6 || linking) return;
    setLinking(true);
    const res = await verifyPasswordlessEmailOtp(linkEmail.trim(), token, linkMode);
    setLinking(false);
    if (!res.ok) {
      appAlert('Wrong code', res.error ?? 'Double-check the 6-digit code and try again.');
      return;
    }
    appAlert(
      linkMode === 'change' ? 'Account connected' : 'Welcome back!',
      linkMode === 'change'
        ? 'Your memories are now safe.'
        : 'Your account and memories have been restored.',
      [{ text: 'OK', onPress: () => { void haptics.pageOpen(); finishPurchasedOnboarding(); } }],
    );
  }

  const Btn = ({ label, onPress, disabled, busy }: {
    label: string; onPress: () => void; disabled?: boolean; busy?: boolean;
  }) => (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.cta,
        { marginBottom: insets.bottom + 16, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
      ]}
    >
      {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.ctaText}>{label}</Text>}
    </Pressable>
  );

  return (
    <OnboardingTextScaleContext.Provider value={onboardingTextScale}>
    <View style={{ flex: 1, backgroundColor: '#F8E2C1' }}>
      <GridBackground />
      <View style={[styles.root, { paddingTop: insets.top + 18 }]}>
        <OnboardingPager requestedPage={step} nextPage={idx < FLOW.length - 1 ? FLOW[idx + 1] : null}>
        <OnboardingPage id="start" imageCount={1}>
          <ScrollView removeClippedSubviews={false} showsVerticalScrollIndicator={false} contentContainerStyle={styles.center}>
            <View style={{ flex: 1 }} />
            <OnboardingImage source={ICONS.obIcons} style={styles.iconsGrid} contentFit="contain" />
            <Text style={styles.heroTitle}>{'Stay close to the\npeople who matter.'}</Text>
            <Text style={styles.h2}>Even when life gets busy.</Text>
            <View style={{ flex: 1 }} />
            <Btn label="Start" onPress={next} />
          </ScrollView>
        </OnboardingPage>

        <OnboardingPage id="someone" imageCount={1}>
          <ScrollView removeClippedSubviews={false} showsVerticalScrollIndicator={false} contentContainerStyle={styles.center}>
            <View style={{ flex: 1 }} />
            <OnboardingImage source={ICONS.obQuestion} style={styles.qmarkIcon} contentFit="contain" />
            <Text style={styles.h1}>
              Is there someone you wish you felt closer to?
            </Text>
            <Text style={[styles.body, { marginTop: 22 }]}>
              Someone you care about deeply, even when life makes it hard to stay part of the
              little things.
            </Text>
            <View style={{ flex: 1 }} />
            <Btn label="Yes, someone comes to mind" onPress={next} />
          </ScrollView>
        </OnboardingPage>

        <OnboardingPage id="who" imageCount={WHO_OPTIONS.length}>
          <ScrollView removeClippedSubviews={false} showsVerticalScrollIndicator={false} contentContainerStyle={styles.center}>
            <View style={{ flex: 1, minHeight: 24 }} />
            <Text style={[styles.h1, { marginBottom: 26 }]}>Who came to mind?</Text>
            {WHO_OPTIONS.map((o) => (
              <Pressable
                key={o.key}
                onPress={() => { void haptics.light(); setWho(o.key); }}
                style={[styles.optionRow, who === o.key && styles.optionRowOn]}
              >
                <OnboardingImage source={o.icon} style={styles.optionIcon} contentFit="contain" />
                <Text style={styles.optionText}>{o.label}</Text>
              </Pressable>
            ))}
            <View style={{ flex: 1 }} />
            <Btn label="Continue" onPress={next} disabled={!who} />
          </ScrollView>
        </OnboardingPage>

        <OnboardingPage id="blocker" imageCount={0}>
          <ScrollView removeClippedSubviews={false} showsVerticalScrollIndicator={false} contentContainerStyle={styles.center}>
            <View style={{ flex: 1, minHeight: 24 }} />
            <Text style={[styles.h1, { marginBottom: 26 }]}>What tends to get in the way?</Text>
            {BLOCKER_OPTIONS.map((o) => (
              <Pressable
                key={o.key}
                onPress={() => { void haptics.light(); setBlocker(o.key); }}
                style={[styles.optionRow, styles.optionRowCenter, blocker === o.key && styles.optionRowOn]}
              >
                <Text style={[styles.optionText, styles.blockerOptionText]}>{o.label}</Text>
              </Pressable>
            ))}
            <View style={{ flex: 1 }} />
            <Btn label="Continue" onPress={next} disabled={!blocker} />
          </ScrollView>
        </OnboardingPage>

        <OnboardingPage id="feedback" imageCount={1}>
          <ScrollView removeClippedSubviews={false} showsVerticalScrollIndicator={false} contentContainerStyle={styles.center}>
            <View style={{ flex: 1 }} />
            <Text style={styles.feedbackTitle}>
              {BLOCKER_FEEDBACK[blocker ?? 'A'].title}
            </Text>
            <Text style={styles.feedbackBody}>
              {BLOCKER_FEEDBACK[blocker ?? 'A'].body}
            </Text>
            <View style={{ flex: 0.8 }} />
            <View style={styles.feedbackPromptWrap}>
              <View style={styles.feedbackPromptBubble}>
                <Text style={styles.feedbackPromptText}>
                  What if those little moments had somewhere to go?
                </Text>
              </View>
              <View style={styles.feedbackPromptTail} />
              <OnboardingImage source={ICONS.obBunnyHead} style={styles.feedbackLogo} contentFit="contain" />
            </View>
            <View style={{ height: 24 }} />
            <Btn label="Continue" onPress={next} />
          </ScrollView>
        </OnboardingPage>

        <OnboardingPage id="imagine" imageCount={SAMPLE_DAY.length + 1}>
          <ScrollView removeClippedSubviews={false} showsVerticalScrollIndicator={false} contentContainerStyle={styles.center}>
            <View style={{ flex: 1 }} />
            <Text style={styles.h1}>Imagine opening a little window into their day.</Text>
            <Text style={[styles.body, { marginTop: 18 }]}>
              No pressure to start a conversation. Just something real you can notice, remember,
              or reach out about.
            </Text>
            {/* Mom's reflection card — the whole window opens the six
                memory details together, matching the real Paired feed. */}
            <Pressable
              onPress={() => { void haptics.light(); setSampleDetailsOpen(true); }}
              style={({ pressed }) => [styles.sampleCard, pressed && styles.sampleCardPressed]}
            >
              <View style={styles.sampleHeader}>
                <OnboardingImage source={SAMPLE_AVATAR} style={styles.sampleAvatar} contentFit="cover" />
                <Text style={styles.sampleName}>Mom</Text>
                <Text style={styles.sampleTime}>10h ago</Text>
              </View>
              <View style={styles.sampleRow}>
                {SAMPLE_DAY.map((s) => (
                  <View key={s.itemId} pointerEvents="none" style={styles.sampleTile}>
                    <OnboardingImage source={ITEM_IMAGES[s.itemId]} style={{ width: 44, height: 44 }} contentFit="contain" />
                  </View>
                ))}
              </View>
              <Text style={styles.sampleHint}>Tap to see their memory details.</Text>
            </Pressable>
            <Text style={[styles.privacySmall, { marginTop: 18 }]}>
              They choose what becomes part of your shared space.
            </Text>
            <View style={{ flex: 1 }} />
            <Btn label="Continue" onPress={next} />
          </ScrollView>
        </OnboardingPage>

        <OnboardingPage id="how" imageCount={1}>
          <ScrollView removeClippedSubviews={false} showsVerticalScrollIndicator={false} contentContainerStyle={styles.center}>
            <View style={{ flex: 1 }} />
            <Text style={styles.h1}>A few minutes of reflection becomes something you can share.</Text>
            <Text style={[styles.body, { marginTop: 20 }]}>
              Burrow turns the parts you choose into adorable memory items, creating a shared space
              that grows with both of you.
            </Text>
            {/* expo-image plays and loops animated GIFs natively. */}
            <OnboardingImage animated source={ICONS.obHowItWorksGif} style={styles.howGif} contentFit="cover" />
            <Text style={[styles.privacySmall, { marginTop: 16 }]}>
              Reflect privately. Share selectively. Stay connected naturally.
            </Text>
            <View style={{ flex: 1 }} />
            <Btn label="Continue" onPress={next} />
          </ScrollView>
        </OnboardingPage>

        <OnboardingPage id="space" imageCount={1}>
          <ScrollView removeClippedSubviews={false} showsVerticalScrollIndicator={false} contentContainerStyle={styles.center}>
            <View style={{ flex: 1 }} />
            <Text style={styles.h1}>A shared space where your lives naturally meet.</Text>
            <Text style={[styles.body, { marginTop: 20 }]}>
              Add the widget to your Home Screen and see the latest moments they&apos;ve chosen to share.
            </Text>
            <OnboardingImage source={ICONS.obWidgetPhone} style={styles.widgetPhone} contentFit="contain" />
            <Text style={styles.spaceCaption}>
              So you can reach out with more understanding, or simply let them know you&apos;re there.
            </Text>
            <View style={{ flex: 1 }} />
            <Btn label="Continue" onPress={next} />
          </ScrollView>
        </OnboardingPage>

        <OnboardingPage id="insights" imageCount={0}>
          <ScrollView removeClippedSubviews={false} showsVerticalScrollIndicator={false} contentContainerStyle={styles.center}>
            <View style={{ flex: 1 }} />
            <Text style={styles.h1}>The little things tell a bigger story</Text>
            <Text style={[styles.body, { marginTop: 20 }]}>
              Turns everyday reflections into moments worth noticing, natural ways to reach out,
              and playful patterns between you.
            </Text>
            <ScrollView
              ref={insightCarouselRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              snapToInterval={insightCardStep}
              snapToAlignment="start"
              decelerationRate="fast"
              disableIntervalMomentum
              nestedScrollEnabled
              contentContainerStyle={styles.insightCarouselContent}
              style={styles.insightCarousel}
              onMomentumScrollEnd={(event) => {
                const nextIndex = Math.max(0, Math.min(
                  INSIGHT_CAROUSEL_CARDS.length - 1,
                  Math.round(event.nativeEvent.contentOffset.x / insightCardStep),
                ));
                setInsightCardIndex(nextIndex);
              }}
            >
              {INSIGHT_CAROUSEL_CARDS.map((card) => (
                <OnboardingInsightCard key={card.label} card={card} width={insightCardWidth} />
              ))}
            </ScrollView>
            <View style={styles.insightCarouselDots}>
              {INSIGHT_CAROUSEL_CARDS.map((card, cardIndex) => (
                <Pressable
                  key={card.label}
                  accessibilityRole="button"
                  accessibilityLabel={`Show insight card ${cardIndex + 1} of ${INSIGHT_CAROUSEL_CARDS.length}`}
                  onPress={() => {
                    void haptics.light();
                    setInsightCardIndex(cardIndex);
                    insightCarouselRef.current?.scrollTo({ x: cardIndex * insightCardStep, animated: true });
                  }}
                  hitSlop={8}
                  style={[
                    styles.insightCarouselDot,
                    cardIndex === insightCardIndex && styles.insightCarouselDotActive,
                  ]}
                />
              ))}
            </View>
            <View style={{ flex: 1 }} />
            <Btn label="Continue" onPress={next} />
          </ScrollView>
        </OnboardingPage>

        <OnboardingPage id="boundaries" imageCount={2}>
          <ScrollView removeClippedSubviews={false} showsVerticalScrollIndicator={false} contentContainerStyle={styles.center}>
            <View style={{ flex: 1 }} />
            <Text style={styles.h1}>Close doesn&apos;t have to mean exposed.</Text>
            <Text style={styles.boundaryIntro}>
              Your reflections begin privately.{'\n'}
              You decide what enters your shared space.
            </Text>
            <View style={styles.boundaryVisualWrap}>
              <OnboardingImage
                source={ICONS.obPrivacyPanel}
                style={styles.boundaryVisual}
                contentFit="contain"
              />
              <OnboardingImage
                source={ICONS.privacy}
                style={styles.boundaryPrivacyIcon}
                contentFit="contain"
              />
            </View>
            <Text style={styles.boundaryFooter}>Your moments. Your boundaries. Your choice.</Text>
            <View style={{ flex: 1 }} />
            <Btn label="Continue" onPress={next} />
          </ScrollView>
        </OnboardingPage>

        <OnboardingPage id="creator" imageCount={1}>
          <ScrollView removeClippedSubviews={false} showsVerticalScrollIndicator={false} contentContainerStyle={styles.center}>
            <View style={{ flex: 1, minHeight: 16 }} />
            <View>
              <View style={styles.card}>
                <OnboardingImage source={ICONS.obCreatorBubble} style={styles.creatorBubbleImg} contentFit="contain" />
                <Text style={[styles.h3, { marginBottom: 14 }]}>I built Burrow from a regret.</Text>
                <Text style={styles.creatorBody}>
                  I learned too late how quietly closeness can disappear. I lost my partner who was
                  the love of my life and my best friend. For one year, we lived apart and both
                  became busy. There was no big fight, and we never stopped caring. We simply
                  stopped sharing the little things, the bad day, the random story, the tiny win.
                </Text>
                <Text style={[styles.creatorBody, { marginTop: 14 }]}>
                  By the time I noticed, I no longer knew how to reach them except “How was your
                  day?”. I still carry that regret. I can’t change what happened, but I hope I can
                  help someone else avoid the same regret.
                </Text>
                <Text style={[styles.creatorBody, { marginTop: 14 }]}>
                  Burrow is a private space for two. You reflect separately, keep your private words
                  private, and share the small moments that feel right. They become little glimpses
                  into each other’s days, without making either of you explain everything in busy
                  day, and with real time insights about when and how to reach out or simply give
                  them space.
                </Text>
                <Text style={[styles.creatorBody, { marginTop: 14 }]}>
                  Not to tell you how to run your relationship. Just to help you notice the moments
                  when showing up could mean something.
                </Text>
                <Text style={[styles.creatorBody, { marginTop: 14 }]}>
                  Burrow only takes a couple of minutes a day. But those couple of minutes can help
                  you stay part of each other’s lives. And sometimes, that’s all it takes to keep
                  someone from becoming a stranger.
                </Text>
              </View>
            </View>
            <View style={{ flex: 1, minHeight: 16 }} />
            <Btn label="Continue" onPress={next} />
          </ScrollView>
        </OnboardingPage>

        <OnboardingPage id="paywall" imageCount={1}>
          <ScrollView removeClippedSubviews={false} showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
            <View style={[styles.center, { minHeight: '100%' }]}>
              <Pressable onPress={() => { void haptics.pageClose(); setIdx(FLOW.indexOf('name')); }} style={styles.closeCircle} hitSlop={10}>
                <MaterialIcons name="close" size={22} color="#FFFFFF" />
              </Pressable>
              <View style={{ flex: 1, minHeight: 56 }} />
              <Text style={styles.h1}>Feel closer through the little things.</Text>
              <View style={styles.plusCard}>
                <OnboardingImage source={ICONS.obPaywallUnlock} style={styles.plusLockImg} contentFit="contain" />
                <View style={styles.plusTitleRow}>
                  <Text style={styles.plusTitle}>Burrow</Text>
                  <View style={styles.plusChip}><Text style={styles.plusChipText}>Plus</Text></View>
                </View>
                {DEFAULT_PLUS_BENEFITS.map((t, index) => (
                  <View key={t}>
                    <View style={styles.benefitRow}>
                      <MaterialIcons name="check-circle" size={22} color="#FFFFFF" />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.benefitTitle}>{t}</Text>
                      </View>
                    </View>
                    {index < DEFAULT_PLUS_BENEFITS.length - 1 && <View style={styles.benefitDivider} />}
                  </View>
                ))}
              </View>
              <Text style={[styles.privacySmall, { marginTop: 18 }]}>
                One Plus subscription unlocks the full experience for both of you.
              </Text>
              <View style={{ flex: 1, minHeight: 20 }} />
              <Btn label="Start Free Trial" onPress={onTryFree} />
            </View>
          </ScrollView>
        </OnboardingPage>

        <OnboardingPage id="plans" imageCount={0}>
          <ScrollView removeClippedSubviews={false} showsVerticalScrollIndicator={false} contentContainerStyle={styles.center}>
            <Pressable onPress={() => { void haptics.pageClose(); setIdx(FLOW.indexOf('name')); }} style={styles.closeCircle} hitSlop={10}>
              <MaterialIcons name="close" size={22} color="#FFFFFF" />
            </Pressable>
            <Text style={[styles.h1, { marginTop: 46 }]}>Choose your plan</Text>
            <Text style={[styles.privacySmall, { marginTop: 8, marginBottom: 26 }]}>
              Link their account to yours in the app, and they’ll{`\n`}
              get access to all Plus features too.
            </Text>
            <Pressable
              onPress={() => { void haptics.light(); setPlan('yearly'); }}
              style={[styles.planCard, plan === 'yearly' && styles.planCardOn]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.planTitle}>12 Months</Text>
                <Text style={styles.planPrice}>
                  <Text style={styles.planStrike}>{compareAt ?? '$83.88'}</Text>
                  {'  '}
                  {priceYearly ?? '$69.99'} ({perMonth ?? '$5.83'}/month)
                </Text>
              </View>
              <View style={styles.trialBadge}>
                <Text style={styles.trialBadgeText}>3 Days Free Trial</Text>
              </View>
            </Pressable>
            <Pressable
              onPress={() => { void haptics.light(); setPlan('monthly'); }}
              style={[styles.planCard, plan === 'monthly' && styles.planCardOn]}
            >
              <View>
                <Text style={styles.planTitle}>Monthly</Text>
                <Text style={styles.planPrice}>{priceMonthly ?? '$6.99'} every month</Text>
              </View>
            </Pressable>
            <View style={{ flex: 1 }} />
            <Btn
              label={plan === 'yearly' ? 'Start Free Trial' : 'Start My Plan'}
              onPress={() => void onStartPlan()}
              busy={purchasing}
            />
            {/* Apple 3.1.2: subscription terms + working legal links. */}
            <Text style={styles.disclosure}>
              {plan === 'yearly'
                ? 'Burrow Plus Yearly: $69.99 per 12 months after a 3-day free trial. '
                : 'Burrow Plus Monthly: $6.99 per month. '}
              Auto-renews unless cancelled at least 24 hours before the period ends.
              Cancel anytime in your App Store settings.
            </Text>
            <View style={[styles.legalRow, { marginBottom: insets.bottom + 8, marginTop: 8 }]}>
              <Pressable onPress={() => { void haptics.pageOpen(); void Linking.openURL('https://www.burrow-app.com/privacy'); }} hitSlop={8}>
                <Text style={styles.legalLink}>Privacy</Text>
              </Pressable>
              <Pressable onPress={() => { void haptics.pageOpen(); void Linking.openURL('https://www.burrow-app.com/terms'); }} hitSlop={8}>
                <Text style={styles.legalLink}>Terms</Text>
              </Pressable>
            </View>
          </ScrollView>
        </OnboardingPage>

        <OnboardingPage id="name" imageCount={1}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <ScrollView removeClippedSubviews={false} showsVerticalScrollIndicator={false} contentContainerStyle={styles.center} keyboardShouldPersistTaps="handled">
              <View style={{ flex: 1, minHeight: 24 }} />
              <Text style={styles.h1}>Name your bunny.</Text>
              <Text style={[styles.body, { marginTop: 12 }]}>
                They&apos;ll help you reflect, remember, and stay close to your person.
              </Text>
              <OnboardingImage source={ICONS.obBunnyHead} style={styles.bunny} contentFit="contain" />
              <TextInput
                style={[styles.nameInput, androidNameInputType]}
                placeholder="Type here"
                placeholderTextColor="#B7A88F"
                value={name}
                onChangeText={(t) => setName(t.slice(0, 15))}
                maxLength={15}
                textAlign="center"
                maxFontSizeMultiplier={Platform.OS === 'android' ? 1.15 : undefined}
              />
              <View style={{ flex: 1 }} />
              <Btn label="Start" onPress={() => void onFinishName()} busy={finishing} />
            </ScrollView>
          </KeyboardAvoidingView>
        </OnboardingPage>

        <OnboardingPage id="connect" imageCount={0}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <ScrollView removeClippedSubviews={false} showsVerticalScrollIndicator={false} contentContainerStyle={styles.center} keyboardShouldPersistTaps="handled">
              <Pressable
                onPress={() => { void haptics.pageOpen(); confirmSkipPurchasedAccountConnection(); }}
                style={styles.closeCircle}
                hitSlop={10}
              >
                <MaterialIcons name="close" size={22} color="#FFFFFF" />
              </Pressable>
              <Text style={[styles.h1, { marginTop: 56 }]}>Connect Your Account</Text>
              <Text style={[styles.body, { marginTop: 14 }]}>
                To keep your data safe, we recommend you connect an account for Burrow.
              </Text>
              <View style={{ height: 36 }} />
              {Platform.OS === 'ios' && (
                <Pressable
                  onPress={() => void onLinkProvider('apple')}
                  disabled={linking}
                  style={[styles.authBtnLight, linking && { opacity: 0.6 }]}
                >
                  <Text style={styles.authBtnLightText}>{'\uF8FF Sign in with Apple'}</Text>
                </Pressable>
              )}
              <Pressable
                onPress={() => void onLinkProvider('google')}
                disabled={linking}
                style={[styles.authBtnLight, linking && { opacity: 0.6 }]}
              >
                <Text style={styles.authBtnLightText}>{'G  Continue with Google'}</Text>
              </Pressable>
              {linkPhase === 'enter' ? (
                <>
                  <TextInput
                    style={[styles.nameInput, { marginTop: 6, textAlign: 'center' }, androidNameInputType]}
                    placeholder="you@example.com"
                    placeholderTextColor="#B7A88F"
                    value={linkEmail}
                    onChangeText={setLinkEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    maxFontSizeMultiplier={Platform.OS === 'android' ? 1.15 : undefined}
                  />
                  <Pressable
                    onPress={() => void onLinkEmail()}
                    disabled={linking || !linkEmail.includes('@')}
                    style={[styles.cta, { marginTop: 14, opacity: !linkEmail.includes('@') ? 0.5 : 1 }]}
                  >
                    {linking ? <ActivityIndicator color="#FFFFFF" /> : (
                      <Text style={styles.ctaText}>Connect with Email</Text>
                    )}
                  </Pressable>
                </>
              ) : (
                <>
                  <Text style={styles.linkCodeHint}>
                    We sent a 6-digit code to {linkEmail.trim()}. Enter it below.
                  </Text>
                  <TextInput
                    style={[styles.nameInput, styles.linkCodeInput, androidCodeInputType]}
                    placeholder="123456"
                    placeholderTextColor="#B7A88F"
                    value={linkCode}
                    onChangeText={(t) => setLinkCode(t.replace(/[^0-9]/g, '').slice(0, 6))}
                    keyboardType="number-pad"
                    autoFocus
                    maxLength={6}
                    maxFontSizeMultiplier={Platform.OS === 'android' ? 1.15 : undefined}
                  />
                  <Pressable
                    onPress={() => void onVerifyLinkCode()}
                    disabled={linking || linkCode.length !== 6}
                    style={[styles.cta, { marginTop: 14, opacity: linkCode.length !== 6 || linking ? 0.5 : 1 }]}
                  >
                    {linking ? <ActivityIndicator color="#FFFFFF" /> : (
                      <Text style={styles.ctaText}>Verify Code</Text>
                    )}
                  </Pressable>
                  <Pressable onPress={() => { void haptics.pageOpen(); setLinkPhase('enter'); setLinkCode(''); }} hitSlop={8}>
                    <Text style={styles.loginLink}>Use a different email</Text>
                  </Pressable>
                </>
              )}
              <Pressable
                onPress={() => {
                  void haptics.pageOpen();
                  const promptNotification = shouldPromptNotifAfterPurchase();
                  if (promptNotification) markNotifPromptedAfterPurchase();
                  router.replace({
                    pathname: '/(auth)/sign-in',
                    params: promptNotification ? { after: 'notification-settings' } : {},
                  } as never);
                }}
                hitSlop={8}
              >
                <Text style={styles.loginLink}>Already have an account? Log in</Text>
              </Pressable>
              <View style={{ flex: 1, minHeight: 20 }} />
              <Text style={[styles.legalCenter, { marginBottom: insets.bottom + 14 }]}>
                By continuing, you agree to Burrow&apos;s Terms &amp; Conditions and acknowledge the
                Privacy Policy
              </Text>
            </ScrollView>
          </KeyboardAvoidingView>
        </OnboardingPage>
        </OnboardingPager>
      </View>
      <Modal
        visible={sampleDetailsOpen}
        transparent
        statusBarTranslucent
        navigationBarTranslucent
        animationType="slide"
        onRequestClose={() => setSampleDetailsOpen(false)}
      >
        <View style={styles.sampleDetailOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setSampleDetailsOpen(false)}
            accessibilityLabel="Close memory details"
          />
          <View style={[styles.sampleDetailSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.sampleDetailHeader}>
              <ExpoImage source={SAMPLE_AVATAR} style={styles.sampleDetailAvatar} contentFit="cover" />
              <Text style={styles.sampleDetailName} numberOfLines={1}>Mom</Text>
              <Text style={styles.sampleDetailTime}>10h ago</Text>
            </View>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.sampleDetailScroll}
            >
              {SAMPLE_DAY.map((sample) => (
                <View key={sample.itemId} style={styles.sampleDetailCard}>
                  <ItemSprite itemId={sample.itemId} size={72} radius={14} />
                  <Text style={styles.sampleDetailText}>{sample.note}</Text>
                </View>
              ))}
            </ScrollView>
            <Pressable
              onPress={() => { void haptics.light(); setSampleDetailsOpen(false); }}
              style={styles.sampleDetailClose}
              hitSlop={10}
              accessibilityLabel="Close memory details"
            >
              <MaterialIcons name="close" size={28} color="#FFFFFF" />
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
    </OnboardingTextScaleContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 22 },
  center: { flexGrow: 1, alignItems: 'stretch' },

  h1: { fontSize: 30, lineHeight: 40, fontFamily: 'Inter_800ExtraBold', color: INK, textAlign: 'center' },
  heroTitle: { fontSize: 32, lineHeight: 42, fontFamily: 'Inter_800ExtraBold', color: INK, textAlign: 'center' },
  h2: { fontSize: 19, fontFamily: 'Inter_500Medium', color: '#3F3428', textAlign: 'center', marginTop: 14 },
  h3: { fontSize: 21, fontFamily: 'Inter_800ExtraBold', color: INK, textAlign: 'center' },
  body: { fontSize: 17, lineHeight: 25, fontFamily: 'Inter_500Medium', color: '#3F3428', textAlign: 'center' },
  privacySmall: {
    fontSize: 13.5, lineHeight: 20, fontFamily: 'Inter_600SemiBold',
    color: '#6B5B44', textAlign: 'center',
  },
  qmarkIcon: { width: 94, height: 94, alignSelf: 'center', marginBottom: 24 },

  iconsGrid: { width: '100%', height: 320, marginBottom: 28 },

  card: { backgroundColor: CARD, borderRadius: 28, padding: 26 },
  cardTitle: { fontSize: 22, lineHeight: 32, fontFamily: 'Inter_800ExtraBold', color: INK, textAlign: 'center' },
  cardBodyBold: { fontSize: 17, lineHeight: 26, fontFamily: 'Inter_700Bold', color: '#2B2318', textAlign: 'center' },

  feedbackTitle: {
    fontSize: 30, lineHeight: 39, fontFamily: 'Inter_800ExtraBold',
    color: INK, textAlign: 'center',
  },
  feedbackBody: {
    marginTop: 24, fontSize: 16, lineHeight: 23, fontFamily: 'Inter_500Medium',
    color: '#2B2318', textAlign: 'center',
  },
  feedbackPromptWrap: { alignItems: 'center' },
  feedbackPromptBubble: {
    width: '78%', minHeight: 76, borderRadius: 32,
    backgroundColor: '#8C5948',
    paddingHorizontal: 22, paddingVertical: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  feedbackPromptText: {
    fontSize: 16, lineHeight: 21, fontFamily: 'Inter_800ExtraBold',
    color: '#FFFFFF', textAlign: 'center',
  },
  feedbackPromptTail: {
    width: 0, height: 0, marginTop: -1,
    borderLeftWidth: 15, borderRightWidth: 15, borderTopWidth: 22,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#8C5948',
  },
  feedbackLogo: { width: 72, height: 72, marginTop: 2 },

  boundaryIntro: {
    marginTop: 38, fontSize: 17, lineHeight: 26,
    fontFamily: 'Inter_500Medium', color: '#2B2318', textAlign: 'center',
  },
  boundaryVisualWrap: {
    width: '100%', alignSelf: 'center', marginTop: 58,
    position: 'relative', justifyContent: 'center',
  },
  boundaryVisual: { width: '100%', aspectRatio: 700 / 180 },
  boundaryPrivacyIcon: {
    position: 'absolute', width: 58, height: 58,
    top: -29, left: '50%', marginLeft: -29,
  },
  boundaryFooter: {
    marginTop: 34, fontSize: 14.5, lineHeight: 21,
    fontFamily: 'Inter_500Medium', color: '#2B2318', textAlign: 'center',
  },

  optionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    backgroundColor: '#FFFCF4', borderRadius: 28, paddingVertical: 22, paddingHorizontal: 24,
    marginBottom: 16, borderWidth: 2.5, borderColor: 'transparent',
  },
  optionRowCenter: { justifyContent: 'center' },
  blockerOptionText: { width: '100%', textAlign: 'center' },
  optionRowOn: { borderColor: BTN },
  optionEmoji: { fontSize: 24 },
  optionIcon: { width: 48, height: 48 },
  plusLockImg: { width: 62, height: 62, alignSelf: 'center', marginTop: -52, marginBottom: 4 },
  creatorBubbleImg: { width: 56, height: 56, alignSelf: 'center', marginBottom: 6 },
  optionText: { fontSize: 19, fontFamily: 'Inter_700Bold', color: '#161311' },

  sampleCard: { backgroundColor: '#FFFDF8', borderRadius: 24, padding: 18, marginTop: 26 },
  sampleCardPressed: { transform: [{ translateY: 2 }], opacity: 0.96 },
  sampleHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  sampleAvatar: { width: 38, height: 38, borderRadius: 19 },
  sampleName: { flex: 1, fontSize: 18, fontFamily: 'Inter_800ExtraBold', color: '#161311' },
  sampleTime: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#9A8770' },
  sampleTile: { width: 44, height: 44, borderRadius: 12, overflow: 'hidden', backgroundColor: '#F4F1F8' },
  sampleRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' },
  sampleHint: { fontSize: 14.5, fontFamily: 'Inter_500Medium', color: '#3A2E1A', textAlign: 'center', marginTop: 16 },
  sampleDetailOverlay: {
    flex: 1, justifyContent: 'flex-end',
  },
  sampleDetailSheet: {
    height: '90%', backgroundColor: '#FBF7EE',
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 18, paddingHorizontal: 18,
  },
  sampleDetailHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  sampleDetailAvatar: { width: 46, height: 46, borderRadius: 23 },
  sampleDetailName: { flex: 1, fontSize: 24, fontFamily: 'Inter_800ExtraBold', color: '#1B1B1B' },
  sampleDetailTime: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#9A8770' },
  sampleDetailClose: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: '#4A3220',
    alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginTop: 12,
  },
  sampleDetailScroll: { gap: 14, paddingBottom: 12 },
  sampleDetailCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#FFFFFF', borderRadius: 22,
    borderWidth: 1.5, borderColor: '#E5C8B8', padding: 16,
  },
  sampleDetailText: {
    flex: 1, fontSize: 16, lineHeight: 24,
    fontFamily: 'Inter_500Medium', color: '#1B1B1B',
  },

  widgetPhone: { width: '90%', alignSelf: 'center', aspectRatio: 540 / 500, marginTop: 26 },
  spaceCaption: {
    marginTop: 12, fontSize: 14, lineHeight: 20,
    fontFamily: 'Inter_500Medium', color: '#3F3428', textAlign: 'center',
  },
  howGif: { width: '80%', alignSelf: 'center', aspectRatio: 1, marginTop: 26, borderRadius: 18, overflow: 'hidden' },
  insightCarousel: { flexGrow: 0, marginTop: 28, marginHorizontal: -22 },
  insightCarouselContent: {
    alignItems: 'flex-start', gap: 14, paddingHorizontal: 22, paddingRight: 44,
  },
  insightCarouselCard: {
    backgroundColor: '#FFF6E4', borderRadius: 26,
    paddingHorizontal: 20, paddingVertical: 20,
  },
  insightCarouselBadge: {
    alignSelf: 'flex-start', backgroundColor: '#F8D88B', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 8, marginBottom: 15,
  },
  insightCarouselBadgeText: {
    fontSize: 12.5, lineHeight: 17, fontFamily: 'Inter_700Bold', color: '#7A462A',
  },
  insightCarouselTitle: {
    fontSize: 18, lineHeight: 24, fontFamily: 'Inter_800ExtraBold',
    color: '#7A4E3B', marginBottom: 14,
  },
  insightCarouselObservation: {
    fontSize: 14.5, lineHeight: 20.5, fontFamily: 'Inter_700Bold', color: '#7A4E3B',
  },
  insightCarouselMeaning: {
    fontSize: 14, lineHeight: 20, fontFamily: 'Inter_500Medium',
    color: '#8A5B47', marginTop: 14,
  },
  insightCarouselAction: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    borderTopWidth: 1, borderTopColor: 'rgba(122,74,58,0.16)',
    marginTop: 16, paddingTop: 13,
  },
  insightCarouselActionText: {
    flex: 1, fontSize: 13.5, lineHeight: 19,
    fontFamily: 'Inter_700Bold', color: '#7A4E3B',
  },
  insightCarouselDots: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, marginTop: 14,
  },
  insightCarouselDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#D8B998' },
  insightCarouselDotActive: { width: 18, backgroundColor: '#7A4E3B' },

  creatorBubble: { fontSize: 34, textAlign: 'center', marginBottom: 6 },
  creatorBody: { fontSize: 15.5, lineHeight: 23, fontFamily: 'Inter_600SemiBold', color: '#2A2118' },

  closeCircle: {
    position: 'absolute', left: 10, top: 0, zIndex: 3,
    width: 44, height: 44, borderRadius: 22, backgroundColor: BTN,
    alignItems: 'center', justifyContent: 'center',
  },

  plusCard: { backgroundColor: '#7D6450', borderRadius: 26, padding: 20, marginTop: 30 },
  plusLock: { fontSize: 30, textAlign: 'center', marginTop: -40, marginBottom: 4 },
  plusTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 18 },
  plusTitle: { fontSize: 22, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
  plusChip: { backgroundColor: '#3B2A1C', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3 },
  plusChipText: { fontSize: 18, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
  benefitRow: { flexDirection: 'row', gap: 12, paddingVertical: 14, alignItems: 'center' },
  benefitDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.18)' },
  benefitTitle: { fontSize: 16.5, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },

  planCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: CARD, borderRadius: 22, padding: 20, marginBottom: 16,
    borderWidth: 2.5, borderColor: 'transparent',
  },
  planCardOn: { borderColor: BTN },
  planTitle: { fontSize: 21, fontFamily: 'Inter_800ExtraBold', color: '#161311' },
  planPrice: { fontSize: 15.5, fontFamily: 'Inter_600SemiBold', color: '#2A2118', marginTop: 6 },
  planStrike: { textDecorationLine: 'line-through', color: '#8A7A63' },
  trialBadge: { backgroundColor: BTN, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  trialBadgeText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  legalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12 },
  legalText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: INK },
  legalLink: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#6B5B44', textDecorationLine: 'underline' },
  disclosure: {
    fontSize: 11.5, lineHeight: 16, fontFamily: 'Inter_500Medium', color: '#7A6A52',
    textAlign: 'center', marginTop: 10, paddingHorizontal: 8,
  },
  legalCenter: { fontSize: 12.5, fontFamily: 'Inter_600SemiBold', color: '#3A2E1A', textAlign: 'center', lineHeight: 18 },

  bunny: { width: 180, height: 216, alignSelf: 'center', marginTop: 30, marginBottom: 30 },
  nameInput: {
    backgroundColor: CARD, borderRadius: 18, paddingVertical: 17, paddingHorizontal: 18,
    fontSize: 17, fontFamily: 'Inter_600SemiBold', color: '#2A2118',
  },

  authBtnLight: {
    backgroundColor: '#FFFFFF', borderRadius: 18, paddingVertical: 17,
    alignItems: 'center', marginBottom: 14,
  },
  authBtnLightText: { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#161311' },

  cta: { backgroundColor: BTN, borderRadius: 22, paddingVertical: 19, alignItems: 'center' },
  ctaText: { fontSize: 20, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
  loginLink: { fontSize: 16, fontFamily: 'Inter_800ExtraBold', color: '#161311', textAlign: 'center', marginTop: 20 },
  linkCodeHint: {
    fontSize: 14, lineHeight: 21, fontFamily: 'Inter_500Medium', color: '#6B5B44',
    textAlign: 'center', marginTop: 6, marginBottom: 10,
  },
  linkCodeInput: { marginTop: 0, textAlign: 'center', letterSpacing: 8, fontSize: 22, fontFamily: 'Inter_800ExtraBold' },
});
