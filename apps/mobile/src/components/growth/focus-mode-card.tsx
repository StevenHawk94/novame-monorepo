/**
 * Focus Mode card — Stage 3.9.A.2.1
 *
 * Single horizontal card with a lightning icon + "Focus Mode" label
 * + sublabel + Start button on the right.
 *
 * Behavior:
 *   - When mode === 'play':  Button reads "Start", tap fires onStart.
 *     Disabled if wp <= 0 (server requires wp > 0 to enter study mode).
 *   - When mode === 'study': Button reads "In Progress" and is disabled
 *     (study cannot be cancelled — runs until WP hits 0 then auto-claims).
 */
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';

// Bundle asset for the Focus Mode icon. Resolved via Metro's asset
// pipeline (require returns a numeric module id usable as <Image>
// source).
const FOCUS_ICON_SOURCE = require('../../../assets/images/growth/focus-icon.webp');


import type { CharacterMode } from '@/lib/constants';

export type FocusModeCardProps = {
  mode: CharacterMode;
  wp: number;
  busy?: boolean;
  onStart: () => void;
};

export function FocusModeCard({ mode, wp, busy, onStart }: FocusModeCardProps) {
  const isStudy = mode === 'study';
  const wpZero = wp <= 0;
  const canStart = !isStudy && !wpZero && !busy;

  const buttonLabel = isStudy ? 'In Progress' : wpZero ? 'WP empty' : 'Start';
  const sublabel = isStudy
    ? 'Earning XP — locked until WP runs out'
    : wpZero
      ? 'Wait for WP to recover, then study to earn XP fast'
      : 'Turn on to gain XP faster';

  return (
    <View style={styles.cardWrap}>
      <LinearGradient
        colors={['#9333EA', '#7C3AED']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        <View style={styles.iconBubble}>
          {FOCUS_ICON_SOURCE ? (
            <Image
              source={FOCUS_ICON_SOURCE}
              style={styles.iconImg}
              resizeMode="contain"
            />
          ) : (
            <MaterialIcons name="bolt" size={28} color="#FFFFFF" />
          )}
        </View>
        <View style={styles.textBlock}>
          <Text style={styles.title}>Focus Mode</Text>
          <Text style={styles.sub}>{sublabel}</Text>
        </View>
        <Pressable
          onPress={onStart}
          disabled={!canStart}
          style={({ pressed }) => [
            styles.btnWrap,
            !canStart && styles.btnWrapDisabled,
            pressed && canStart && styles.btnWrapPressed,
          ]}
        >
          <LinearGradient
            colors={canStart ? ['#FB923C', '#F97316'] : ['#5B5478', '#4B4565']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.btn}
          >
            <Text style={styles.btnText}>{buttonLabel}</Text>
          </LinearGradient>
        </Pressable>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  cardWrap: {
    paddingHorizontal: 16,
    marginTop: 18,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 14,
    borderRadius: 22,
  },
  iconBubble: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#F5B042',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  iconImg: {
    width: '100%',
    height: '100%',
  },
  textBlock: {
    flex: 1,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
  },
  sub: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  btnWrap: {
    borderRadius: 999,
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 4,
  },
  btnWrapDisabled: {
    shadowOpacity: 0,
    elevation: 0,
  },
  btnWrapPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.96 }],
  },
  btn: {
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 999,
  },
  btnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
});
