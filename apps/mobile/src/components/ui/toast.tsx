/**
 * Toast — Stage 3.9.A.1.4
 *
 * Lightweight banner shown at the bottom of the screen for success
 * or error confirmations. Self-rendered (no third-party lib) using
 * the standard React Native Animated API. Slides up from below the
 * safe-area, holds for `duration` ms, then fades + slides back.
 *
 * Caller drives visibility via the `visible` prop. When `visible`
 * transitions true -> false the component animates out automatically.
 *
 * Variants:
 *   - 'success' : green-tinted background
 *   - 'error'   : red-tinted background
 *   - 'info'    : neutral tinted background (default)
 */
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type ToastVariant = 'success' | 'error' | 'info';

export type ToastProps = {
  visible: boolean;
  message: string;
  variant?: ToastVariant;
};

type ToastVariantStyle = {
  bg: string;
  border: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  iconColor: string;
};

const VARIANTS: Record<ToastVariant, ToastVariantStyle> = {
  success: {
    bg: 'rgba(34,197,94,0.92)',
    border: 'rgba(255,255,255,0.18)',
    icon: 'check-circle',
    iconColor: '#FFFFFF',
  },
  error: {
    bg: 'rgba(239,68,68,0.92)',
    border: 'rgba(255,255,255,0.18)',
    icon: 'error-outline',
    iconColor: '#FFFFFF',
  },
  info: {
    bg: 'rgba(59,130,246,0.92)',
    border: 'rgba(255,255,255,0.18)',
    icon: 'info-outline',
    iconColor: '#FFFFFF',
  },
};

export function Toast({ visible, message, variant = 'info' }: ToastProps) {
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(slide, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slide, { toValue: 0, duration: 180, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, slide, opacity]);

  const v = VARIANTS[variant];
  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [50, 0] });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrap,
        {
          paddingBottom: insets.bottom + 16,
          opacity,
          transform: [{ translateY }],
        },
      ]}
    >
      <View style={[styles.banner, { backgroundColor: v.bg, borderColor: v.border }]}>
        <MaterialIcons name={v.icon} size={20} color={v.iconColor} />
        <Text style={styles.text} numberOfLines={2}>
          {message}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  text: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
});
