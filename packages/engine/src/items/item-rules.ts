import metadata from './rule-metadata.json';
import type { ItemDictionary } from './item-matcher';

export const ITEM_CATALOG_VERSION = metadata.version;
export const NEVER_AUTO_ITEMS: Record<string, string[]> = metadata.neverAuto;
export interface ItemRule { keyword: string; item_id: string; action: 'enable' | 'disable' | 'reset'; revision: number }
export interface ItemRuleSnapshot { catalog: string; revision: number; rules: ItemRule[] }
export const normalizeItemKeyword = (s: string) => (s.toLowerCase().replace(/[’‘`´]/g, "'").match(/[a-z0-9']+/g) || []).join(' ');
export function applyItemRules(base: ItemDictionary, rules: ItemRule[]): ItemDictionary {
  const dict = { items: { ...base.items }, synonyms: { ...base.synonyms }, exclusions: { ...base.exclusions } };
  for (const rule of [...rules].sort((a, b) => a.revision - b.revision)) {
    const keyword = normalizeItemKeyword(rule.keyword);
    if (!keyword || keyword !== rule.keyword || !base.items[rule.item_id]) continue;
    if (rule.action === 'reset') {
      delete dict.synonyms[keyword]; delete dict.exclusions[keyword];
      if (base.synonyms[keyword]) dict.synonyms[keyword] = base.synonyms[keyword];
      if (base.exclusions?.[keyword]) dict.exclusions[keyword] = base.exclusions[keyword];
    } else if (rule.action === 'disable') {
      if (dict.synonyms[keyword] === rule.item_id) delete dict.synonyms[keyword];
    } else if (rule.action === 'enable' && keyword.includes(' ')
      && !NEVER_AUTO_ITEMS[keyword]?.includes(rule.item_id)
      && (!dict.synonyms[keyword] || dict.synonyms[keyword] === rule.item_id)) {
      dict.synonyms[keyword] = rule.item_id;
      // Existing exclusions stay in force, even for an admin-approved phrase.
    }
  }
  return dict;
}
