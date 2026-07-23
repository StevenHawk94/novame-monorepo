/**
 * ItemSprite — renders one memory item from its sprite sheet.
 *
 * The dictionary gives every item a (sheetId, row, col) into an 8x8 sheet of
 * 256px cells (standardized by tools/normalize-item-sheet.py: transparent
 * background, art centered with a 12% safe area). Rendering is the classic
 * sprite window: a size×size box with overflow hidden, holding the whole
 * sheet scaled to 8×size and translated so the wanted cell lines up.
 *
 * One sheet image is decoded once and shared by every sprite on screen
 * (expo-image cache). New sheets: drop the standardized webp in
 * assets/items/, add one line to ITEM_SHEETS.
 *
 * Unknown item or missing sheet → the item's emoji if the dictionary has
 * one, else a blank tile — screens never break while art catches up.
 */
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';

import { ITEM_DICTIONARY } from '@novame/engine';

const SHEET_COLS = 8;

const ITEM_SHEETS: Record<string, number> = {
  'food-01': require('../../../assets/items/food-01.webp'),
};

type Props = {
  itemId: string;
  size: number;
  radius?: number;
  /** Tile background behind the transparent art. Default: the app's lavender. */
  tileColor?: string;
  style?: StyleProp<ViewStyle>;
};

export function ItemSprite({ itemId, size, radius = Math.round(size * 0.22), tileColor = '#F4F1F8', style }: Props) {
  const item = ITEM_DICTIONARY.items[itemId];
  const sheet = item ? ITEM_SHEETS[item.sheetId] : undefined;

  if (!item || sheet == null) {
    return (
      <View
        style={[
          styles.box,
          { width: size, height: size, borderRadius: radius, backgroundColor: tileColor },
          style,
        ]}
      >
        {item?.emoji ? (
          <Text style={{ fontSize: size * 0.55, lineHeight: size * 0.7 }}>{item.emoji}</Text>
        ) : null}
      </View>
    );
  }

  return (
    <View
      style={[
        styles.box,
        { width: size, height: size, borderRadius: radius, backgroundColor: tileColor },
        style,
      ]}
    >
      <Image
        source={sheet}
        style={{
          position: 'absolute',
          left: -item.col * size,
          top: -item.row * size,
          width: size * SHEET_COLS,
          height: size * SHEET_COLS,
        }}
        contentFit="fill"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});
