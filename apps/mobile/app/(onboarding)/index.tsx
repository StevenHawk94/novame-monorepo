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
import { ItemSheet, type ItemSheetRef } from '../../src/components/main/item-sheet';
import type { CollectedItem } from '../../src/lib/bags-api';
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
 * Burrow story flow on the beige grid: hook → who/what-blocks questions →
 * branch feedback → how-it-works pages → creator's words → the two-people
 * paywall → plans → Name Your Bunny → done. GUEST MODE: finishing creates an
 * ANONYMOUS session (no forced sign-in); Connect Your Account only appears
 * after a successful purchase, and is skippable there too.
 */
const INK = '#4A2F17';
const CARD = '#FFF4E3';
const BTN = '#4A3220';

const WHO_OPTIONS = [
  { key: 'partner', icon: ICONS.obWhoPartner, label: 'Partner' },
  { key: 'parent', icon: ICONS.obWhoFamily, label: 'Parent' },
  { key: 'child', icon: ICONS.obWhoFamily, label: 'Child' },
  { key: 'bestie', icon: ICONS.obWhoFriends, label: 'Best friend' },
  { key: 'special', icon: ICONS.obWhoSpecial, label: 'Someone special' },
];

const BLOCKER_OPTIONS = [
  { key: 'A', label: 'Our days get busy' },
  { key: 'B', label: 'We live far apart' },
  { key: 'C', label: 'I don’t want to overwhelm them' },
  { key: 'D', label: 'I’m not always sure what to say' },
];

const BLOCKER_FEEDBACK: Record<string, string> = {
  A: 'It’s easy to care deeply and still miss the little things.\n\nBy the time you finally talk, the small moments that made up the day are often already gone.',
  B: 'Distance doesn’t only separate places. It separates everyday moments.\n\nYou hear the big updates, but miss the tiny details that make you feel part of their life.',
  C: 'You shouldn’t have to choose between checking in and giving them space.\n\nSometimes the gentlest connection begins with letting them share when it feels right.',
  D: 'Closeness doesn’t always need a big conversation.\n\nSometimes one small glimpse into their day is enough to make talking feel natural again.',
};

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
const SAMPLE_DAY = [
  { itemId: 'memory.0896_avocado', displayName: 'Avocado', category: 'Food & Drink', note: 'Started the morning with avocado toast before a busy day.' },
  { itemId: 'memory.0132_banh_mi', displayName: 'Banh Mi', category: 'Food & Drink', note: 'Picked up a banh mi for a quick lunch between errands.' },
  { itemId: 'memory.4095_workbench', displayName: 'Workbench', category: 'Chores & Home Care', note: 'Spent the afternoon fixing a small project at the workbench.' },
  { itemId: 'memory.2851_toilet', displayName: 'Toilet', category: 'Chores & Home Care', note: 'Finally finished the bathroom clean-up I had been putting off.' },
  { itemId: 'memory.0005_baking', displayName: 'Baking', category: 'Food & Drink', note: 'Baked something sweet after dinner and saved a piece for tomorrow.' },
  { itemId: 'memory.1363_movie_theater', displayName: 'Movie Theater', category: 'Entertainment & Leisure', note: 'Ended the day with a cozy movie and finally slowed down.' },
];

const SAMPLE_ITEMS: CollectedItem[] = SAMPLE_DAY.map((sample, index) => {
  const createdAt = new Date(Date.now() - (SAMPLE_DAY.length - index) * 60 * 60 * 1000).toISOString();
  return {
    itemId: sample.itemId,
    displayName: sample.displayName,
    rarity: 'common',
    emoji: '📦',
    category: sample.category,
    count: 1,
    firstSeenAt: createdAt,
    memories: [{
      excerpt: sample.note,
      rawExcerpt: sample.note,
      createdAt,
    }],
  };
});

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
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [idx, setIdx] = useState(0);
  const [who, setWho] = useState<string | null>(null);
  const [blocker, setBlocker] = useState<string | null>(null);
  const sampleSheetRef = useRef<ItemSheetRef>(null);
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
            <Text style={styles.h1}>Stay close to the people who matter.</Text>
            <Text style={styles.h2}>Even when life gets busy.</Text>
            <View style={{ flex: 1 }} />
            <Btn label="Start" onPress={next} />
          </ScrollView>
        )}

        {step === 'someone' && (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.center}>
            <View style={{ flex: 1 }} />
            <ExpoImage source={ICONS.obQuestion} style={styles.qmarkIcon} contentFit="contain" />
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
        )}

        {step === 'who' && (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.center}>
            <View style={{ flex: 1, minHeight: 24 }} />
            <Text style={[styles.h1, { marginBottom: 26 }]}>Who came to mind?</Text>
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
            <Text style={[styles.h1, { marginBottom: 26 }]}>What tends to get in the way?</Text>
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
            <Text style={[styles.h3, { marginTop: 30 }]}>
              What if those little moments had somewhere to go?
            </Text>
            <View style={{ flex: 1 }} />
            <Btn label="Continue" onPress={next} />
          </ScrollView>
        )}

        {step === 'imagine' && (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.center}>
            <View style={{ flex: 1 }} />
            <Text style={styles.h1}>Imagine opening a little window into their day.</Text>
            <Text style={[styles.body, { marginTop: 18 }]}>
              No pressure to start a conversation. Just something real you can notice, remember,
              or reach out about.
            </Text>
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
                    onPress={() => { void haptics.light(); sampleSheetRef.current?.present(s.itemId); }}
                  >
                    <ItemSprite itemId={s.itemId} size={44} radius={12} />
                  </Pressable>
                ))}
              </View>
              <Text style={styles.sampleHint}>Tap an item to see its memory</Text>
            </View>
            <Text style={[styles.privacySmall, { marginTop: 18 }]}>
              They choose what becomes part of your shared space.
            </Text>
            <View style={{ flex: 1 }} />
            <Btn label="Continue" onPress={next} />
          </ScrollView>
        )}

        {step === 'how' && (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.center}>
            <View style={{ flex: 1 }} />
            <Text style={styles.h1}>A few minutes of reflection becomes something you can share.</Text>
            <Text style={[styles.body, { marginTop: 20 }]}>
              Reflect on your thoughts, feelings, and everyday moments. Burrow turns the parts you
              choose into adorable memory items, creating a shared space that grows with both of you.
            </Text>
            {/* expo-image plays and loops animated GIFs natively. */}
            <ExpoImage source={ICONS.obHowItWorksGif} style={styles.howGif} contentFit="cover" />
            <Text style={[styles.privacySmall, { marginTop: 16 }]}>
              Reflect privately. Share selectively. Stay connected naturally.
            </Text>
            <View style={{ flex: 1 }} />
            <Btn label="Continue" onPress={next} />
          </ScrollView>
        )}

        {step === 'space' && (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.center}>
            <View style={{ flex: 1 }} />
            <Text style={styles.h1}>A shared space where your lives naturally meet.</Text>
            <Text style={[styles.body, { marginTop: 20 }]}>
              Add the widget to your Home Screen and see the latest moments they&apos;ve chosen to share.
            </Text>
            <Text style={[styles.body, { marginTop: 14 }]}>
              Small glimpses into each other&apos;s lives, so you can reach out with more understanding,
              or simply let them know you&apos;re there.
            </Text>
            <ExpoImage source={ICONS.obWidgetPhone} style={styles.widgetPhone} contentFit="contain" />
            <View style={{ flex: 1 }} />
            <Btn label="Continue" onPress={next} />
          </ScrollView>
        )}

        {step === 'insights' && (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.center}>
            <View style={{ flex: 1 }} />
            <Text style={styles.h1}>Notice the patterns that are easy to miss.</Text>
            <Text style={[styles.body, { marginTop: 20 }]}>
              Gentle, private insights help you understand what has been bringing them energy,
              weighing on them, or helping them feel connected.
            </Text>
            <View style={styles.insightGrid}>
              {INSIGHT_PILLS.map((t) => (
                <View key={t.label} style={styles.insightPill}>
                  <ExpoImage source={t.icon} style={styles.insightIcon} contentFit="contain" />
                  <Text style={styles.insightPillText} numberOfLines={2}>{t.label}</Text>
                </View>
              ))}
            </View>
            <Text style={[styles.privacySmall, { marginTop: 16 }]}>
              Not judgments. Just thoughtful clues for showing up with care.
            </Text>
            <View style={{ flex: 1 }} />
            <Btn label="Continue" onPress={next} />
          </ScrollView>
        )}

        {step === 'boundaries' && (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.center}>
            <View style={{ flex: 1 }} />
            <Text style={styles.h1}>Close doesn&apos;t have to mean exposed.</Text>
            <View style={[styles.card, { marginTop: 26, paddingVertical: 34 }]}>
              <Text style={styles.cardBodyBold}>
                Your reflections begin privately.{'\n'}
                You decide what enters your shared space.{'\n'}
                You can change or remove what you share at any time.
              </Text>
              <Text style={[styles.cardBodyBold, { marginTop: 18 }]}>
                Your moments. Your boundaries. Your choice.
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
                <Text style={[styles.h3, { marginBottom: 14 }]}>I built Burrow for my mom.</Text>
                <Text style={styles.creatorBody}>
                  We live thousands of miles apart. We talked about once a month, and with work
                  moving so quickly, I felt like I was missing the small parts of her life, not the
                  big updates, but the everyday moments that make you feel close to someone.
                </Text>
                <Text style={[styles.creatorBody, { marginTop: 14 }]}>
                  Now we each take a few minutes to reflect. When I open Burrow, I might see what
                  made her smile, what she cooked, or what kind of day she had. She sees little
                  pieces of my life too.
                </Text>
                <Text style={[styles.creatorBody, { marginTop: 14 }]}>
                  Neither of us has to schedule another call or come up with the perfect thing to
                  say. We simply feel more present in each other&apos;s lives.
                </Text>
                <Text style={[styles.creatorBody, { marginTop: 14 }]}>
                  Everything in Burrow began with one question:{'\n'}
                  How can two people stay close without asking more from each other?
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
              <Text style={styles.h1}>Feel closer through the little things.</Text>
              <Text style={[styles.body, { marginTop: 14 }]}>
                One subscription creates a private space for two.
              </Text>
              <View style={styles.plusCard}>
                <ExpoImage source={ICONS.obPaywallUnlock} style={styles.plusLockImg} contentFit="contain" />
                <View style={styles.plusTitleRow}>
                  <Text style={styles.plusTitle}>Burrow</Text>
                  <View style={styles.plusChip}><Text style={styles.plusChipText}>Plus</Text></View>
                </View>
                {[
                  'Turn reflections into shared memories',
                  'See gentle connection insights',
                  'Stay present without adding pressure',
                  'Keep full control of what you share',
                ].map((t) => (
                  <View key={t} style={styles.benefitRow}>
                    <MaterialIcons name="check-circle" size={22} color="#FFFFFF" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.benefitTitle}>{t}</Text>
                    </View>
                  </View>
                ))}
              </View>
              <Text style={[styles.body, { marginTop: 18 }]}>
                Invite your person and start your Burrow together.
              </Text>
              <Text style={[styles.partnerIncluded, { marginTop: 8 }]}>
                Your person won&apos;t need to pay again.
              </Text>
              <View style={{ flex: 1, minHeight: 20 }} />
              <Btn label="Start Our Burrow" onPress={onTryFree} />
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
            <Btn label="Start Our Burrow" onPress={() => void onStartPlan()} busy={purchasing} />
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
                They&apos;ll help you reflect, remember, and stay close to your person.
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
      <ItemSheet ref={sampleSheetRef} items={SAMPLE_ITEMS} />
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
  privacySmall: {
    fontSize: 13.5, lineHeight: 20, fontFamily: 'Inter_600SemiBold',
    color: '#6B5B44', textAlign: 'center',
  },
  partnerIncluded: {
    fontSize: 14.5, lineHeight: 21, fontFamily: 'Inter_800ExtraBold',
    color: INK, textAlign: 'center',
  },
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
