import type { ItemDictionary } from './item-matcher';
import type { TapYourDayKind } from './tap-your-day';

/** A separate version keeps already-installed v1/v2 clients compatible. */
export const CUSTOM_TAP_SELECTION_VERSION = 'tap-your-day-v3';
export const MAX_CUSTOM_TAP_ITEMS = 60;
export interface CustomTapItem {
  itemId: string;
  label: string;
  kind: TapYourDayKind;
  group: string;
  custom: true;
}
export function cleanCustomTapItem(value: unknown, dictionary: ItemDictionary): CustomTapItem | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.custom !== true || typeof v.itemId !== 'string' || !Object.prototype.hasOwnProperty.call(dictionary.items, v.itemId)) return null;
  if (!['activity', 'food', 'person', 'feeling'].includes(String(v.kind))) return null;
  const label = typeof v.label === 'string' ? v.label.replace(/\s+/g, ' ').trim() : '';
  const group = typeof v.group === 'string' ? v.group.replace(/\s+/g, ' ').trim() : '';
  if (!label || label.length > 80 || !group || group.length > 100 || /[\x00-\x1f]/.test(label + group)) return null;
  return { itemId: v.itemId, label, group, kind: v.kind as TapYourDayKind, custom: true };
}
