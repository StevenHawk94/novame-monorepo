/**
 * OffsetCard — the design language's "8% offset" colored drop: a solid
 * backing layer in a theme color sits a few points below the card, giving the
 * sticker-like lifted look (Focus rows drop teal, Reflect rows drop tan…).
 * Implemented as a real view rather than a shadow so Android renders the
 * COLORED offset identically to iOS (elevation can't tint shadows).
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

type Props = {
  /** The offset layer's color — pick from the screen's palette. */
  color: string;
  /** Drop distance in points (≈8% of the row height in the mocks). */
  offset?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
  /** Card face styles (background, padding…). */
  cardStyle?: StyleProp<ViewStyle>;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  children: ReactNode;
};

export function OffsetCard({
  color,
  offset = 8,
  radius = 24,
  style,
  cardStyle,
  onPress,
  disabled,
  accessibilityLabel,
  children,
}: Props) {
  const face = (
    <View style={[styles.face, { borderRadius: radius }, cardStyle]}>{children}</View>
  );
  return (
    <View style={[{ marginBottom: offset }, style]}>
      <View
        pointerEvents="none"
        style={[styles.backing, { top: offset, bottom: -offset, borderRadius: radius, backgroundColor: color }]}
      />
      {onPress ? (
        <Pressable
          onPress={onPress}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityState={{ disabled: !!disabled }}
          style={({ pressed }) => [pressed && !disabled && { transform: [{ translateY: offset / 2 }] }]}
        >
          {face}
        </Pressable>
      ) : (
        face
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  backing: { position: 'absolute', left: 0, right: 0 },
  face: { backgroundColor: '#FFFFFF', overflow: 'hidden' },
});
