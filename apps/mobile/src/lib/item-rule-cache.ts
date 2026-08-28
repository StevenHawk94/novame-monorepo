import { ITEM_CATALOG_VERSION, ITEM_DICTIONARY, applyItemRules, type ItemRuleSnapshot } from '@novame/engine';
import { storage } from './storage';
import { apiClient } from './api';
const key = `reviewed-item-rules:${ITEM_CATALOG_VERSION}`;
const empty: ItemRuleSnapshot = { catalog: ITEM_CATALOG_VERSION, revision: 0, rules: [] };
function read(): ItemRuleSnapshot {
  try { const v = JSON.parse(storage.getString(key) || 'null'); return v?.catalog === ITEM_CATALOG_VERSION && Number.isSafeInteger(v.revision) && Array.isArray(v.rules) ? v : empty; } catch { return empty; }
}
let snapshot = read();
let dictionary = applyItemRules(ITEM_DICTIONARY, snapshot.rules);
let checkedAt = 0;
let pending: Promise<boolean> | null = null;
export function itemRuleContext() { return { dictionary, version: { catalog: snapshot.catalog, revision: snapshot.revision } }; }
/** One small request per 30 minutes while used; never per keystroke or item. */
export function refreshItemRules(): Promise<boolean> {
  if (pending) return pending;
  if (Date.now() - checkedAt < 30 * 60_000) return Promise.resolve(true);
  checkedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  pending = apiClient.get<ItemRuleSnapshot>(`/api/item-rules?catalog=${ITEM_CATALOG_VERSION}`, { signal: controller.signal }).then(next => {
    if (next.catalog !== ITEM_CATALOG_VERSION || !Number.isSafeInteger(next.revision) || !Array.isArray(next.rules)) return false;
    snapshot = next; dictionary = applyItemRules(ITEM_DICTIONARY, next.rules);
    storage.set(key, JSON.stringify(next)); return true;
  }).catch(() => false).finally(() => { clearTimeout(timer); pending = null; });
  return pending;
}
