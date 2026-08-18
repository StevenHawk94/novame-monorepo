import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { appAlert } from '@/components/ui/app-dialog';
import { Image as ExpoImage } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { haptics } from '../../src/lib/haptics';
import { ICONS } from '../../src/lib/icons';
import { GridBackground } from '../../src/components/ui/grid-background';
import { ItemSprite } from '../../src/components/ui/item-sprite';
import {
  markIntroSeen,
  setBunnyName,
  setChosenCompanion,
  setOnboardingChoices,
} from '../../src/lib/onboarding';
import {
  connectProviderOrSignIn, isAlreadyBoundError, sendLoginEmailOtp,
  verifyEmailChangeOtp, verifyLoginEmailOtp, ensureSession,
} from '../../src/lib/auth';
import { supabase } from '../../src/lib/supabase';
import { reportOnboardingChoices, updateDisplayName } from '../../src/lib/account-api';
import {
  fetchSubscriptionProducts,
  initIAP,
  purchaseSubscription,
} from '../../src/lib/iap';

/**
 * Onboarding v3 (2026-07-26 mocks 1:1) — the Burrow story flow on the beige
 * grid: hook → who/what-blocks questions (ob4's line answers ob3's choice) →
 * how-it-works pages → creator's words → the two-people paywall (Try for
 * Free → plans) → Name Your Bunny → done. GUEST MODE: finishing creates an
 * ANONYMOUS session (no forced sign-in); Connect Your Account only appears
 * after a successful purchase, and is skippable there too.
 */
const INK = '#4A2F17';
const CARD = '#FFF4E3';
const BTN = '#4A3220';

const WHO_OPTIONS = [
  { key: 'partner', icon: ICONS.obWhoPartner, label: 'Partner' },
  { key: 'bestie', icon: ICONS.obWhoFriends, label: 'Best friend' },
  { key: 'family', icon: ICONS.obWhoFamily, label: 'Family member' },
  { key: 'special', icon: ICONS.obWhoSpecial, label: 'Someone special' },
];

const BLOCKER_OPTIONS = [
  { key: 'A', label: 'Life gets busy' },
  { key: 'B', label: 'You live far apart' },
  { key: 'C', label: "You don't want to bother them" },
  { key: 'D', label: "You don't know what to talk about" },
];

// Ob3 inline feedback ↔ the picked blocker (2026-08-09 产品口径).
const BLOCKER_FEEDBACK: Record<string, string> = {
  A: 'Sometimes caring is easy. Finding the time is the hard part.',
  B: "Distance changes where you are, but it doesn't have to change how close you feel.",
  C: "Caring about someone shouldn't feel like adding pressure to their day.",
  D: "Sometimes the hardest part isn't caring — it's knowing where to start.",
};

// Ob4 — branched "I'm fine" screen (2026-08-09): each blocker gets its own
// title + body; every branch closes on the same subtitle so all four paths
// land into Ob5's reflection mockup.
const IMFINE_BRANCH: Record<string, { title: string; body: string }> = {
  A: {
    title: 'Tired of hearing "I\'m fine" when you\'re both just too busy to really talk?',
    body: "The truth is, people are only 100% honest when they're talking to themselves — not when they're squeezing in a quick reply between meetings.",
  },
  B: {
    title: 'Tired of hearing "I\'m fine" on a call that barely covers the basics?',
    body: "The truth is, people are only 100% honest when they're talking to themselves — not when they're catching up in a rushed, scheduled call.",
  },
  C: {
    title: 'Tired of getting "I\'m fine" because you didn\'t want to ask twice?',
    body: "The truth is, people are only 100% honest when they're talking to themselves — not when they're worried about being a bother by asking.",
  },
  D: {
    title: 'Tired of hearing "I\'m fine" because neither of you knew where to start?',
    body: "The truth is, people are only 100% honest when they're talking to themselves — not when they're trying to find the right thing to say.",
  },
};
const IMFINE_SUBTITLE =
  'What if you could turn the honesty of their day into something you could actually see?';

// Ob8's insight teasers — the SAME six pills the Connection tab shows while
// unpaired (status.tsx TEASER_PILLS), so the promise matches the product.
const INSIGHT_PILLS = [
  { label: 'Vibe Matching Moments', icon: ICONS.vibeMatching },
  { label: 'Emotion Status', icon: ICONS.emotionStatus },
  { label: 'Care Tips', icon: ICONS.careTips },
  { label: 'Topics Ideas', icon: ICONS.topicIdeas },
  { label: 'Boundaries', icon: ICONS.boundary },
  { label: 'Hangout Ideas', icon: ICONS.hangout },
];

// Ob5's tappable sample reflection (Jimmy's card). Keep these IDs on the
// current v25 catalog: the pre-v19 category-prefixed IDs no longer have bundled
// art and render as empty tiles.
const SAMPLE_AVATAR = require('../../assets/profile/default-3.webp');
const SAMPLE_DAY: { itemId: string; note: string }[] = [
  { itemId: 'memory.0005_baking', note: 'Baked an apple pie from scratch' },
  { itemId: 'memory.1363_movie_theater', note: 'A cozy movie night in' },
  { itemId: 'memory.2851_toilet', note: 'Finally deep-cleaned the bathroom' },
  { itemId: 'memory.0896_avocado', note: 'Perfectly ripe avocado at breakfast' },
  { itemId: 'memory.0132_banh_mi', note: 'Grabbed a banh mi for lunch' },
  { itemId: 'memory.4095_workbench', note: 'An afternoon tinkering at the workbench' },
];

type Step =
  | 'start' | 'someone' | 'who' | 'blocker' | 'feedback' | 'imfine' | 'honesty' | 'imagine'
  | 'how' | 'space' | 'insights' | 'boundaries' | 'creator'
  | 'paywall' | 'plans' | 'name' | 'connect';

const FLOW: Step[] = [
  'start', 'someone', 'who', 'blocker', 'feedback', 'imfine', 'honesty', 'imagine',
  'how', 'space', 'insights', 'boundaries', 'creator',
  'paywall', 'plans', 'name',
];

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [idx, setIdx] = useState(0);
  const [who, setWho] = useState<string | null>(null);
  const [blocker, setBlocker] = useState<string | null>(null);
  const [tappedSample, setTappedSample] = useState<string | null>(null);
  const [plan, setPlan] = useState<'yearly' | 'monthly'>('yearly');
  const [purchasing, setPurchasing] = useState(false);
  const [purchased, setPurchased] = useState(false);
  const [name, setName] = useState('');
  const [finishing, setFinishing] = useState(false);
  const [linkEmail, setLinkEmail] = useState('');
  const [linking, setLinking] = useState(false);
  const [linkCode, setLinkCode] = useState('');
  const [linkPhase, setLinkPhase] = useState<'enter' | 'verify'>('enter');
  const [linkMode, setLinkMode] = useState<'change' | 'login'>('change');
  // Store-localized prices (industry standard: StoreKit's displayPrice is the
  // truth per storefront/currency). The design-stub strings only show while
  // products haven't loaded (dev/simulator without StoreKit config).
  const [priceYearly, setPriceYearly] = useState<string | null>(null);
  const [priceMonthly, setPriceMonthly] = useState<string | null>(null);
  const [perMonth, setPerMonth] = useState<string | null>(null);
  const [compareAt, setCompareAt] = useState<string | null>(null);
  const pricesFetched = useRef(false);


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

  async function onStartPlan() {
    if (purchasing) return;
    void haptics.medium();
    setPurchasing(true);
    try {
      await initIAP();
      const outcome = await purchaseSubscription(
        plan === 'yearly' ? 'novame.plus.yearly' : 'novame.plus.monthly',
      );
      if (outcome.kind === 'completed' || outcome.kind === 'scheduled') {
        setPurchased(true);
      }
    } catch (e) {
      // Surface the underlying StoreKit reason — a silent catch made
      // failures undiagnosable (2026-08-07).
      const detail = e instanceof Error ? e.message : String(e);
      console.warn('[onboarding] purchase failed:', detail);
      appAlert(
        'Purchase didn’t go through',
        `You can subscribe anytime from the app.\n\n(${detail})`,
      );
    } finally {
      setPurchasing(false);
      setIdx(FLOW.indexOf('name'));
    }
  }

  async function onFinishName() {
    if (finishing) return;
    void haptics.medium();
    setFinishing(true);
    if (name.trim()) setBunnyName(name);
    setChosenCompanion('pet1');
    setOnboardingChoices(who ?? '', blocker ?? '');
    markIntroSeen();
    // Guest mode: an anonymous session carries the whole app. Connect only
    // pops after payment (skippable); everyone else goes straight in.
    const ok = await ensureSession();
    setFinishing(false);
    if (!ok) {
      router.replace('/(auth)/sign-in');
      return;
    }
    // The onboarding name is also the user's default display name (2026-08-09
    // ruling) — write it to profiles so friends/partners see a real name
    // instead of the signup seed ('user'). Fire-and-forget.
    void supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id;
      if (!uid) return;
      if (name.trim()) void updateDisplayName(uid, name.trim().slice(0, 16)).catch(() => {});
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
    setLinking(true);
    const res = await connectProviderOrSignIn(provider);
    setLinking(false);
    if (res.ok) {
      appAlert(
        res.mode === 'linked' ? 'Account connected' : 'Welcome back!',
        res.mode === 'linked'
          ? 'Your memories are now safe on this account.'
          : 'Your account and memories have been restored.',
        [{ text: 'OK', onPress: () => router.replace('/(auth)/signing-in') }],
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
    const { error } = await supabase.auth.updateUser({ email });
    if (!error) {
      setLinking(false);
      setLinkMode('change');
      setLinkPhase('verify'); // Supabase mailed the 6-digit binding code
      return;
    }
    if (!isAlreadyBoundError(error.message)) {
      setLinking(false);
      appAlert('Could not connect', 'You can connect your account anytime from settings.');
      return;
    }
    // Returning user: the address already has an account — log back in.
    const login = await sendLoginEmailOtp(email);
    setLinking(false);
    if (!login.ok) {
      appAlert('Could not connect', login.error ?? 'Please try again.');
      return;
    }
    setLinkMode('login');
    setLinkPhase('verify');
  }

  async function onVerifyLinkCode() {
    const token = linkCode.trim();
    if (token.length !== 6 || linking) return;
    setLinking(true);
    const res = linkMode === 'change'
      ? await verifyEmailChangeOtp(linkEmail.trim(), token)
      : await verifyLoginEmailOtp(linkEmail.trim(), token);
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
      [{ text: 'OK', onPress: () => router.replace('/(auth)/signing-in') }],
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
    <View style={{ flex: 1, backgroundColor: '#F8E2C1' }}>
      <GridBackground />
      <View style={[styles.root, { paddingTop: insets.top + 18 }]}>
        {step === 'start' && (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.center}>
            <View style={{ flex: 1 }} />
            <ExpoImage source={ICONS.obIcons} style={styles.iconsGrid} contentFit="contain" />
            <Text style={styles.h1}>Stay close to the{'\n'}people who matter.</Text>
            <Text style={styles.h2}>By collecting memories together.</Text>
            <View style={{ flex: 1 }} />
            <Btn label="Start" onPress={next} />
          </ScrollView>
        )}

        {step === 'someone' && (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.center}>
            <View style={{ flex: 1 }} />
            <ExpoImage source={ICONS.obQuestion} style={styles.qmarkIcon} contentFit="contain" />
            <Text style={styles.h1}>
              Is there someone you wish you could be closer to?
            </Text>
            <Text style={[styles.body, { marginTop: 22 }]}>
              If there is, you already know you care deeply, but life doesn&apos;t always let you be
              there for the little things.
            </Text>
            <View style={{ flex: 1 }} />
            <Btn label="Yes, I have someone like this" onPress={next} />
          </ScrollView>
        )}

        {step === 'who' && (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.center}>
            <View style={{ flex: 1, minHeight: 24 }} />
            <Text style={[styles.h1, { marginBottom: 26 }]}>Who is this person to you?</Text>
            {WHO_OPTIONS.map((o) => (
              <Pressable
                key={o.key}
                onPress={() => { void haptics.light(); setWho(o.key); }}
                style={[styles.optionRow, who === o.key && styles.optionRowOn]}
              >
                <ExpoImage source={o.icon} style={styles.optionIcon} contentFit="contain" />
                <Text style={styles.optionText}>{o.label}</Text>
              </Pressable>
            ))}
            <View style={{ flex: 1 }} />
            <Btn label="Continue" onPress={next} disabled={!who} />
          </ScrollView>
        )}

        {step === 'blocker' && (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.center}>
            <View style={{ flex: 1, minHeight: 24 }} />
            <Text style={[styles.h1, { marginBottom: 26 }]}>What makes it harder to stay close?</Text>
            {BLOCKER_OPTIONS.map((o) => (
              <Pressable
                key={o.key}
                onPress={() => { void haptics.light(); setBlocker(o.key); }}
                style={[styles.optionRow, styles.optionRowCenter, blocker === o.key && styles.optionRowOn]}
              >
                <Text style={styles.optionText}>{o.label}</Text>
              </Pressable>
            ))}
            <View style={{ flex: 1 }} />
            <Btn label="Continue" onPress={next} disabled={!blocker} />
          </ScrollView>
        )}

        {step === 'feedback' && (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.center}>
            <View style={{ flex: 1 }} />
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{BLOCKER_FEEDBACK[blocker ?? 'A']}</Text>
            </View>
            <View style={{ flex: 1 }} />
            <Btn label="Continue" onPress={next} />
          </ScrollView>
        )}

        {step === 'imfine' && (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.center}>
            <View style={{ flex: 1 }} />
            <Text style={styles.h1}>{IMFINE_BRANCH[blocker ?? 'A'].title}</Text>
            <View style={[styles.card, { marginTop: 26 }]}>
              <Text style={styles.body}>{IMFINE_BRANCH[blocker ?? 'A'].body}</Text>
            </View>
            <View style={{ flex: 1 }} />
            <Btn label="Continue" onPress={next} />
          </ScrollView>
        )}

        {step === 'honesty' && (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.center}>
            <View style={{ flex: 1 }} />
            <Text style={styles.h1}>{IMFINE_SUBTITLE}</Text>
            <View style={{ flex: 1 }} />
            <Btn label="Continue" onPress={next} />
          </ScrollView>
        )}

        {step === 'imagine' && (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.center}>
            <View style={{ flex: 1 }} />
            <Text style={styles.h1}>Imagine getting this reflection from that person.</Text>
            {/* Mock 2026-08-10: Jimmy's reflection card — avatar + name + time,
                then the six tappable items. */}
            <View style={styles.sampleCard}>
              <View style={styles.sampleHeader}>
                <ExpoImage source={SAMPLE_AVATAR} style={styles.sampleAvatar} contentFit="cover" />
                <Text style={styles.sampleName}>Jimmy</Text>
                <Text style={styles.sampleTime}>10h ago</Text>
              </View>
              <View style={styles.sampleRow}>
                {SAMPLE_DAY.map((s) => (
                  <Pressable
                    key={s.itemId}
                    onPress={() => { void haptics.light(); setTappedSample(s.itemId); }}
                  >
                    <ItemSprite itemId={s.itemId} size={44} radius={12} />
                  </Pressable>
                ))}
              </View>
              <Text style={styles.sampleHint}>
                {tappedSample
                  ? SAMPLE_DAY.find((s) => s.itemId === tappedSample)?.note
                  : 'Tap to see details'}
              </Text>
            </View>
            <Text style={[styles.h3, { marginTop: 30 }]}>
              Can you tell what their day was like without a single text?
            </Text>
            <View style={{ flex: 1 }} />
            <Btn label="Continue" onPress={next} />
          </ScrollView>
        )}

        {step === 'how' && (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.center}>
            <View style={{ flex: 1 }} />
            <Text style={styles.h1}>That&apos;s how it works.</Text>
            <Text style={[styles.body, { marginTop: 20 }]}>
              Simply reflect on your day. Your thoughts, feelings, and experiences become adorable
              memory items.
            </Text>
            <Text style={[styles.body, { marginTop: 14 }]}>
              Creating a private space between you and that special person.
            </Text>
            {/* expo-image plays and loops animated GIFs natively. */}
            <ExpoImage source={ICONS.obHowItWorksGif} style={styles.howGif} contentFit="cover" />
            <View style={{ flex: 1 }} />
            <Btn label="Continue" onPress={next} />
          </ScrollView>
        )}

        {step === 'space' && (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.center}>
            <View style={{ flex: 1 }} />
            <Text style={styles.h1}>A private space where your lives naturally connect.</Text>
            <Text style={[styles.body, { marginTop: 20 }]}>
              Add a widget and catch small glimpses of their day, right from your homescreen.
            </Text>
            <Text style={[styles.body, { marginTop: 14 }]}>
              Reach out when they need you. Give them space when they don&apos;t.
            </Text>
            <ExpoImage source={ICONS.obWidgetPhone} style={styles.widgetPhone} contentFit="contain" />
            <View style={{ flex: 1 }} />
            <Btn label="Continue" onPress={next} />
          </ScrollView>
        )}

        {step === 'insights' && (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.center}>
            <View style={{ flex: 1 }} />
            <Text style={styles.h1}>
              Understand them a little better, every day, with AI-powered connection insights.
            </Text>
            <Text style={[styles.body, { marginTop: 20 }]}>
              Gentle insights that help you know when, and how, to show up.
            </Text>
            <View style={styles.insightGrid}>
              {INSIGHT_PILLS.map((t) => (
                <View key={t.label} style={styles.insightPill}>
                  <ExpoImage source={t.icon} style={styles.insightIcon} contentFit="contain" />
                  <Text style={styles.insightPillText} numberOfLines={2}>{t.label}</Text>
                </View>
              ))}
            </View>
            <View style={{ flex: 1 }} />
            <Btn label="Continue" onPress={next} />
          </ScrollView>
        )}

        {step === 'boundaries' && (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.center}>
            <View style={{ flex: 1 }} />
            <Text style={styles.h1}>Your moments.{'\n'}Your boundaries.</Text>
            <View style={[styles.card, { marginTop: 26, paddingVertical: 34 }]}>
              <Text style={styles.cardBodyBold}>
                Choose what to show.{'\n'}Choose what stays private.
              </Text>
              <Text style={[styles.cardBodyBold, { marginTop: 18 }]}>
                Your connection should feel{'\n'}comfortable for both of you.
              </Text>
            </View>
            <View style={{ flex: 1 }} />
            <Btn label="Continue" onPress={next} />
          </ScrollView>
        )}

        {step === 'creator' && (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.center}>
            <View style={{ flex: 1, minHeight: 16 }} />
            <View>
              <View style={styles.card}>
                <ExpoImage source={ICONS.obCreatorBubble} style={styles.creatorBubbleImg} contentFit="contain" />
                <Text style={[styles.h3, { marginBottom: 14 }]}>Words from the app creator</Text>
                <Text style={styles.creatorBody}>
                  I built this to stay connected with my mom. We live thousands of miles apart, we
                  talk every month, but with a busy work life, I couldn&apos;t stay close to her
                  day-to-day.
                </Text>
                <Text style={[styles.creatorBody, { marginTop: 14 }]}>
                  Now, every time I open the app, I know what she ate, where she went, how
                  she&apos;s really doing — and she knows mine — without either of us needing to
                  carve out time for a call.
                </Text>
                <Text style={[styles.creatorBody, { marginTop: 14 }]}>
                  She loves it too. It lets her see my life in a way that feels light and fun, not
                  like one more thing to manage. Everything I&apos;ve built into this app started as
                  something I wanted for the two of us.
                </Text>
              </View>
            </View>
            <View style={{ flex: 1, minHeight: 16 }} />
            <Btn label="Continue" onPress={next} />
          </ScrollView>
        )}

        {step === 'paywall' && (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
            <View style={[styles.center, { minHeight: '100%' }]}>
              <Pressable onPress={() => setIdx(FLOW.indexOf('name'))} style={styles.closeCircle} hitSlop={10}>
                <MaterialIcons name="close" size={22} color="#FFFFFF" />
              </Pressable>
              <View style={{ flex: 1, minHeight: 56 }} />
              <Text style={styles.h1}>One Subscription for{'\n'}Two People.</Text>
              <Text style={[styles.body, { marginTop: 14 }]}>
                90% of users feel closer to their person. Not because they talk more, because they
                talk better.
              </Text>
              <View style={styles.plusCard}>
                <ExpoImage source={ICONS.obPaywallUnlock} style={styles.plusLockImg} contentFit="contain" />
                <View style={styles.plusTitleRow}>
                  <Text style={styles.plusTitle}>Burrow</Text>
                  <View style={styles.plusChip}><Text style={styles.plusChipText}>Plus</Text></View>
                </View>
                {[
                  'Build memories with barely any effort.',
                  'Connection insights that respect your boundaries.',
                  'Daily tools that help you feel grounded and ready.',
                  'Stay close and connected, naturally.',
                ].map((t) => (
                  <View key={t} style={styles.benefitRow}>
                    <MaterialIcons name="check-circle" size={22} color="#FFFFFF" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.benefitTitle}>{t}</Text>
                    </View>
                  </View>
                ))}
              </View>
              <View style={{ flex: 1, minHeight: 20 }} />
              <Btn label="Try for Free" onPress={onTryFree} />
            </View>
          </ScrollView>
        )}

        {step === 'plans' && (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.center}>
            <Pressable onPress={() => setIdx(FLOW.indexOf('name'))} style={styles.closeCircle} hitSlop={10}>
              <MaterialIcons name="close" size={22} color="#FFFFFF" />
            </Pressable>
            <Text style={[styles.h1, { marginTop: 46, marginBottom: 26 }]}>Choose your plan</Text>
            <Pressable
              onPress={() => { void haptics.light(); setPlan('yearly'); }}
              style={[styles.planCard, plan === 'yearly' && styles.planCardOn]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.planTitle}>12 Months</Text>
                <Text style={styles.planPrice}>
                  <Text style={styles.planStrike}>{compareAt ?? '$119.98'}</Text>
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
            <Btn label="Start My Plan" onPress={() => void onStartPlan()} busy={purchasing} />
            {/* Apple 3.1.2: subscription terms + working legal links. */}
            <Text style={styles.disclosure}>
              {plan === 'yearly'
                ? 'Burrow Plus Yearly: $69.99 per 12 months after a 3-day free trial. '
                : 'Burrow Plus Monthly: $6.99 per month. '}
              Auto-renews unless cancelled at least 24 hours before the period ends.
              Cancel anytime in your App Store settings.
            </Text>
            <View style={[styles.legalRow, { marginBottom: insets.bottom + 8, marginTop: 8 }]}>
              <Pressable onPress={() => void Linking.openURL('https://www.burrow-app.com/privacy')} hitSlop={8}>
                <Text style={styles.legalLink}>Privacy</Text>
              </Pressable>
              <Pressable onPress={() => void Linking.openURL('https://www.burrow-app.com/terms')} hitSlop={8}>
                <Text style={styles.legalLink}>Terms</Text>
              </Pressable>
            </View>
          </ScrollView>
        )}

        {step === 'name' && (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.center} keyboardShouldPersistTaps="handled">
              <View style={{ flex: 1, minHeight: 24 }} />
              <Text style={styles.h1}>Name your bunny.</Text>
              <Text style={[styles.body, { marginTop: 12 }]}>
                They&apos;ll be your reflection and connection guide along the way.
              </Text>
              <ExpoImage source={ICONS.obBunnyHead} style={styles.bunny} contentFit="contain" />
              <TextInput
                style={styles.nameInput}
                placeholder="Type here"
                placeholderTextColor="#B7A88F"
                value={name}
                onChangeText={(t) => setName(t.slice(0, 30))}
                textAlign="center"
              />
              <View style={{ flex: 1 }} />
              <Btn label="Start" onPress={() => void onFinishName()} busy={finishing} />
            </ScrollView>
          </KeyboardAvoidingView>
        )}

        {step === 'connect' && (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.center} keyboardShouldPersistTaps="handled">
              <Pressable
                onPress={() => router.replace('/(auth)/signing-in')}
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
                    style={[styles.nameInput, { marginTop: 6, textAlign: 'center' }]}
                    placeholder="you@example.com"
                    placeholderTextColor="#B7A88F"
                    value={linkEmail}
                    onChangeText={setLinkEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
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
                    style={[styles.nameInput, styles.linkCodeInput]}
                    placeholder="123456"
                    placeholderTextColor="#B7A88F"
                    value={linkCode}
                    onChangeText={(t) => setLinkCode(t.replace(/[^0-9]/g, '').slice(0, 6))}
                    keyboardType="number-pad"
                    autoFocus
                    maxLength={6}
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
                  <Pressable onPress={() => { setLinkPhase('enter'); setLinkCode(''); }} hitSlop={8}>
                    <Text style={styles.loginLink}>Use a different email</Text>
                  </Pressable>
                </>
              )}
              <Pressable onPress={() => router.replace('/(auth)/sign-in')} hitSlop={8}>
                <Text style={styles.loginLink}>Already have an account? Log in</Text>
              </Pressable>
              <View style={{ flex: 1, minHeight: 20 }} />
              <Text style={[styles.legalCenter, { marginBottom: insets.bottom + 14 }]}>
                By continuing, you agree to Burrow&apos;s Terms &amp; Conditions and acknowledge the
                Privacy Policy
              </Text>
            </ScrollView>
          </KeyboardAvoidingView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 22 },
  center: { flexGrow: 1, alignItems: 'stretch' },

  h1: { fontSize: 30, lineHeight: 40, fontFamily: 'Inter_800ExtraBold', color: INK, textAlign: 'center' },
  h2: { fontSize: 19, fontFamily: 'Inter_500Medium', color: '#3F3428', textAlign: 'center', marginTop: 14 },
  h3: { fontSize: 21, fontFamily: 'Inter_800ExtraBold', color: INK, textAlign: 'center' },
  body: { fontSize: 17, lineHeight: 25, fontFamily: 'Inter_500Medium', color: '#3F3428', textAlign: 'center' },
  qmarkIcon: { width: 94, height: 94, alignSelf: 'center', marginBottom: 24 },

  iconsGrid: { width: '100%', height: 320, marginBottom: 28 },

  card: { backgroundColor: CARD, borderRadius: 28, padding: 26 },
  cardTitle: { fontSize: 22, lineHeight: 32, fontFamily: 'Inter_800ExtraBold', color: INK, textAlign: 'center' },
  cardBodyBold: { fontSize: 17, lineHeight: 26, fontFamily: 'Inter_700Bold', color: '#2B2318', textAlign: 'center' },

  optionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    backgroundColor: '#FFFCF4', borderRadius: 28, paddingVertical: 22, paddingHorizontal: 24,
    marginBottom: 16, borderWidth: 2.5, borderColor: 'transparent',
  },
  optionRowCenter: { justifyContent: 'center' },
  optionRowOn: { borderColor: BTN },
  optionEmoji: { fontSize: 24 },
  optionIcon: { width: 48, height: 48 },
  plusLockImg: { width: 62, height: 62, alignSelf: 'center', marginTop: -52, marginBottom: 4 },
  creatorBubbleImg: { width: 56, height: 56, alignSelf: 'center', marginBottom: 6 },
  optionText: { fontSize: 19, fontFamily: 'Inter_700Bold', color: '#161311' },

  sampleCard: { backgroundColor: '#FFFDF8', borderRadius: 24, padding: 18, marginTop: 26 },
  sampleHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  sampleAvatar: { width: 38, height: 38, borderRadius: 19 },
  sampleName: { flex: 1, fontSize: 18, fontFamily: 'Inter_800ExtraBold', color: '#161311' },
  sampleTime: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#9A8770' },
  sampleRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' },
  sampleHint: { fontSize: 14.5, fontFamily: 'Inter_500Medium', color: '#3A2E1A', textAlign: 'center', marginTop: 16 },

  widgetPhone: { width: '100%', aspectRatio: 540 / 500, marginTop: 26 },
  howGif: { width: '80%', alignSelf: 'center', aspectRatio: 1, marginTop: 26, borderRadius: 18, overflow: 'hidden' },
  // Same visual system as the Connection tab's unpaired teaser pills.
  insightGrid: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center',
    columnGap: 8, rowGap: 14, marginTop: 30,
  },
  insightPill: {
    width: '48%', backgroundColor: '#FFFFFF', borderRadius: 18,
    flexDirection: 'row', alignItems: 'center', gap: 9,
    paddingVertical: 14, paddingHorizontal: 10, minHeight: 64,
    shadowColor: '#C9A97C', shadowOpacity: 0.8, shadowRadius: 0, shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  insightIcon: { width: 26, height: 26 },
  insightPillText: { flex: 1, fontSize: 13.5, fontFamily: 'Inter_700Bold', color: '#161311' },

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
  benefitRow: { flexDirection: 'row', gap: 12, marginBottom: 14, alignItems: 'flex-start' },
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
