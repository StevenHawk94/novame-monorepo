/**
 * The eight growth dimensions. Single source of truth for their ids, names and
 * colours, consumed by the Status gems, the Skills decks, the Tame Enemy
 * monsters, and the Reflect prompt-to-dimension mapping.
 *
 * The ids are load-bearing: they become the dimension enum in Postgres, route
 * params, and style keys. Renaming one is a migration, not an edit.
 *
 * Colours are placeholders until the brand palette lands. When it does, this
 * is the one file that changes -- nothing downstream hardcodes a dimension
 * colour.
 */

export type DimensionId =
  | 'expression'
  | 'awareness'
  | 'momentum'
  | 'direction'
  | 'steadiness'
  | 'confidence'
  | 'gratitude'
  | 'connection';

export interface Dimension {
  id: DimensionId;
  nameEn: string;
  nameZh: string;
  /** @placeholder brand palette pending. */
  color: string;
}

export const DIMENSIONS: Record<DimensionId, Dimension> = {
  expression: { id: 'expression', nameEn: 'Expression', nameZh: '表达力', color: '#C084FC' },
  awareness:  { id: 'awareness',  nameEn: 'Awareness',  nameZh: '自省力', color: '#818CF8' },
  momentum:   { id: 'momentum',   nameEn: 'Momentum',   nameZh: '行动力', color: '#F472B6' },
  direction:  { id: 'direction',  nameEn: 'Direction',  nameZh: '方向感', color: '#60A5FA' },
  steadiness: { id: 'steadiness', nameEn: 'Steadiness', nameZh: '稳定力', color: '#34D399' },
  confidence: { id: 'confidence', nameEn: 'Confidence', nameZh: '自信力', color: '#FBBF24' },
  gratitude:  { id: 'gratitude',  nameEn: 'Gratitude',  nameZh: '知足力', color: '#FB923C' },
  connection: { id: 'connection', nameEn: 'Connection', nameZh: '关系力', color: '#F87171' },
};

/** Stable iteration order: the declaration order above. */
export const DIMENSION_IDS = Object.keys(DIMENSIONS) as DimensionId[];
