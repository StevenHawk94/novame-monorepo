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
};

type MdIcon = keyof typeof MaterialIcons.glyphMap;

interface KitRow {
  key: string;
  label: string;
  desc: string;
  icon: MdIcon;
  route?: string; // undefined = placeholder (not built yet)
  done?: boolean;
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
export const CompanionSheet = forwardRef<CompanionSheetRef>((_, ref) => {
  const router = useRouter();
  const { theme } = useTheme();
  const c = theme.colors;
  const sheetRef = useRef<BottomSheetModal>(null);
  const [companion, setCompanion] = useState<CompanionState | null>(() => getCachedCompanion());

  // Refresh companion + Kit done-states each time the sheet opens.
  const refresh = useCallback(() => {
    setCompanion(getCachedCompanion());
  }, []);

  useImperativeHandle(ref, () => ({
    present: () => {
      refresh();
      sheetRef.current?.present();
    },
    dismiss: () => sheetRef.current?.dismiss(),
  }));

  const snapPoints = useMemo(() => ['65%', '90%'], []);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.6} />
    ),
    [],
  );

  const level = companion ? companionLevel(companion) : null;

  const kits: KitRow[] = useMemo(() => {
    const tnDone = getCachedStatus().doneThisWeek;
    return [
      {
        key: 'new_lens',
        label: 'New Lens',
        desc: 'See something a different way',
        icon: 'lightbulb-outline',
        route: '/(main)/new-lens',
        done: isNewLensDoneToday(),
      },
      {
        key: 'true_north',
        label: 'True North',
        desc: 'Rank what matters most right now',
        icon: 'explore',
        route: '/(main)/true-north',
        done: tnDone,
      },
      {
        key: 'quiet_wins',
        label: 'Quiet Wins',
        desc: 'Notice the small things you did',
        icon: 'check-circle-outline',
        route: '/(main)/quiet-wins',
        done: isQuietWinsDoneToday(),
      },
      {
        key: 'tame_enemy',
        label: 'Tame Enemy',
        desc: 'Coming soon',
        icon: 'pets',
      },
      {
        key: 'visit_master',
        label: 'Visit Master',
        desc: 'Coming soon',
        icon: 'auto-awesome',
      },
    ];
  }, [companion]);

  function openKit(row: KitRow) {
    if (!row.route) return;
    void haptics.medium();
    sheetRef.current?.dismiss();
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

        {/* Kit list */}
        <View style={styles.kitList}>
          {kits.map((row) => {
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
                    {row.done ? 'Done — back tomorrow' : row.desc}
                  </Text>
                </View>
                {row.done ? (
                  <MaterialIcons name="check" size={20} color={c.brand.primary} />
                ) : !disabled ? (
                  <MaterialIcons name="chevron-right" size={22} color={c.textMuted} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
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
});
