import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

type FixedColumnGridProps<T> = {
  data: readonly T[];
  columns: number;
  renderItem: (item: T, index: number) => ReactNode;
  keyExtractor: (item: T, index: number) => string;
  columnGap?: number;
  rowGap?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * A wrapping grid whose rows always contain the requested number of equal-width
 * cells. Explicit rows avoid percentage-width + gap rounding bugs in Yoga that
 * can push the last card onto the next line on some screen sizes.
 */
export function FixedColumnGrid<T>({
  data,
  columns,
  renderItem,
  keyExtractor,
  columnGap = 0,
  rowGap = 0,
  style,
}: FixedColumnGridProps<T>) {
  const safeColumns = Math.max(1, Math.floor(columns));
  const rows: Array<Array<{ item: T; index: number }>> = [];

  for (let start = 0; start < data.length; start += safeColumns) {
    rows.push(
      data.slice(start, start + safeColumns).map((item, offset) => ({
        item,
        index: start + offset,
      })),
    );
  }

  return (
    <View style={[styles.grid, { rowGap }, style]}>
      {rows.map((row) => (
        <View
          key={`row:${keyExtractor(row[0]!.item, row[0]!.index)}`}
          style={[styles.row, { columnGap }]}
        >
          {row.map(({ item, index }) => (
            <View key={keyExtractor(item, index)} style={styles.cell}>
              {renderItem(item, index)}
            </View>
          ))}
          {Array.from({ length: safeColumns - row.length }, (_, fillerIndex) => (
            <View
              key={`filler:${fillerIndex}`}
              style={styles.cell}
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { width: '100%' },
  row: { width: '100%', flexDirection: 'row', alignItems: 'flex-start' },
  cell: { flex: 1, minWidth: 0 },
});
