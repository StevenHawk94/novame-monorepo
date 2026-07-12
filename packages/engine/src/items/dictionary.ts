/**
 * The item dictionary as a typed constant (C8). engine imports the JSON once
 * (resolveJsonModule) and re-exports it typed, so both /api/reflect and the
 * client get the same data through @novame/engine -- matching can never drift
 * between them. Small sample now; the full 480-item / 2,400-synonym file
 * replaces this JSON when the sprite sheets land, with no code change.
 */
import type { ItemDictionary } from './item-matcher';

import raw from './dictionary.json';

export const ITEM_DICTIONARY: ItemDictionary = raw as ItemDictionary;
