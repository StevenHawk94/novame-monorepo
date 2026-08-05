import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import type { ImageSourcePropType } from 'react-native';

import { haptics } from '@/lib/haptics';
import { getCachedCompanion, type CompanionState } from '@/lib/companion-api';
import { isQuietWinsDoneToday } from '@/lib/quiet-wins-api';
import { isNewLensDoneToday } from '@/lib/lens-api';
import { isTameEnemyDoneToday } from '@/lib/tame-enemy-api';
import { getCachedStatus } from '@/lib/true-north-api';
import { ICONS } from '@/lib/icons';
import { WaveBackground, WAVE_PALETTES } from './wave-background';
import { getCachedCosmetics, fetchCosmetics } from '@/lib/cosmetics-api';

export type CompanionSheetRef = {
  present: () => void;
  dismiss: () => void;
  refresh: () => void;
};

interface KitRow {
  key: string;
  label: string;
  desc: string;
  icon: ImageSourcePropType;
  route?: string;
  done?: boolean;
  daily?: boolean;
  availText?: string;
}

interface DoneState {
  quietWins: boolean;
  newLens: boolean;
  trueNorth: boolean;
  tameEnemy: boolean;
}

function readDoneState(): DoneState {
  return {
    quietWins: isQuietWinsDoneToday(),
    newLens: isNewLensDoneToday(),
    trueNorth: !!getCachedStatus()?.doneThisWeek,
    tameEnemy: isTameEnemyDoneToday(),
  };
}

/**
 * Companion interaction sheet (Home). A warm orange gradient-wave card that
 * slides up: the companion's portrait, name, level + EXP bar, and the list of
 * Kits. Daily Kits drop out once done and return next day; permanent Kits (True
 * North weekly, Visit Master 48h) always show. Follows the design 1:1.
 */
export const CompanionSheet = forwardRef<CompanionSheetRef>((_, ref) => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const sheetH = screenH * 0.9;
  const sheetRef = useRef<BottomSheetModal>(null);
  const [companion, setCompanion] = useState<CompanionState | null>(() => getCachedCompanion());
  const [doneState, setDoneState] = useState<DoneState>(() => readDoneState());
  const snapPoints = useMemo(() => ['90%'], []);

  useImperativeHandle(ref, () => ({
    present: () => {
      setCompanion(getCachedCompanion());
      setDoneState(readDoneState());
      setBalance(getCachedCosmetics().balance);
      void fetchCosmetics().then((c) => setBalance(c.balance));
      sheetRef.current?.present();
    },
    dismiss: () => sheetRef.current?.dismiss(),
    refresh: () => {
      setCompanion(getCachedCompanion());
      setDoneState(readDoneState());
    },
  }));

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.5} />
    ),
    [],
  );

  const [balance, setBalance] = useState(() => getCachedCosmetics().balance);

  const trueNorthAvail = useMemo(() => {
    const dow = (new Date().getDay() + 6) % 7;
    const days = 7 - dow;
    return days === 1 ? 'New ranking tomorrow' : `New ranking in ${days} days`;
  }, []);

  const kits: KitRow[] = useMemo(() => {
    return [
      { key: 'new_lens', label: 'New Lens', desc: 'See something a different way', icon: ICONS.NewLens, route: '/(main)/new-lens', done: doneState.newLens, daily: true },
      { key: 'true_north', label: 'True North', desc: 'Rank what matters most right now', icon: ICONS.TrueNorth, route: '/(main)/true-north', done: doneState.trueNorth, availText: trueNorthAvail },
      { key: 'quiet_wins', label: 'Small Wins', desc: 'Notice the small things you did', icon: ICONS.SmallWins, route: '/(main)/quiet-wins', done: doneState.quietWins, daily: true },
      { key: 'tame_enemy', label: 'Tame Enemy', desc: "Face what's been loud lately", icon: ICONS.TameEnemy, route: '/(main)/tame-enemy', done: doneState.tameEnemy, daily: true },
      { key: 'visit_master', label: 'Visit Master', desc: 'Consult the Master \u2014 Plus', icon: ICONS.VisitMaster, route: '/(main)/visit-master' },
    ];
  }, [doneState, trueNorthAvail]);

  // Daily Kits vanish once done; permanent Kits always show.
  const visibleKits = kits.filter((k) => !(k.daily && k.done));

  function openKit(row: KitRow) {
    if (!row.route) return;
    void haptics.medium();
    router.push(row.route as never);
  }


  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      backdropComponent={renderBackdrop}
      handleComponent={null}
      backgroundStyle={styles.sheetBg}
      enableContentPanningGesture={false}
      enableHandlePanningGesture={false}
      enableOverDrag={false}
    >
      <BottomSheetView style={[styles.outer, { height: sheetH }]}>
        <WaveBackground palette={WAVE_PALETTES.orange} />
        {/* Inner framed content -- the double-border layer over the wave card. */}
        <View style={styles.inner}>
          <BottomSheetScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
            {/* Header: clovers balance (the Skills entry retired 2026-08-05
                with the card library — battle arguments live in Tame Enemy) */}
            <View style={styles.header}>
              <View style={styles.cloverPill}>
                <Text style={styles.cloverEmoji}>{'\u{1F340}'}</Text>
                <Text style={styles.cloverBalance}>{balance}</Text>
              </View>
            </View>
            <Text style={styles.name} numberOfLines={1}>{companion?.name || 'The Poppet'}</Text>
            <View style={styles.portraitWrap}>
              <Image source={ICONS.interact} style={styles.portrait} resizeMode="contain" />
            </View>
            <Text style={styles.hangout}>Hey, Let{'\u2019'}s hang out, You want to.....</Text>
            {visibleKits.map((kit) => (
              <Pressable
                key={kit.key}
                onPress={() => openKit(kit)}
                style={({ pressed }) => [styles.kitCard, pressed && styles.kitCardPressed]}
              >
                <Image source={kit.icon} style={styles.kitIcon} resizeMode="contain" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.kitLabel}>{kit.label}</Text>
                  <Text style={styles.kitDesc}>{kit.availText && kit.done ? kit.availText : kit.desc}</Text>
                </View>
              </Pressable>
            ))}
          </BottomSheetScrollView>
        </View>
        <Pressable onPress={() => sheetRef.current?.dismiss()} style={[styles.closeBtn, { bottom: insets.bottom + 12 }]} hitSlop={8}>
          <MaterialIcons name="close" size={26} color="#3A2A1A" />
        </Pressable>
      </BottomSheetView>
    </BottomSheetModal>
  );
});

CompanionSheet.displayName = 'CompanionSheet';

const styles = StyleSheet.create({
  sheetBg: { backgroundColor: 'transparent', borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  outer: { borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden', padding: 10 },
  // Inner framed layer: a rounded panel inset from the wave card, giving the
  // double-border depth from the design. Slightly translucent so the wave shows.
  inner: {
    flex: 1, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.4)',
    overflow: 'hidden',
  },
  scroll: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 110 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cloverPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.5)', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 7 },
  cloverEmoji: { fontSize: 17 },
  cloverBalance: { fontSize: 17, fontFamily: 'Inter_800ExtraBold', color: '#3A2A1A' },
  skillsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#4A3423', borderRadius: 18,
    paddingHorizontal: 14, paddingVertical: 8,
    minHeight: 44, // touch target
  },
  skillsGlyph: { fontSize: 16 },
  skillsLabel: { fontSize: 16, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
  name: { fontSize: 22, fontFamily: 'Inter_800ExtraBold', color: '#3A2A1A', textAlign: 'center', marginTop: 6 },
  portraitWrap: { alignItems: 'center', marginTop: 4 },
  portrait: { width: 120, height: 120 },
  portraitPlaceholder: { width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(255,255,255,0.4)', alignItems: 'center', justifyContent: 'center' },
  hangout: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#3A2A1A', textAlign: 'center', marginTop: 18, marginBottom: 12 },
  kitList: { gap: 12, paddingBottom: 8 },
  kitCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#FFFFFF', borderRadius: 18, padding: 15, marginBottom: 13, shadowColor: '#5A3A1B', shadowOpacity: 0.25, shadowRadius: 0, shadowOffset: { width: 2, height: 3 } },
  kitCardPressed: { transform: [{ translateX: 1 }, { translateY: 2 }], shadowOffset: { width: 1, height: 1 } },
  kitIcon: { width: 44, height: 44 },
  kitLabel: { fontSize: 18, fontFamily: 'Inter_800ExtraBold', color: '#2A2A2A' },
  kitDesc: { fontSize: 13, fontFamily: 'Inter_500Medium', color: '#8A7A6A', marginTop: 2 },
  closeBtn: { position: 'absolute', alignSelf: 'center', width: 52, height: 52, borderRadius: 26, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
});
