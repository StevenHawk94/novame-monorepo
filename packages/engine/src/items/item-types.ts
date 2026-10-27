/** Display/manual-selection DTOs. They never infer items from journal text. */
export type ItemRarity = 'common' | 'uncommon' | 'rare';
export interface ItemDef {
  displayName: string;
  rarity: ItemRarity;
  category: string;
  bagsCategory?: string;
  sheetId?: string;
  row?: number;
  col?: number;
  emoji?: string;
  visualConcept?: string;
}
/** Historical name retained for display consumers; no matching rules. */
export interface ItemDictionary { items: Record<string, ItemDef> }
/** Saved/manual item shape; existing database matches and item IDs are intact. */
export interface ItemMatch {
  itemId: string;
  displayName: string;
  rarity: ItemRarity;
  label: string;
  sourceExcerpt?: string;
}
