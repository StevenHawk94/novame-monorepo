import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { haptics } from '../../src/lib/haptics';
import { ICONS } from '../../src/lib/icons';
import { ItemSprite } from '../../src/components/ui/item-sprite';
import {
  markIntroSeen,
  setBunnyName,
  setChosenCompanion,
  setOnboardingChoices,
} from '../../src/lib/onboarding';
import { ensureSession } from '../../src/lib/auth';
import { supabase } from '../../src/lib/supabase';
import { initIAP, purchaseSubscription } from '../../src/lib/iap';

/**
 * Onboarding v3 (2026-07-26 mocks 1:1) — the BunnyUs story flow on the beige
 * grid: hook → who/what-blocks questions (ob4's line answers ob3's choice) →
 * how-it-works pages → creator's words → the two-people paywall (Try for
 * Free → plans) → Name Your Bunny → done. GUEST MODE: finishing creates an
 * ANONYMOUS session (no forced sign-in); Connect Your Account only appears
 * after a successful purchase, and is skippable there too.
 */
const INK = '#4A2F17';
const CARD = '#FDF3E3';
const BTN = '#4A3220';

const WHO_OPTIONS = [
  { key: 'partner', emoji: '❤️', label: 'Partner/Lover' },
  { key: 'bestie', emoji: '💖', label: 'Best friend' },
  { key: 'family', emoji: '🏠', label: 'Family member' },
  { key: 'special', emoji: '⭐', label: 'Someone special' },
];

const BLOCKER_OPTIONS = [
  { key: 'A', label: 'Life gets busy' },
  { key: 'B', label: 'You live far apart' },
  { key: 'C', label: "You don't want to bother them" },
  { key: 'D', label: "You don't know what to talk about" },
];

// ob4 反馈文案 ↔ ob3 选择 (2026-07-26 产品口径).
const BLOCKER_FEEDBACK: Record<string, string> = {
  A: 'Sometimes caring is easy. Finding the time is the hard part.',
  B: "Distance changes where you are, but it doesn't have to change how close you feel.",
  C: "Caring about someone shouldn't feel like adding pressure to their day.",
  D: "Sometimes the hardest part isn't caring — it's knowing where to start.",
};

// ob6's tappable sample day (renders whatever the current dictionary holds;
// unknown ids fall back to blank tiles, so this survives the taxonomy swap).
const SAMPLE_DAY: { itemId: string; note: string }[] = [
  { itemId: 'food.coffee', note: 'Morning coffee, extra hot' },
  { itemId: 'food.pancakes', note: 'Pancakes for a slow breakfast' },
  { itemId: 'sports.walking', note: 'A short walk after lunch' },
  { itemId: 'entertainment.movie', note: 'A movie night in' },
  { itemId: 'food.ramen', note: 'Ramen with a friend' },
  { itemId: 'emotions.happy', note: 'A genuinely good day' },
  { itemId: 'relax.reading', note: 'A few pages before bed' },
];

const PRIVATE_SPACE_ITEMS = [
  'food.coffee', 'food.pancakes', 'food.pizza', 'food.sushi', 'food.ice_cream', 'food.donut',
  'sports.running', 'sports.hiking', 'sports.swimming', 'entertainment.movie', 'entertainment.gaming', 'music.guitar',
  'emotions.happy', 'emotions.calm', 'relax.reading', 'plants.flower', 'animals.dog', 'nature.sun',
];

type Step =
  | 'start' | 'someone' | 'who' | 'blocker' | 'feedback' | 'notalk' | 'imagine'
  | 'how' | 'space' | 'insights' | 'boundaries' | 'routine' | 'creator'
  | 'paywall' | 'plans' | 'name' | 'connect';

const FLOW: Step[] = [
  'start', 'someone', 'who', 'blocker', 'feedback', 'notalk', 'imagine',
  'how', 'space', 'insights', 'boundaries', 'routine', 'creator',
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

  const step: Step = useMemo(
    () => (idx >= FLOW.length ? 'connect' : FLOW[idx]),
    [idx],
  );

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
    } catch {
      Alert.alert('Purchase didn’t go through', 'You can subscribe anytime from the app.');
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
    if (purchased) {
      setIdx(FLOW.length); // → connect
    } else {
      router.replace('/(auth)/signing-in');
    }
  }

  async function onLinkEmail() {
    const email = linkEmail.trim();
    if (!email.includes('@') || linking) return;
    setLinking(true);
    const { error } = await supabase.auth.updateUser({ email });
    setLinking(false);
    if (error) {
      Alert.alert('Could not connect', 'You can connect your account anytime from settings.');
      return;
    }
    Alert.alert('Check your inbox', `We sent a confirmation link to ${email}. Your memories are now safe.`);
    router.replace('/(auth)/signing-in');
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
    <ImageBackground source={ICONS.obGridBg} style={{ flex: 1 }} resizeMode="cover">
      <View style={[styles.root, { paddingTop: insets.top + 18 }]}>
        {step === 'start' && (
          <View style={styles.center}>
            <View style={{ flex: 1 }} />
            <Image source={ICONS.obIcons} style={styles.iconsGrid} resizeMode="contain" />
            <Text style={styles.h1}>Stay close to the{'\n'}people who matter.</Text>
            <Text style={styles.h2}>By Collecting Memories Together</Text>
            <View style={{ flex: 1 }} />
            <Btn label="Start" onPress={next} />
          </View>
        )}

        {step === 'someone' && (
          <View style={styles.center}>
            <View style={{ flex: 1 }} />
            <Text style={styles.qmark}>{'⁇'}</Text>
            <Text style={styles.h1}>
              Is there someone important to you whose everyday moments you wish you could be closer to?
            </Text>
            <Text style={[styles.body, { marginTop: 22 }]}>
              You care about them deeply, but life doesn&apos;t always let you be there for the little things.
            </Text>
            <View style={{ flex: 1.4 }} />
            <Btn label="Yes, I have someone like this" onPress={next} />
          </View>
        )}

        {step === 'who' && (
          <View style={styles.center}>
            <Text style={[styles.h1, { marginTop: 40, marginBottom: 26 }]}>Who is this person to you?</Text>
            {WHO_OPTIONS.map((o) => (
              <Pressable
                key={o.key}
                onPress={() => { void haptics.light(); setWho(o.key); }}
                style={[styles.optionRow, who === o.key && styles.optionRowOn]}
              >
                <Text style={styles.optionEmoji}>{o.emoji}</Text>
                <Text style={styles.optionText}>{o.label}</Text>
              </Pressable>
            ))}
            <View style={{ flex: 1 }} />
            <Btn label="Continue" onPress={next} disabled={!who} />
          </View>
        )}

        {step === 'blocker' && (
          <View style={styles.center}>
            <Text style={[styles.h1, { marginTop: 40, marginBottom: 26 }]}>What makes it harder to stay close?</Text>
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
          </View>
        )}

        {step === 'feedback' && (
          <View style={styles.center}>
            <View style={{ flex: 0.7 }} />
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{BLOCKER_FEEDBACK[blocker ?? 'A']}</Text>
              <Text style={[styles.cardTitle, { marginTop: 18 }]}>
                Small, everyday moments are often what&apos;s missing.
              </Text>
            </View>
            <View style={{ flex: 1.3 }} />
            <Btn label="Continue" onPress={next} />
          </View>
        )}

        {step === 'notalk' && (
          <View style={styles.center}>
            <View style={{ flex: 0.5 }} />
            <Text style={styles.h1}>Staying close doesn&apos;t have to mean talking all the time.</Text>
            <View style={[styles.card, { marginTop: 26 }]}>
              <Text style={styles.body}>
                By connecting everyday moments together, the two of you bond — almost without noticing.
              </Text>
              <Text style={[styles.body, { marginTop: 16 }]}>
                Your everyday moments can become a connection between you.
              </Text>
            </View>
            <View style={{ flex: 1.3 }} />
            <Btn label="Continue" onPress={next} />
          </View>
        )}

        {step === 'imagine' && (
          <View style={styles.center}>
            <View style={{ flex: 0.5 }} />
            <Text style={styles.h1}>Imagine this reflection from that person</Text>
            <View style={[styles.card, { marginTop: 26, paddingVertical: 22 }]}>
              <View style={styles.sampleRow}>
                {SAMPLE_DAY.map((s) => (
                  <Pressable
                    key={s.itemId}
                    onPress={() => { void haptics.light(); setTappedSample(s.itemId); }}
                  >
                    <ItemSprite itemId={s.itemId} size={40} radius={10} tileColor="transparent" />
                  </Pressable>
                ))}
              </View>
              <Text style={styles.sampleHint}>
                {tappedSample
                  ? SAMPLE_DAY.find((s) => s.itemId === tappedSample)?.note
                  : 'Tap to see details'}
              </Text>
            </View>
            <Text style={[styles.h3, { marginTop: 30 }]}>Can you tell how their day looks like?</Text>
            <View style={{ flex: 1.2 }} />
            <Btn label="Continue" onPress={next} />
          </View>
        )}

        {step === 'how' && (
          <View style={styles.center}>
            <View style={{ flex: 0.4 }} />
            <Text style={styles.h3}>That&apos;s how it works</Text>
            <Text style={[styles.h1, { marginTop: 16 }]}>
              Turn everyday moments into something meaningful. Simply reflect on your day.
            </Text>
            <View style={[styles.card, { marginTop: 26 }]}>
              <Text style={styles.body}>
                Your moments become meaningful memory items, automatically creating a private space
                between you and the people who matter.
              </Text>
            </View>
            <View style={{ flex: 1.2 }} />
            <Btn label="Continue" onPress={next} />
          </View>
        )}

        {step === 'space' && (
          <View style={styles.center}>
            <View style={{ flex: 0.4 }} />
            <Text style={styles.h1}>A private space where your lives naturally connect.</Text>
            <Text style={[styles.body, { marginTop: 20 }]}>
              Both of your memory items appear in a shared space between you.
            </Text>
            <Text style={[styles.body, { marginTop: 14 }]}>
              No need to ask.{'\n'}No need to explain.
            </Text>
            <Text style={[styles.body, { marginTop: 14 }]}>
              Just small glimpses into each other&apos;s lives.
            </Text>
            <View style={styles.spaceGrid}>
              {PRIVATE_SPACE_ITEMS.map((id) => (
                <ItemSprite key={id} itemId={id} size={36} radius={9} tileColor="transparent" />
              ))}
            </View>
            <View style={{ flex: 1 }} />
            <Btn label="Continue" onPress={next} />
          </View>
        )}

        {step === 'insights' && (
          <View style={styles.center}>
            <View style={{ flex: 0.5 }} />
            <Text style={styles.h1}>
              Understand them a little better, every day — gentle insights that help you be there.
            </Text>
            <View style={{ flex: 1.5 }} />
            <Btn label="Continue" onPress={next} />
          </View>
        )}

        {step === 'boundaries' && (
          <View style={styles.center}>
            <View style={{ flex: 0.4 }} />
            <Text style={styles.h1}>Your moments. Your boundaries.</Text>
            <View style={[styles.card, { marginTop: 26 }]}>
              <Text style={styles.body}>You decide what becomes part of your shared space.</Text>
              <Text style={[styles.body, { marginTop: 16 }]}>
                Choose what to show.{'\n'}Choose what stays private.
              </Text>
              <Text style={[styles.body, { marginTop: 16 }]}>
                Your connection should feel comfortable for both of you.
              </Text>
            </View>
            <View style={{ flex: 1.2 }} />
            <Btn label="Continue" onPress={next} />
          </View>
        )}

        {step === 'routine' && (
          <View style={styles.center}>
            <View style={{ flex: 0.4 }} />
            <Text style={styles.h1}>Easily Keep Up The Routine</Text>
            <View style={[styles.card, { marginTop: 26 }]}>
              <Text style={styles.body}>Some days it feels tiring to reflect.</Text>
              <Text style={[styles.body, { marginTop: 14 }]}>
                This app has multiple ways to collect your day — write freely, or simply tap your
                screen through gentle prompts.
              </Text>
              <Text style={[styles.body, { marginTop: 14 }]}>
                We also have a set of kits to make sure you start your day with energy and end it
                with healing.
              </Text>
              <Text style={[styles.body, { marginTop: 14 }]}>
                And everything you do makes your little bunny more vibing!!
              </Text>
            </View>
            <View style={{ flex: 1 }} />
            <Btn label="Continue" onPress={next} />
          </View>
        )}

        {step === 'creator' && (
          <View style={styles.center}>
            <View style={{ flex: 0.3 }} />
            <ScrollView showsVerticalScrollIndicator={false} style={{ flexGrow: 0 }}>
              <View style={styles.card}>
                <Text style={styles.creatorBubble}>{'💬'}</Text>
                <Text style={[styles.h3, { marginBottom: 14 }]}>Words from the App Creator</Text>
                <Text style={styles.creatorBody}>
                  &quot;I built this at the beginning to stay connected with my mom. We lived thousands
                  of miles apart — we call every month, but I wanted to feel her life right in front
                  of me every day. In a busy working life, I couldn&apos;t stay tuned with her all
                  the time.
                </Text>
                <Text style={[styles.creatorBody, { marginTop: 14 }]}>
                  After using this app, every day when I open it, I know what she ate, where she
                  visited, how she is doing — and she knows mine, without the burden of constant
                  calls while my time is occupied.
                </Text>
                <Text style={[styles.creatorBody, { marginTop: 14 }]}>
                  And she loves using it, because she gets to know my life in a cute way. The app
                  carries all the kits I built to help her feel good and motivated anytime she
                  needs.&quot;
                </Text>
              </View>
            </ScrollView>
            <View style={{ flex: 1 }} />
            <Btn label="Continue" onPress={next} />
          </View>
        )}

        {step === 'paywall' && (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
            <View style={[styles.center, { minHeight: '100%' }]}>
              <Pressable onPress={() => setIdx(FLOW.indexOf('name'))} style={styles.closeCircle} hitSlop={10}>
                <MaterialIcons name="close" size={22} color="#FFFFFF" />
              </Pressable>
              <Text style={[styles.h1, { marginTop: 44 }]}>One Subscription for Two People.</Text>
              <Text style={[styles.body, { marginTop: 14 }]}>
                Store your memories, and theirs.{'\n'}Then connection happens naturally.
              </Text>
              <View style={styles.plusCard}>
                <Text style={styles.plusLock}>{'🔓'}</Text>
                <Text style={styles.plusTitle}>BunnyUs Plus</Text>
                {[
                  ['Save the Hustle', 'Let AI organize your memories with beautiful detail.'],
                  ['Connection Up', 'Real-time insights to help you understand each other better.'],
                  ['Vibe Up', 'Unlock new outfits and scenes for your bunny.'],
                  ['Unlock access to Master Visit', 'Get deeper insight of your day from Master.'],
                ].map(([t, b]) => (
                  <View key={t} style={styles.benefitRow}>
                    <MaterialIcons name="check-circle" size={22} color="#FFFFFF" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.benefitTitle}>{t}</Text>
                      <Text style={styles.benefitBody}>{b}</Text>
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
          <View style={styles.center}>
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
                  <Text style={styles.planStrike}>$119.98</Text>  $69.99 ($5.83/month)
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
                <Text style={styles.planPrice}>$9.99 every month</Text>
              </View>
            </Pressable>
            <View style={{ flex: 1 }} />
            <Btn label="Start My Plan" onPress={() => void onStartPlan()} busy={purchasing} />
            <View style={[styles.legalRow, { marginBottom: insets.bottom + 8, marginTop: -6 }]}>
              <Text style={styles.legalText}>Privacy</Text>
              <Text style={styles.legalText}>Cancel Anytime</Text>
              <Text style={styles.legalText}>Terms</Text>
            </View>
          </View>
        )}

        {step === 'name' && (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.center}>
              <View style={{ flex: 0.5 }} />
              <Text style={styles.h1}>Name Your Bunny</Text>
              <Text style={[styles.body, { marginTop: 12 }]}>
                Give a name to your bunny that grows along the way.
              </Text>
              <Image source={ICONS.obBunnyHead} style={styles.bunny} resizeMode="contain" />
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
            </View>
          </KeyboardAvoidingView>
        )}

        {step === 'connect' && (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.center}>
              <Pressable
                onPress={() => router.replace('/(auth)/signing-in')}
                style={styles.closeCircle}
                hitSlop={10}
              >
                <MaterialIcons name="close" size={22} color="#FFFFFF" />
              </Pressable>
              <Text style={[styles.h1, { marginTop: 56 }]}>Connect Your Account</Text>
              <Text style={[styles.body, { marginTop: 14 }]}>
                To keep your data safe, we recommend you connect an account for BunnyUs.
              </Text>
              <View style={{ height: 36 }} />
              <Pressable
                onPress={() =>
                  Alert.alert(
                    'Coming soon',
                    'Apple linking lands shortly — connect with email for now, your data stays safe either way.',
                  )
                }
                style={styles.authBtnLight}
              >
                <Text style={styles.authBtnLightText}>{' Sign in with Apple'}</Text>
              </Pressable>
              <Pressable
                onPress={() =>
                  Alert.alert(
                    'Coming soon',
                    'Google linking lands shortly — connect with email for now, your data stays safe either way.',
                  )
                }
                style={styles.authBtnLight}
              >
                <Text style={styles.authBtnLightText}>{'G  Continue with Google'}</Text>
              </Pressable>
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
              <View style={{ flex: 1 }} />
              <Text style={[styles.legalCenter, { marginBottom: insets.bottom + 14 }]}>
                By continuing, you agree to BunnyUs&apos;s Terms &amp; Conditions and acknowledge the
                Privacy Policy
              </Text>
            </View>
          </KeyboardAvoidingView>
        )}
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 22 },
  center: { flex: 1, alignItems: 'stretch' },

  h1: { fontSize: 27, lineHeight: 36, fontFamily: 'Inter_800ExtraBold', color: INK, textAlign: 'center' },
  h2: { fontSize: 18, fontFamily: 'Inter_500Medium', color: '#3A2E1A', textAlign: 'center', marginTop: 14 },
  h3: { fontSize: 20, fontFamily: 'Inter_800ExtraBold', color: INK, textAlign: 'center' },
  body: { fontSize: 16.5, lineHeight: 24, fontFamily: 'Inter_500Medium', color: '#3A2E1A', textAlign: 'center' },
  qmark: { fontSize: 56, textAlign: 'center', color: INK, marginBottom: 22, fontFamily: 'Inter_800ExtraBold' },

  iconsGrid: { width: '100%', height: 300, marginBottom: 26 },

  card: { backgroundColor: CARD, borderRadius: 26, padding: 24 },
  cardTitle: { fontSize: 21, lineHeight: 30, fontFamily: 'Inter_800ExtraBold', color: INK, textAlign: 'center' },

  optionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: CARD, borderRadius: 24, paddingVertical: 19, paddingHorizontal: 20,
    marginBottom: 14, borderWidth: 2.5, borderColor: 'transparent',
  },
  optionRowCenter: { justifyContent: 'center' },
  optionRowOn: { borderColor: BTN, backgroundColor: '#FFFDF6' },
  optionEmoji: { fontSize: 24 },
  optionText: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#161311' },

  sampleRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, flexWrap: 'wrap' },
  sampleHint: { fontSize: 14.5, fontFamily: 'Inter_500Medium', color: '#3A2E1A', textAlign: 'center', marginTop: 16 },

  spaceGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 24,
  },

  creatorBubble: { fontSize: 34, textAlign: 'center', marginBottom: 6 },
  creatorBody: { fontSize: 15.5, lineHeight: 23, fontFamily: 'Inter_600SemiBold', color: '#2A2118' },

  closeCircle: {
    position: 'absolute', left: 0, top: 0, zIndex: 3,
    width: 44, height: 44, borderRadius: 22, backgroundColor: BTN,
    alignItems: 'center', justifyContent: 'center',
  },

  plusCard: { backgroundColor: 'rgba(90,64,40,0.85)', borderRadius: 26, padding: 20, marginTop: 30 },
  plusLock: { fontSize: 30, textAlign: 'center', marginTop: -40, marginBottom: 4 },
  plusTitle: { fontSize: 22, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF', textAlign: 'center', marginBottom: 16 },
  benefitRow: { flexDirection: 'row', gap: 12, marginBottom: 14, alignItems: 'flex-start' },
  benefitTitle: { fontSize: 16.5, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
  benefitBody: { fontSize: 14.5, lineHeight: 20, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.92)', marginTop: 2 },

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

  cta: { backgroundColor: BTN, borderRadius: 18, paddingVertical: 18, alignItems: 'center' },
  ctaText: { fontSize: 19, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
});
