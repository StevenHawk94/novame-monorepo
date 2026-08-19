import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import type { ImageSourcePropType } from 'react-native';

import { haptics } from '@/lib/haptics';
import { isQuietWinsDoneToday } from '@/lib/quiet-wins-api';
import { isNewLensDoneToday } from '@/lib/lens-api';
import { isTameEnemyDoneToday } from '@/lib/tame-enemy-api';
import { getCachedStatus } from '@/lib/true-north-api';
import { ICONS } from '@/lib/icons';
import { GridBackground } from '@/components/ui/grid-background';
import { getCachedCosmetics, fetchCosmetics, subscribeCosmetics } from '@/lib/cosmetics-api';
import { fetchMasterStatus, getCachedMasterStatus, type MasterStatus } from '@/lib/master-api';

interface KitRow {
  key: string;
  label: string;
  desc: string;
  icon: ImageSourcePropType;
  route?: string;
  done?: boolean;
  daily?: boolean;
  availText?: string;
  badge?: string;
  disabled?: boolean;
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
 * Companion interaction sheet (Home) — 2026-08-05 design: the connection grid
 * ground with an inset peach card (brown outline). Clover balance top-left,
 * the bunny head centered, "What do you need from me?", then the Kit cards.
 * Daily Kits drop out once done and return next day; permanent Kits (True
 * North weekly, Visit Master) always show.
 */
export function CompanionSheet() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const [doneState, setDoneState] = useState<DoneState>(() => readDoneState());
  const [balance, setBalance] = useState(() => getCachedCosmetics().balance);
  const [masterStatus, setMasterStatus] = useState<MasterStatus>(() => getCachedMasterStatus());

  useEffect(() => subscribeCosmetics((state) => setBalance(state.balance)), []);

  // The sheet is now a real route beneath Kit routes. Returning from a Kit
  // focuses this still-mounted screen, so its scroll/state never flashes away
  // while completion and currency can refresh quietly in place.
  useFocusEffect(
    useCallback(() => {
      setDoneState(readDoneState());
      setBalance(getCachedCosmetics().balance);
      void fetchCosmetics().then((state) => setBalance(state.balance));
      setMasterStatus(getCachedMasterStatus());
      void fetchMasterStatus().then(setMasterStatus);
    }, []),
  );

  const trueNorthAvail = useMemo(() => {
    const dow = (new Date().getDay() + 6) % 7;
    const days = 7 - dow;
    return days === 1 ? 'New ranking tomorrow' : `New ranking in ${days} days`;
  }, []);

  const kits: KitRow[] = useMemo(() => {
    const masterCoolingDown = masterStatus.isPaid && !masterStatus.available;
    const remainingHours = masterStatus.nextAvailableAt
      ? Math.max(1, Math.ceil((new Date(masterStatus.nextAvailableAt).getTime() - Date.now()) / 3_600_000))
      : 72;
    return [
      { key: 'quiet_wins', label: 'Small Wins', desc: 'See what you did right today.', icon: ICONS.SmallWins, route: '/(main)/quiet-wins', done: doneState.quietWins, daily: true },
      { key: 'new_lens', label: 'New Lens', desc: 'Feeling stuck? A different angle might help.', icon: ICONS.NewLens, route: '/(main)/new-lens', done: doneState.newLens, daily: true },
      { key: 'true_north', label: 'True North', desc: 'See what truly deserves your energy right now.', icon: ICONS.TrueNorth, route: '/(main)/true-north', done: doneState.trueNorth, availText: trueNorthAvail },
      { key: 'tame_enemy', label: 'Tame Enemy', desc: "That voice working against you? Let's tame it.", icon: ICONS.TameEnemy, route: '/(main)/tame-enemy', done: doneState.tameEnemy, daily: true },
      {
        key: 'visit_master', label: 'Visit Master',
        desc: masterCoolingDown
          ? 'The Master has set out in search of wisdom.'
          : 'Need a sharper read on it? Ask the bunny master.',
        icon: ICONS.VisitMaster, route: '/(main)/visit-master',
        badge: masterCoolingDown ? `Back in ${remainingHours}h` : undefined,
        disabled: masterCoolingDown,
      },
    ];
  }, [doneState, masterStatus, trueNorthAvail]);

  // Daily Kits vanish once done; permanent Kits always show.
  const visibleKits = kits.filter((k) => !(k.daily && k.done));

  function openKit(row: KitRow) {
    if (!row.route || row.disabled) return;
    void haptics.medium();
    router.push(row.route as never);
  }

  return (
      <View style={styles.modalRoot}>
        <Pressable style={styles.backdrop} onPress={() => router.back()} />
        <View style={[styles.sheet, { height: screenH * 0.9 }]}>
          <View style={styles.outer}>
            <GridBackground />
            {/* One continuous peach panel reaches the physical screen bottom.
                Safe-area padding only positions the close button/content. */}
            <View style={styles.inner}>
              <ScrollView
                style={styles.kitScroll}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[
                  styles.scroll,
                  { paddingBottom: Math.max(insets.bottom, 8) + 74 },
                ]}
              >
                <View style={styles.header}>
                  <View style={styles.cloverPill}>
                    <Image source={ICONS.Clover} style={styles.cloverIcon} resizeMode="contain" />
                    <Text style={styles.cloverBalance}>{balance}</Text>
                  </View>
                </View>
                <View style={styles.portraitWrap}>
                  <Image
                    source={ICONS.interact}
                    style={[styles.portrait, screenH < 700 && { width: 110, height: 110 }]}
                    resizeMode="contain"
                  />
                </View>
                <Text style={styles.hangout}>Got something on your mind?</Text>
                {visibleKits.map((kit) => (
                  <Pressable
                    key={kit.key}
                    onPress={() => openKit(kit)}
                    disabled={kit.disabled}
                    style={({ pressed }) => [
                      styles.kitCard,
                      kit.disabled && styles.kitCardDisabled,
                      pressed && !kit.disabled && styles.kitCardPressed,
                    ]}
                  >
                    <Image source={kit.icon} style={styles.kitIcon} resizeMode="contain" />
                    <View style={{ flex: 1 }}>
                      <View style={styles.kitTitleRow}>
                        <Text style={styles.kitLabel}>{kit.label}</Text>
                        {!!kit.badge && <Text style={styles.kitBadge}>{kit.badge}</Text>}
                      </View>
                      <Text style={styles.kitDesc}>{kit.availText && kit.done ? kit.availText : kit.desc}</Text>
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
              <Pressable
                onPress={() => router.back()}
                style={[styles.closeBtn, { bottom: Math.max(insets.bottom, 8) }]}
                hitSlop={8}
              >
                <MaterialIcons name="close" size={26} color="#FFFFFF" />
              </Pressable>
            </View>
          </View>
        </View>
      </View>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    width: '100%',
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    overflow: 'hidden',
  },
  outer: {
    flex: 1, width: '100%', borderTopLeftRadius: 28, borderTopRightRadius: 28,
    overflow: 'hidden', paddingTop: 14, paddingHorizontal: 14,
    backgroundColor: '#F9DCB8',
  },
  // Inset peach panel with the brown outline over the grid ground (mock).
  inner: {
    flex: 1, borderTopLeftRadius: 30, borderTopRightRadius: 30,
    backgroundColor: '#F9D9B2',
    borderWidth: 2.5, borderColor: '#A9714B',
    overflow: 'hidden',
  },
  kitScroll: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cloverPill: {
    flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#FFFFFF',
    borderRadius: 14, paddingHorizontal: 13, paddingVertical: 8,
  },
  cloverIcon: { width: 22, height: 22 },
  cloverBalance: { fontSize: 17, fontFamily: 'Inter_800ExtraBold', color: '#2E7A3A' },
  skillsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#4A3423', borderRadius: 18,
    paddingHorizontal: 14, paddingVertical: 8,
    minHeight: 44, // touch target
  },
  skillsGlyph: { fontSize: 16 },
  skillsLabel: { fontSize: 16, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
  portraitWrap: { alignItems: 'center', marginTop: 2 },
  portrait: { width: 150, height: 150 },
  portraitPlaceholder: { width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(255,255,255,0.4)', alignItems: 'center', justifyContent: 'center' },
  hangout: { fontSize: 16, fontFamily: 'Inter_800ExtraBold', color: '#4A2E1A', textAlign: 'center', marginTop: 12, marginBottom: 16 },
  kitList: { gap: 12, paddingBottom: 8 },
  kitCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#FFFFFF', borderRadius: 18, padding: 15, marginBottom: 13, shadowColor: '#5A3A1B', shadowOpacity: 0.25, shadowRadius: 0, shadowOffset: { width: 2, height: 3 }, elevation: 3 },
  kitCardDisabled: { backgroundColor: '#D9D9D9', shadowOpacity: 0.18 },
  kitCardPressed: { transform: [{ translateX: 1 }, { translateY: 2 }], shadowOffset: { width: 1, height: 1 } },
  kitIcon: { width: 44, height: 44 },
  kitTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  kitLabel: { fontSize: 18, fontFamily: 'Inter_800ExtraBold', color: '#2A2A2A', flexShrink: 1 },
  kitBadge: {
    flexShrink: 0, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 5,
    borderRadius: 8, backgroundColor: '#74432D', color: '#FFFFFF',
    fontSize: 12.5, fontFamily: 'Inter_700Bold',
  },
  kitDesc: {
    fontSize: 13, lineHeight: 18, fontFamily: 'Inter_500Medium', color: '#8A7A6A',
    marginTop: 2, flexShrink: 1,
  },
  closeBtn: {
    position: 'absolute', left: '50%', marginLeft: -27, zIndex: 3,
    width: 54, height: 54, borderRadius: 27,
    backgroundColor: '#5C3A24', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
});
