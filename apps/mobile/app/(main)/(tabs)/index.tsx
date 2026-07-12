import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { requireAiConsent } from '@/lib/ai-consent';
import { haptics } from '@/lib/haptics';
import { hideSplashOnce } from '@/lib/splash';
import { fetchCompanion, getCachedCompanion, type CompanionState } from '@/lib/companion-api';
import { clearReflectLocal } from '@/lib/reflect-api';
import { clearQuietWinsLocal } from '@/lib/quiet-wins-api';
import { clearNewLensLocal } from '@/lib/lens-api';
import { devSetTier, getCachedSubscriptionTier } from '@/lib/subscription';
import { CompanionSheet, type CompanionSheetRef } from '@/components/main/companion-sheet';

/**
 * Home (C7). The companion lives here: a day/night scene, the pet in the middle
 * with a speech bubble, and the two permanent entries (Focus, Reflect) below.
 * Tapping the pet pulls up the interaction sheet with every Kit -- the daily
 * and weekly Kits no longer sit loose on Home, they live in that sheet.
 *
 * Scene art and pet art are placeholders (a tinted backdrop, an icon) until the
 * videos and backgrounds land; the layout and interaction are real. Day/night
 * is chosen from the local hour so the placeholder already shifts with time.
 *
 * hideSplashOnce() must be called by whatever screen renders first, or the
 * native splash never lifts.
 */
function isDaytime(): boolean {
  const h = new Date().getHours();
  return h >= 6 && h < 18;
}

function speechFor(day: boolean, companion: CompanionState | null): string {
  const name = companion?.name || 'me';
  void name;
  return day
    ? "I'm flowing through your shared moments."
    : "It's quiet now. A good time to look inward.";
}

export default function HomeScreen() {
  const router = useRouter();
  const sheetRef = useRef<CompanionSheetRef>(null);
  const [companion, setCompanion] = useState<CompanionState | null>(() => getCachedCompanion());
  const [tier, setTier] = useState(getCachedSubscriptionTier());
  const day = isDaytime();

  const onLayout = useCallback(() => {
    hideSplashOnce();
  }, []);

  useFocusEffect(
    useCallback(() => {
      setTier(getCachedSubscriptionTier());
      void fetchCompanion().then((c) => {
        if (c) setCompanion(c);
      });
    }, []),
  );

  const onReflect = () => {
    void haptics.medium();
    if (!requireAiConsent('/(main)/reflect')) return;
    router.push('/(main)/reflect');
  };
  const onFocus = () => {
    void haptics.medium();
    router.push('/(main)/focus');
  };
  const onPetTap = () => {
    void haptics.medium();
    sheetRef.current?.present();
  };

  const sceneBg = day ? '#BFE3F5' : '#241C4A';
  const groundBg = day ? '#A8D89A' : '#2A2450';

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: sceneBg }]} edges={['top']} onLayout={onLayout}>
      {/* Top bar: menu + right buttons (placeholder) */}
      <View style={styles.topBar}>
        <Pressable style={[styles.roundBtn, { backgroundColor: 'rgba(255,255,255,0.25)' }]} hitSlop={8}>
          <MaterialIcons name="menu" size={22} color="#FFFFFF" />
        </Pressable>
        <View style={styles.topRight}>
          {[0, 1, 2].map((i) => (
            <Pressable key={i} style={[styles.roundBtn, { backgroundColor: 'rgba(255,255,255,0.25)' }]} hitSlop={8}>
              <MaterialIcons name="palette" size={18} color="#FFFFFF" />
            </Pressable>
          ))}
        </View>
      </View>

      {/* Scene: speech bubble + pet placeholder */}
      <View style={styles.scene}>
        <View style={styles.bubble}>
          <Text style={styles.bubbleText}>{speechFor(day, companion)}</Text>
        </View>
        <Pressable onPress={onPetTap} style={styles.petTap} hitSlop={20}>
          <View style={[styles.petPlaceholder, { backgroundColor: day ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)' }]}>
            <MaterialIcons name="pets" size={64} color={day ? '#5B8FB0' : '#C0B4F0'} />
          </View>
          <Text style={styles.tapHint}>Tap to interact</Text>
        </Pressable>
      </View>

      {/* Ground + permanent entries */}
      <View style={[styles.ground, { backgroundColor: groundBg }]}>
        <View style={styles.entries}>
          <Pressable onPress={onFocus} style={styles.entryBtn}>
            <MaterialIcons name="diamond" size={20} color="#E85B5B" />
            <Text style={styles.entryText}>Focus</Text>
          </Pressable>
          <Pressable onPress={onReflect} style={styles.entryBtn}>
            <MaterialIcons name="eco" size={20} color="#4CAF82" />
            <Text style={styles.entryText}>Reflect</Text>
          </Pressable>
        </View>

        {__DEV__ && (
          <View style={styles.devRow}>
            <Pressable
              onPress={() => {
                clearQuietWinsLocal();
                clearNewLensLocal();
                clearReflectLocal();
              }}
            >
              <Text style={styles.devText}>[DEV] reset kits</Text>
            </Pressable>
            <Pressable
              onPress={async () => {
                const next = tier === 'free' ? 'pro' : 'free';
                const ok = await devSetTier(next);
                if (ok) setTier(next);
              }}
            >
              <Text style={styles.devText}>[DEV] {tier === 'free' ? 'free' : 'paid'}</Text>
            </Pressable>
          </View>
        )}
      </View>

      <CompanionSheet ref={sheetRef} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8,
  },
  topRight: { flexDirection: 'row', gap: 10 },
  roundBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },

  scene: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 },
  bubble: {
    backgroundColor: '#FFFFFF', borderRadius: 20, paddingHorizontal: 22, paddingVertical: 14,
    marginHorizontal: 24, maxWidth: '85%',
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
  },
  bubbleText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#2A2A3A', textAlign: 'center' },
  petTap: { alignItems: 'center', gap: 10 },
  petPlaceholder: {
    width: 160, height: 160, borderRadius: 80, alignItems: 'center', justifyContent: 'center',
  },
  tapHint: { fontSize: 12, fontFamily: 'Inter_500Medium', color: 'rgba(0,0,0,0.4)' },

  ground: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12, gap: 12 },
  entries: { flexDirection: 'row', gap: 12 },
  entryBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: 16, paddingVertical: 16,
  },
  entryText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#2A2A3A' },

  devRow: { flexDirection: 'row', justifyContent: 'center', gap: 20, paddingTop: 4 },
  devText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.5)' },
});
