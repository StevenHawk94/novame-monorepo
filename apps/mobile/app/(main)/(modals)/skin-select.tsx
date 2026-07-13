import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { SKIN_UNLOCKS, SKIN_COUNT } from '@novame/domain';
import { useTheme } from '../../../src/theme/use-theme';
import { haptics } from '../../../src/lib/haptics';
import { getCachedCompanion } from '../../../src/lib/companion-api';
import { getSelectedSkin, setSelectedSkin } from '../../../src/lib/cosmetics-store';
import { getCachedSubscriptionTier } from '../../../src/lib/subscription';
import { SKIN_IMAGES } from '../../../src/lib/cosmetic-images';

/**
 * Skin center (personalization panel). Six forms per companion: a default that's
 * always available, four unlocked by companion XP (400/1300/3000/5600), and a
 * sixth granted by subscription. The current companion's bundled art shows;
 * pets without art yet fall back to a placeholder tile. Picking an unlocked skin
 * stores it per-companion and Home reflects it on next focus.
 */
export default function SkinSelectScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { theme } = useTheme();
  const c = theme.colors;

  const companion = getCachedCompanion();
  const companionId = companion?.companionId ?? 'pet1';
  const xp = companion?.xp ?? 0;
  const isPaid = getCachedSubscriptionTier() !== 'free';
  const skinArt = SKIN_IMAGES[companionId];

  const [selected, setSelected] = useState(() => getSelectedSkin(companionId));

  function unlockedFor(index: number): { unlocked: boolean; hint: string } {
    const rule = SKIN_UNLOCKS[index];
    if (rule.kind === 'default') return { unlocked: true, hint: '' };
    if (rule.kind === 'subscription') {
      return isPaid ? { unlocked: true, hint: '' } : { unlocked: false, hint: 'Plus' };
    }
    // xp
    return xp >= rule.xp
      ? { unlocked: true, hint: '' }
      : { unlocked: false, hint: `${rule.xp.toLocaleString()} XP` };
  }

  function pick(index: number, unlocked: boolean, hint: string) {
    if (!unlocked) {
      void haptics.warning();
      if (hint === 'Plus') router.push('/(main)/(modals)/subscription-paywall');
      return;
    }
    void haptics.selection();
    const skinNumber = index + 1;
    setSelected(skinNumber);
    setSelectedSkin(companionId, skinNumber);
  }

  return (
    <View style={[styles.root, { backgroundColor: c.bgPrimary, paddingTop: insets.top + 8 }]}>
      <Pressable onPress={() => router.back()} style={styles.back} hitSlop={12}>
        <MaterialIcons name="arrow-back" size={24} color={c.textSecondary} />
      </Pressable>
      <Text style={[styles.title, { color: c.textPrimary }]}>Skins</Text>
      <Text style={[styles.sub, { color: c.textSecondary }]}>Unlock new looks as your companion grows.</Text>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.grid}>
        {Array.from({ length: SKIN_COUNT }).map((_, index) => {
          const { unlocked, hint } = unlockedFor(index);
          const skinNumber = index + 1;
          const isActive = selected === skinNumber;
          const art = skinArt?.[index];
          return (
            <Pressable
              key={index}
              onPress={() => pick(index, unlocked, hint)}
              style={[styles.card, isActive && { borderColor: c.brand.primary, borderWidth: 3 }]}
            >
              <View style={[styles.thumb, { backgroundColor: c.bgCard }]}>
                {art ? (
                  <Image source={art} style={styles.thumbImg} resizeMode="contain" />
                ) : (
                  <MaterialIcons name="pets" size={40} color={c.textMuted} />
                )}
                {!unlocked && (
                  <View style={styles.lockOverlay}>
                    <MaterialIcons name="lock" size={20} color="#FFFFFF" />
                    <Text style={styles.lockHint}>{hint}</Text>
                  </View>
                )}
                {isActive && (
                  <View style={[styles.activeBadge, { backgroundColor: c.brand.primary }]}>
                    <MaterialIcons name="check" size={14} color="#FFFFFF" />
                  </View>
                )}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20 },
  back: { alignSelf: 'flex-start', paddingVertical: 8 },
  title: { fontSize: 26, fontFamily: 'Inter_800ExtraBold', marginTop: 4 },
  sub: { fontSize: 14, fontFamily: 'Inter_400Regular', marginTop: 4, marginBottom: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingBottom: 32 },
  card: { width: '31%', marginBottom: 14 },
  thumb: { width: '100%', aspectRatio: 1, borderRadius: 16, overflow: 'hidden', position: 'relative', alignItems: 'center', justifyContent: 'center' },
  thumbImg: { width: '100%', height: '100%' },
  lockOverlay: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)', gap: 4 },
  lockHint: { color: '#FFFFFF', fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  activeBadge: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
});
