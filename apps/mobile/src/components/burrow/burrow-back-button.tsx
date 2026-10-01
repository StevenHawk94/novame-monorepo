import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';

/** The same 44-point touch target and centered chevron on every Burrow detail. */
export function BurrowBackButton({ onPress, style, light = false }: {
  onPress: () => void; style?: StyleProp<ViewStyle>; light?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel="Go back" hitSlop={4}
    onPress={onPress} style={({ pressed }) => [styles.button, light && styles.light, style, pressed && styles.pressed]}>
    <Feather name="chevron-left" size={28} color={light ? '#FFF9EF' : '#4C2B1E'} />
  </Pressable>;
}

const styles = StyleSheet.create({
  button: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFF6E8', alignItems: 'center', justifyContent: 'center' },
  light: { backgroundColor: '#FFFFFF30' },
  pressed: { opacity: .68 },
});
