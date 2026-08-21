/**
 * The item dictionary as a typed constant (C8). engine imports the JSON once
 * (resolveJsonModule) and re-exports it typed, so both /api/reflect and the
 * client get the same data through @novame/engine -- matching can never drift
 * between them. The generated JSON contains the complete bundled catalog and
 * deterministic safety-filtered synonym map.
 */
import type { ItemDictionary } from './item-matcher';

import raw from './dictionary.json';

export const ITEM_DICTIONARY: ItemDictionary = raw as ItemDictionary;
