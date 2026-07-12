import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';

import { useTheme } from '@/theme/use-theme';
import { haptics } from '@/lib/haptics';
import { companionLevel, getCachedCompanion, type CompanionState } from '@/lib/companion-api';
import { isQuietWinsDoneToday } from '@/lib/quiet-wins-api';
import { isNewLensDoneToday } from '@/lib/lens-api';
import { getCachedStatus } from '@/lib/true-north-api';

export type CompanionSheetRef = {
  present: () => void;
  dismiss: () => void;
  /** Re-read companion + Kit done-states. Call when Home regains focus so a Kit
   *  finished on a pushed screen drops out of the list the moment we return,
   *  whether the sheet is open or not. */
  refresh: () => void;
};

type MdIcon = keyof typeof MaterialIcons.glyphMap;

interface KitRow {
  key: string;
  label: string;
  desc: string;
  icon: MdIcon;
  route?: string; // undefined = placeholder (not built yet)
  done?: boolean;
  /** Daily Kits vanish from the list once done and return next day; permanent
   *  Kits (True North weekly, Visit Master 48h) always show. */
  daily?: boolean;
  /** For permanent Kits: text shown in place of desc once done this period. */
  availText?: string;
}

/**
 * Companion interaction sheet (C7). Tapping the pet on Home pulls this up: the
 * companion's name and level, an EXP bar, and the list of every Kit. Built Kits
 * (New Lens, True North, Quiet Wins) route to their screens and show a done
 * state; not-yet-built ones (Tame Enemy, Visit Master) are shown disabled.
 *
 * Willpower and gems are intentionally absent -- willpower was removed in Phase
 * A, and the sheet shows growth (xp -> level), not currency. Layout follows the
 * design reference; pet art is a placeholder until the videos land.
 */
interface DoneState {
  newLens: boolean;
  quietWins: boolean;
  trueNorth: boolean;
}

/** Read all Kit done-states at once, so the sheet's list reflects them. */
function readDoneState(): DoneState {
  return {
    newLens: isNewLensDoneToday(),
    quietWins: isQuietWinsDoneToday(),
    trueNorth: getCachedStatus().doneThisWeek,
  };
}

export const CompanionSheet = forwardRef<CompanionSheetRef>((_, ref) => {
  const router = useRouter();
  const { theme } = useTheme();
  const c = theme.colors;
  const sheetRef = useRef<BottomSheetModal>(null);
  const [companion, setCompanion] = useState<CompanionState | null>(() => getCachedCompanion());
  const [doneState, setDoneState] = useState(() => readDoneState());

  // Re-read everything that can change while a Kit screen is pushed on top.
  // Driven by Home's focus effect (return from a Kit) and on present.
  const refresh = useCallback(() => {
    setCompanion(getCachedCompanion());
    setDoneState(readDoneState());
  }, []);

  useImperativeHandle(ref, () => ({
    present: () => {
      refresh();
      sheetRef.current?.present();
    },
    dismiss: () => sheetRef.current?.dismiss(),
    refresh,
  }));

  const snapPoints = useMemo(() => ['65%', '90%'], []);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.6} />
    ),
    [],
  );

  const level = companion ? companionLevel(companion) : null;

  // Permanent Kits show when they next become available instead of vanishing.
  // True North resets on the next ISO-week boundary (Monday).
  const trueNorthAvail = useMemo(() => {
    const dow = (new Date().getDay() + 6) % 7; // Mon=0..Sun=6
    const days = 7 - dow;
    return days === 1 ? 'New ranking tomorrow' : `New ranking in ${days} days`;
  }, []);

  const kits: KitRow[] = useMemo(() => {
    return [
      {
        key: 'new_lens',
        label: 'New Lens',
        desc: 'See something a different way',
        icon: 'lightbulb-outline',
        route: '/(main)/new-lens',
        done: doneState.newLens,
        daily: true,
      },
      {
        key: 'true_north',
        label: 'True North',
        desc: 'Rank what matters most right now',
        icon: 'explore',
        route: '/(main)/true-north',
        done: doneState.trueNorth,
        availText: trueNorthAvail,
        // permanent: a done week opens the reveal, so it never vanishes.
      },
      {
        key: 'quiet_wins',
        label: 'Quiet Wins',
        desc: 'Notice the small things you did',
        icon: 'check-circle-outline',
        route: '/(main)/quiet-wins',
        done: doneState.quietWins,
        daily: true,
      },
      {
        key: 'tame_enemy',
        label: 'Tame Enemy',
        desc: 'Coming soon',
        icon: 'pets',
        daily: true,
      },
      {
        key: 'visit_master',
        label: 'Visit Master',
        desc: 'Coming soon',
        icon: 'auto-awesome',
      },
    ];
  }, [doneState, trueNorthAvail]);

  function openKit(row: KitRow) {
    if (!row.route) return;
    void haptics.medium();
    // Do NOT dismiss the sheet: the Kit screen pushes on top of Home (and this
    // sheet), and closing it with router.back() returns here, sheet intact.
    // Layers stack; each back peels one layer.
    router.push(row.route as never);
  }

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={{ backgroundColor: c.textMuted }}
      backgroundStyle={{ backgroundColor: c.bgSecondary, borderRadius: 28 }}
    >
      <BottomSheetView style={[styles.content, { backgroundColor: c.bgSecondary }]}>
        {/* Pet header: art placeholder + name + level */}
        <View style={styles.header}>
          <View style={[styles.petArt, { backgroundColor: c.bgCard, borderColor: c.border }]}>
            <MaterialIcons name="pets" size={44} color={c.brand.primary} />
          </View>
          <Text style={[styles.name, { color: c.textPrimary }]}>
            {companion?.name || 'Your companion'}
          </Text>
          {level && (
            <Text style={[styles.levelLabel, { color: c.textSecondary }]}>
              Level {level.level}
              {level.xpForLevel > 0 ? `  ·  ${level.xpIntoLevel}/${level.xpForLevel} XP` : '  ·  MAX'}
            </Text>
          )}
          {level && (
            <View style={[styles.track, { backgroundColor: c.progressTrack }]}>
              <View
                style={[
                  styles.fill,
                  { backgroundColor: c.brand.primary, width: `${Math.round(level.progress * 100)}%` },
                ]}
              />
            </View>
          )}
        </View>

        {/* Kit list -- daily Kits drop out once done, back tomorrow */}
        <View style={styles.kitList}>
          {kits.filter((row) => !(row.daily && row.done)).map((row) => {
            const disabled = !row.route;
            return (
              <Pressable
                key={row.key}
                onPress={() => openKit(row)}
                disabled={disabled}
                style={({ pressed }) => [
                  styles.kitRow,
                  {
                    backgroundColor: c.bgCard,
                    borderColor: c.border,
                    opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
                  },
                ]}
              >
                <View style={[styles.kitIcon, { backgroundColor: c.bgCardAlt }]}>
                  <MaterialIcons name={row.icon} size={22} color={c.brand.primary} />
                </View>
                <View style={styles.kitText}>
                  <Text style={[styles.kitLabel, { color: c.textPrimary }]}>{row.label}</Text>
                  <Text style={[styles.kitDesc, { color: c.textMuted }]}>
                    {row.done && row.availText ? row.availText : row.desc}
                  </Text>
                </View>
                {row.done && row.availText ? (
                  <MaterialIcons name="schedule" size={18} color={c.textMuted} />
                ) : !disabled ? (
                  <MaterialIcons name="chevron-right" size={22} color={c.textMuted} />
                ) : null}
              </Pressable>
            );
          })}
        </View>

        <Pressable
          onPress={() => sheetRef.current?.dismiss()}
          style={[styles.closeBtn, { backgroundColor: c.bgCard, borderColor: c.border }]}
          hitSlop={8}
        >
          <MaterialIcons name="close" size={24} color={c.textSecondary} />
        </Pressable>
      </BottomSheetView>
    </BottomSheetModal>
  );
});

CompanionSheet.displayName = 'CompanionSheet';

const styles = StyleSheet.create({
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 32 },
  header: { alignItems: 'center', marginBottom: 24 },
  petArt: {
    width: 96, height: 96, borderRadius: 48, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  name: { fontSize: 20, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  levelLabel: { fontSize: 13, fontFamily: 'Inter_500Medium', marginBottom: 12 },
  track: { width: '80%', height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },

  kitList: { gap: 10 },
  kitRow: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 14, borderWidth: 1, padding: 14,
  },
  kitIcon: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', marginRight: 14,
  },
  kitText: { flex: 1 },
  kitLabel: { fontSize: 16, fontFamily: 'Inter_600SemiBold', marginBottom: 2 },
  kitDesc: { fontSize: 13, fontFamily: 'Inter_400Regular' },

  closeBtn: {
    alignSelf: 'center', marginTop: 20,
    width: 52, height: 52, borderRadius: 26, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
});
