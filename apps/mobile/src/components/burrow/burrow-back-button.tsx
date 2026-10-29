import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import Svg, { Path } from 'react-native-svg';
import { uiWorkPriority } from '@/lib/ui-work-priority';
import { beginInteractionTiming, markInteractionTiming } from '@/lib/interaction-timing';

/** Fixed vector geometry/size; never a font-dependent ‹ or a different arrow. */
export function BackIcon({ color = '#4C2B1E' }: { color?: string }) {
  return <Svg accessible={false} pointerEvents="none" width={28} height={28} viewBox="0 0 24 24">
    <Path d="M15.5 5L8.5 12L15.5 19" fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"/>
  </Svg>;
}

/** The same 44-point touch target and centered chevron on every Burrow detail. */
export function BurrowBackButton({ onPress, style, light = false, disabled = false, accessibilityLabel = 'Go back' }: {
  onPress: () => void; style?: StyleProp<ViewStyle>; light?: boolean; disabled?: boolean; accessibilityLabel?: string;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} disabled={disabled} accessibilityState={{disabled}} hitSlop={4}
    onPress={()=>{uiWorkPriority.action();beginInteractionTiming('back');markInteractionTiming('dispatch');onPress();}} style={({ pressed }) => [styles.button, light && styles.light, style, pressed && styles.pressed]}>
    <BackIcon color={light ? '#FFF9EF' : '#4C2B1E'} />
  </Pressable>;
}

const styles = StyleSheet.create({
  button: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFF6E8', alignItems: 'center', justifyContent: 'center' },
  light: { backgroundColor: '#FFFFFF30' },
  pressed: { opacity: .68 },
});
