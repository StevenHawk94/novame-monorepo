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
import { memo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';

import { ITEM_DICTIONARY } from '@novame/engine';

const SHEET_COLS = 8;

// Every sheet is 8 columns wide; row count varies by category (the 2026-07-23
// batch, 23 sheets x 32-64 items). `rows` drives the render window math -- a
// 4-row sheet is 2048x1024, not square.
const ITEM_SHEETS: Record<string, { src: number; rows: number }> = {
  'food-drinks-01': { src: require('../../../assets/items/food-drinks-01.webp'), rows: 8 },
  'sports-fitness-01': { src: require('../../../assets/items/sports-fitness-01.webp'), rows: 6 },
  'entertainment-games-01': { src: require('../../../assets/items/entertainment-games-01.webp'), rows: 7 },
  'relaxation-leisure-01': { src: require('../../../assets/items/relaxation-leisure-01.webp'), rows: 8 },
  'personal-belongings-01': { src: require('../../../assets/items/personal-belongings-01.webp'), rows: 6 },
  'music-01': { src: require('../../../assets/items/music-01.webp'), rows: 7 },
  'plants-gardening-01': { src: require('../../../assets/items/plants-gardening-01.webp'), rows: 5 },
  'professions-01': { src: require('../../../assets/items/professions-01.webp'), rows: 4 },
  'work-activities-01': { src: require('../../../assets/items/work-activities-01.webp'), rows: 4 },
  'places-buildings-01': { src: require('../../../assets/items/places-buildings-01.webp'), rows: 7 },
  'transportation-01': { src: require('../../../assets/items/transportation-01.webp'), rows: 6 },
  'animals-pets-01': { src: require('../../../assets/items/animals-pets-01.webp'), rows: 7 },
  'clothing-accessories-01': { src: require('../../../assets/items/clothing-accessories-01.webp'), rows: 5 },
  'beauty-care-01': { src: require('../../../assets/items/beauty-care-01.webp'), rows: 4 },
  'home-appliances-01': { src: require('../../../assets/items/home-appliances-01.webp'), rows: 4 },
  'kitchen-cooking-01': { src: require('../../../assets/items/kitchen-cooking-01.webp'), rows: 5 },
  'emotions-01': { src: require('../../../assets/items/emotions-01.webp'), rows: 6 },
  'health-medical-01': { src: require('../../../assets/items/health-medical-01.webp'), rows: 4 },
  'daily-routines-01': { src: require('../../../assets/items/daily-routines-01.webp'), rows: 5 },
  'home-furniture-01': { src: require('../../../assets/items/home-furniture-01.webp'), rows: 6 },
  'shopping-services-01': { src: require('../../../assets/items/shopping-services-01.webp'), rows: 4 },
  'celebrations-01': { src: require('../../../assets/items/celebrations-01.webp'), rows: 8 },
  'nature-seasons-01': { src: require('../../../assets/items/nature-seasons-01.webp'), rows: 8 },
};

type Props = {
  itemId: string;
  size: number;
  radius?: number;
  /** Tile background behind the transparent art. Default: the app's lavender. */
  tileColor?: string;
  style?: StyleProp<ViewStyle>;
};

// Memoized: sprite tiles appear by the dozen in grids and feeds; props are
// value-stable, so memo turns tab re-renders into no-ops for every tile.
export const ItemSprite = memo(function ItemSprite({ itemId, size, radius = Math.round(size * 0.22), tileColor = '#F4F1F8', style }: Props) {
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
        source={sheet.src}
        style={{
          position: 'absolute',
          left: -item.col * size,
          top: -item.row * size,
          width: size * SHEET_COLS,
          height: size * sheet.rows,
        }}
        contentFit="fill"
      />
    </View>
  );
});

const styles = StyleSheet.create({
  box: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});
