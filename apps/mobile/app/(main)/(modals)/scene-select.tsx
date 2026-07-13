import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { HOME_SCENES } from '@novame/domain';
import { useTheme } from '../../../src/theme/use-theme';
import { haptics } from '../../../src/lib/haptics';
import { getSelectedScene, setSelectedScene } from '../../../src/lib/cosmetics-store';
import { getCachedSubscriptionTier } from '../../../src/lib/subscription';
import { SCENE_IMAGES } from '../../../src/lib/cosmetic-images';

function isDaytime(): boolean {
  const h = new Date().getHours();
  return h >= 6 && h < 18;
}

/**
 * Scene switcher (personalization panel). Six backdrops; free users get the
 * first two, the rest are Plus. Bundled scenes show their real art; the others
 * fall back to the placeholder tint until their webp lands. Picking a scene
 * stores it locally and Home reflects it on next focus.
 */
export default function SceneSelectScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { theme } = useTheme();
  const c = theme.colors;
  const day = isDaytime();

  const isPaid = getCachedSubscriptionTier() !== 'free';
  const [selected, setSelected] = useState(() => getSelectedScene());

  function pick(sceneId: string, locked: boolean) {
    if (locked) {
      void haptics.warning();
      router.push('/(main)/(modals)/subscription-paywall');
      return;
    }
    void haptics.selection();
    setSelected(sceneId);
    setSelectedScene(sceneId);
  }

  return (
    <View style={[styles.root, { backgroundColor: c.bgPrimary, paddingTop: insets.top + 8 }]}>
      <Pressable onPress={() => router.back()} style={styles.back} hitSlop={12}>
        <MaterialIcons name="arrow-back" size={24} color={c.textSecondary} />
      </Pressable>
      <Text style={[styles.title, { color: c.textPrimary }]}>Scenes</Text>
      <Text style={[styles.sub, { color: c.textSecondary }]}>Choose the world your companion lives in.</Text>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.grid}>
        {HOME_SCENES.map((scene) => {
          const locked = !scene.free && !isPaid;
          const isActive = selected === scene.id;
          const art = SCENE_IMAGES[scene.id];
          const tint = day ? scene.dayBg : scene.nightBg;
          return (
            <Pressable
              key={scene.id}
              onPress={() => pick(scene.id, locked)}
              style={[styles.card, isActive && { borderColor: c.brand.primary, borderWidth: 3 }]}
            >
              <View style={styles.thumb}>
                {art ? (
                  <Image source={day ? art.day : art.night} style={styles.thumbImg} resizeMode="cover" />
                ) : (
                  <View style={[styles.thumbImg, { backgroundColor: tint }]} />
                )}
                {locked && (
                  <View style={styles.lockOverlay}>
                    <MaterialIcons name="lock" size={22} color="#FFFFFF" />
                  </View>
                )}
                {isActive && (
                  <View style={[styles.activeBadge, { backgroundColor: c.brand.primary }]}>
                    <MaterialIcons name="check" size={14} color="#FFFFFF" />
                  </View>
                )}
              </View>
              <Text style={[styles.cardTitle, { color: c.textPrimary }]}>{scene.title}</Text>
              {!scene.free && <Text style={[styles.plusTag, { color: c.brand.purpleLight }]}>PLUS</Text>}
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingBottom: 32, gap: 4 },
  card: { width: '48%', marginBottom: 18 },
  thumb: { width: '100%', aspectRatio: 1, borderRadius: 16, overflow: 'hidden', position: 'relative' },
  thumbImg: { width: '100%', height: '100%' },
  lockOverlay: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)' },
  activeBadge: { position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', marginTop: 8 },
  plusTag: { fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 1, marginTop: 2 },
});
