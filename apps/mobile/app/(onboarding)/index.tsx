import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { useTheme } from '../../src/theme/use-theme';
import { markIntroSeen, setChosenCompanion, type CompanionId } from '../../src/lib/onboarding';

/**
 * Pre-auth onboarding (C4).
 *
 * Three intro screens, a pet choice, and a paywall -- all before sign-in, so
 * there is no account yet. The pet choice is stashed locally (setChosenCompanion)
 * and synced into a companions row on first sign-in by signing-in.tsx. Images
 * are placeholders (colored panels) until art lands; the flow and copy are final.
 *
 * One file, a step index in state -- not five routes -- so Back/Next never
 * touches navigation history and the whole flow dismisses at once on completion.
 */

const INTRO = [
  {
    title: 'Everything you write turns into a memory you can see.',
    body: 'Each reflection becomes a little collectible \u2014 a visible piece of your day.',
  },
  {
    title: 'Decode and share them with the people you love.',
    body: '\u201cHow was your day?\u201d \u2014 send a memory, let them guess what it means.',
  },
  {
    title: 'Your memories make your companion grow.',
    body: 'The more you reflect, the stronger \u2014 and more stylish \u2014 your pet becomes.',
  },
];

const PETS: { id: CompanionId; label: string }[] = [
  { id: 'pet1', label: 'Pet One' },
  { id: 'pet2', label: 'Pet Two' },
  { id: 'pet3', label: 'Pet Three' },
];

export default function OnboardingScreen() {
  const { theme } = useTheme();
  const c = theme.colors;
  const router = useRouter();

  // 0,1,2 = intro; 3 = pick pet; 4 = paywall.
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<CompanionId | null>(null);

  function goToAuth() {
    markIntroSeen(); // this phone has now seen the intro; won't show it again
    router.replace('/(auth)/sign-in');
  }

  function confirmPet() {
    if (!picked) return;
    setChosenCompanion(picked); // stashed locally; synced on first sign-in
    setStep(4);
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.bgPrimary }]}>
      {/* ---- intro screens 0..2 ---- */}
      {step <= 2 && (
        <View style={styles.introWrap}>
          <View style={[styles.imagePlaceholder, { backgroundColor: c.bgCard, borderColor: c.border }]}>
            <Text style={[styles.placeholderText, { color: c.textMuted }]}>ob-{step + 1}</Text>
          </View>
          <View style={styles.introText}>
            <Text style={[styles.introTitle, { color: c.textPrimary }]}>{INTRO[step].title}</Text>
            <Text style={[styles.introBody, { color: c.textSecondary }]}>{INTRO[step].body}</Text>
          </View>
          <View style={styles.dots}>
            {INTRO.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  { backgroundColor: i === step ? c.brand.primary : c.progressTrack },
                ]}
              />
            ))}
          </View>
          <Pressable
            onPress={() => setStep(step + 1)}
            style={({ pressed }) => [styles.primaryBtn, { backgroundColor: c.brand.primary, opacity: pressed ? 0.85 : 1 }]}
          >
            <Text style={styles.primaryBtnText}>{step === 2 ? 'Choose your companion' : 'Next'}</Text>
          </Pressable>
        </View>
      )}

      {/* ---- pick pet (step 3) ---- */}
      {step === 3 && (
        <View style={styles.pickWrap}>
          <Text style={[styles.pickTitle, { color: c.textPrimary }]}>Pick your companion</Text>
          <Text style={[styles.pickSub, { color: c.textSecondary }]}>
            This one\u2019s yours to grow. Choose the one that feels right.
          </Text>
          <View style={styles.petRow}>
            {PETS.map((pet) => {
              const selected = picked === pet.id;
              return (
                <Pressable
                  key={pet.id}
                  onPress={() => setPicked(pet.id)}
                  style={[
                    styles.petCard,
                    {
                      backgroundColor: c.bgCard,
                      borderColor: selected ? c.brand.primary : c.border,
                      borderWidth: selected ? 2 : 1,
                    },
                  ]}
                >
                  <View style={[styles.petImage, { backgroundColor: c.progressTrack }]}>
                    <Text style={[styles.placeholderText, { color: c.textMuted }]}>{pet.id}</Text>
                  </View>
                  <Text style={[styles.petLabel, { color: c.textPrimary }]}>{pet.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            onPress={confirmPet}
            disabled={!picked}
            style={({ pressed }) => [
              styles.primaryBtn,
              { backgroundColor: c.brand.primary, opacity: !picked ? 0.4 : pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={styles.primaryBtnText}>Continue</Text>
          </Pressable>
        </View>
      )}

      {/* ---- paywall (step 4, placeholder) ---- */}
      {step === 4 && (
        <View style={styles.paywallWrap}>
          <Pressable onPress={goToAuth} style={styles.paywallClose} hitSlop={12}>
            <Text style={[styles.paywallCloseText, { color: c.textSecondary }]}>\u2715</Text>
          </Pressable>
          <ScrollView contentContainerStyle={styles.paywallScroll} showsVerticalScrollIndicator={false}>
            <Text style={[styles.paywallTitle, { color: c.textPrimary }]}>Go further with Plus</Text>
            <Text style={[styles.paywallSub, { color: c.textSecondary }]}>
              Deeper insight on every reflection, more scenes, and your companion\u2019s full wardrobe.
            </Text>
            <View style={[styles.paywallCard, { backgroundColor: c.bgCard, borderColor: c.border }]}>
              <Text style={[styles.paywallPlan, { color: c.textPrimary }]}>NovaMe Plus</Text>
              <Text style={[styles.paywallPrice, { color: c.brand.primary }]}>Coming soon</Text>
            </View>
            <Pressable
              onPress={goToAuth}
              style={({ pressed }) => [styles.primaryBtn, { backgroundColor: c.brand.primary, opacity: pressed ? 0.85 : 1 }]}
            >
              <Text style={styles.primaryBtnText}>Continue</Text>
            </Pressable>
            <Pressable onPress={goToAuth} style={styles.skipBtn}>
              <Text style={[styles.skipText, { color: c.textMuted }]}>Maybe later</Text>
            </Pressable>
          </ScrollView>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 24 },

  introWrap: { flex: 1, paddingTop: 20, paddingBottom: 24 },
  imagePlaceholder: {
    flex: 1,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
  },
  placeholderText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  introText: { marginBottom: 24 },
  introTitle: { fontSize: 26, fontFamily: 'Inter_700Bold', lineHeight: 34, marginBottom: 12 },
  introBody: { fontSize: 16, fontFamily: 'Inter_400Regular', lineHeight: 24 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 24 },
  dot: { width: 8, height: 8, borderRadius: 4 },

  pickWrap: { flex: 1, paddingTop: 40, paddingBottom: 24 },
  pickTitle: { fontSize: 26, fontFamily: 'Inter_700Bold', marginBottom: 8 },
  pickSub: { fontSize: 16, fontFamily: 'Inter_400Regular', lineHeight: 23, marginBottom: 32 },
  petRow: { flexDirection: 'row', justifyContent: 'space-between', flex: 1, maxHeight: 200 },
  petCard: {
    width: '31%',
    borderRadius: 20,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  petImage: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  petLabel: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },

  paywallWrap: { flex: 1, paddingTop: 12 },
  paywallClose: { alignSelf: 'flex-end', padding: 8 },
  paywallCloseText: { fontSize: 20, fontFamily: 'Inter_500Medium' },
  paywallScroll: { paddingTop: 20, paddingBottom: 40 },
  paywallTitle: { fontSize: 28, fontFamily: 'Inter_700Bold', marginBottom: 12 },
  paywallSub: { fontSize: 16, fontFamily: 'Inter_400Regular', lineHeight: 24, marginBottom: 32 },
  paywallCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    marginBottom: 24,
  },
  paywallPlan: { fontSize: 18, fontFamily: 'Inter_600SemiBold', marginBottom: 8 },
  paywallPrice: { fontSize: 24, fontFamily: 'Inter_700Bold' },
  skipBtn: { alignItems: 'center', paddingVertical: 16, marginTop: 4 },
  skipText: { fontSize: 15, fontFamily: 'Inter_500Medium' },

  primaryBtn: { borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  primaryBtnText: { color: '#FFFFFF', fontSize: 16, fontFamily: 'Inter_600SemiBold' },
});
