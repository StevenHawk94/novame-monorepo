import raw from './display-catalog.json';
import manualDisplay from './tap-your-day-display.json';
import { TAP_PERSON_ITEMS } from './tap-person-items';
import type { ItemDef } from './item-types';

// Identifies the immutable historical artwork catalog, not a matching revision.
export const ITEM_CATALOG_VERSION = 'v33-8a1a98aedd3763b1';

/** Names/art fallback only; no matching vocabulary or initialization work. */
export const ITEM_DISPLAY_CATALOG: Record<string, ItemDef> = { ...raw, ...manualDisplay, ...TAP_PERSON_ITEMS } as Record<string, ItemDef>;
