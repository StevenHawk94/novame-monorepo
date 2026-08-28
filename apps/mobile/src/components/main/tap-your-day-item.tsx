import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { TapYourDayChoice } from '@novame/engine';
import { ItemSprite } from '@/components/ui/item-sprite';

export const TAP_ITEM_GAP = 8;
export const TAP_GRID_PADDING = 10;

/** Leave room for readable labels, including when the system text size grows. */
export function tapItemGridMetrics(width: number, fontScale = 1) {
  const available = Math.max(1, width - TAP_GRID_PADDING * 2);
  const columns = Math.min(6, Math.max(1, Math.floor((available + TAP_ITEM_GAP) / (72 * Math.max(1, fontScale) + TAP_ITEM_GAP))));
  return { columns, cellWidth: Math.floor((available - (columns - 1) * TAP_ITEM_GAP) / columns) };
}

/** The choice label can be broader than the name of its representative icon. */
export function TapYourDayItem({ choice, width, iconSize = 58, selected = false, showLabel = true, onPress }: {
  choice: TapYourDayChoice;
  width: number;
  iconSize?: number;
  selected?: boolean;
  showLabel?: boolean;
  onPress?: () => void;
}) {
  const size = Math.max(1, Math.min(iconSize, width - 6));
  const content = <>
    <View style={[styles.icon, { width: size + 6, height: size + 6 }, selected && styles.selected]}>
      <ItemSprite itemId={choice.itemId} size={size} radius={11} tapYourDay={!(choice as TapYourDayChoice & { custom?: boolean }).custom} />
      {selected && <View style={styles.check}><MaterialIcons name="check" size={12} color="#FFFFFF" /></View>}
    </View>
    {showLabel && <Text style={styles.label}>{choice.label}</Text>}
  </>;
  return onPress ? (
    <Pressable style={[styles.item, { width }]} accessibilityRole="checkbox"
      accessibilityLabel={choice.label} accessibilityState={{ checked: selected }} onPress={onPress}>
      {content}
    </Pressable>
  ) : <View style={[styles.item, { width }]} accessible accessibilityRole="image" accessibilityLabel={choice.label}>{content}</View>;
}

const styles = StyleSheet.create({
  item: { alignItems: 'center', gap: 5, paddingBottom: 4 },
  icon: { borderRadius: 13, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  selected: { borderColor: '#F3B537', backgroundColor: '#F3B537' },
  check: { position: 'absolute', right: -1, top: -1, width: 17, height: 17, borderRadius: 9, backgroundColor: '#80503B', alignItems: 'center', justifyContent: 'center' },
  label: { width: '100%', minHeight: 32, fontSize: 12, lineHeight: 16, fontFamily: 'Inter_600SemiBold', color: '#493219', textAlign: 'center' },
});
