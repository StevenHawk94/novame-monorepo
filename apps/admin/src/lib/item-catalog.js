import {
  ITEM_CATALOG_VERSION,
  ITEM_DICTIONARY,
  NEVER_AUTO_ITEMS,
  applyItemRules,
  applyRemoteItemManifest,
  normalizeItemKeyword,
} from '@novame/engine';
import atlas from '@/generated/item-atlas.json';

const MODE_ORDER = { AUTO: 0, AUTO_UNLESS_EXCLUDED: 1, NEVER_AUTO: 2 };

function addRule(map, itemId, rule) {
  if (!map.has(itemId)) map.set(itemId, new Map());
  map.get(itemId).set(`${rule.keyword}\0${rule.triggerMode}`, rule);
}

function sortedRules(map, itemId) {
  return [...(map.get(itemId)?.values() || [])].sort((a, b) =>
    (MODE_ORDER[a.triggerMode] ?? 9) - (MODE_ORDER[b.triggerMode] ?? 9)
      || a.keyword.localeCompare(b.keyword));
}

function atlasThumbnail(itemId) {
  if (atlas.catalogVersion !== ITEM_CATALOG_VERSION) return null;
  const match = /^memory\.(\d{4})_/.exec(itemId);
  if (!match) return null;
  const index = Number(match[1]) - atlas.firstRow;
  if (!Number.isInteger(index) || index < 0 || index >= atlas.count) return null;
  const slot = index % atlas.itemsPerPage;
  const page = Math.floor(index / atlas.itemsPerPage);
  return {
    kind: 'atlas',
    url: `/item-atlas/${atlas.catalogVersion}-${String(page).padStart(2, '0')}.webp`,
    x: (slot % atlas.columns) * atlas.cellSize,
    y: Math.floor(slot / atlas.columns) * atlas.cellSize,
    cellSize: atlas.cellSize,
    sheetSize: atlas.columns * atlas.cellSize,
  };
}

/**
 * Build the effective catalog the app sees: bundle + current immutable R2
 * overlay + the latest reversible admin rule events.
 */
export function buildAdminItemCatalog({ remoteManifest, snapshot, publicUrl = '' }) {
  const base = applyRemoteItemManifest(ITEM_DICTIONARY, remoteManifest);
  const effective = applyItemRules(base, snapshot.rules || []);
  const remoteById = new Map((remoteManifest?.items || []).map((item) => [item.itemId, item]));
  const replacedIds = new Set((remoteManifest?.items || [])
    .filter((item) => item.replacesBundled).map((item) => item.itemId));
  const latestByKeyword = new Map((snapshot.rules || [])
    .map((rule) => [normalizeItemKeyword(rule.keyword), rule]));
  const rulesByItem = new Map();

  for (const [keyword, itemId] of Object.entries(effective.synonyms)) {
    const normalized = normalizeItemKeyword(keyword);
    const dynamic = latestByKeyword.get(normalized);
    const remote = remoteById.get(itemId);
    const remoteRule = remote?.keywordSafety?.find((rule) =>
      normalizeItemKeyword(rule.keyword) === normalized && rule.triggerMode !== 'NEVER_AUTO');
    const exclusions = effective.exclusions?.[normalized] || [];
    addRule(rulesByItem, itemId, {
      keyword: normalized,
      triggerMode: exclusions.length ? 'AUTO_UNLESS_EXCLUDED' : 'AUTO',
      keywordType: normalized.includes(' ') ? 'Phrase' : 'Word',
      exclusions,
      source: dynamic?.action === 'enable' && dynamic.item_id === itemId
        ? 'ADMIN' : remoteRule ? 'R2' : 'BUNDLED',
      active: true,
    });
  }

  for (const [keyword, itemIds] of Object.entries(NEVER_AUTO_ITEMS)) {
    for (const itemId of itemIds) {
      if (replacedIds.has(itemId) || !effective.items[itemId]) continue;
      addRule(rulesByItem, itemId, {
        keyword,
        triggerMode: 'NEVER_AUTO',
        keywordType: keyword.includes(' ') ? 'Phrase' : 'Word',
        exclusions: [], source: 'BUNDLED', active: false,
      });
    }
  }

  for (const item of remoteManifest?.items || []) {
    for (const rule of item.keywordSafety || []) {
      if (rule.triggerMode !== 'NEVER_AUTO') continue;
      const keyword = normalizeItemKeyword(rule.keyword);
      addRule(rulesByItem, item.itemId, {
        keyword,
        triggerMode: 'NEVER_AUTO',
        keywordType: keyword.includes(' ') ? 'Phrase' : 'Word',
        exclusions: [], source: 'R2', active: false,
      });
    }
  }

  const disabledByItem = new Map();
  for (const rule of snapshot.rules || []) {
    if (rule.action !== 'disable') continue;
    const keyword = normalizeItemKeyword(rule.keyword);
    if (!disabledByItem.has(rule.item_id)) disabledByItem.set(rule.item_id, []);
    const exclusions = base.exclusions?.[keyword] || [];
    disabledByItem.get(rule.item_id).push({
      keyword,
      triggerMode: exclusions.length ? 'AUTO_UNLESS_EXCLUDED' : 'AUTO',
      keywordType: keyword.includes(' ') ? 'Phrase' : 'Word',
      exclusions,
      source: base.synonyms[keyword] === rule.item_id ? 'ADMIN OVERRIDE' : 'ADMIN',
      active: false,
    });
  }

  const items = Object.entries(effective.items)
    .filter(([itemId]) => rulesByItem.has(itemId) || disabledByItem.has(itemId) || remoteById.has(itemId))
    .map(([itemId, item]) => {
      const rules = sortedRules(rulesByItem, itemId);
      const remote = remoteById.get(itemId);
      const imageUrl = remote?.imageKey && publicUrl
        ? `${publicUrl.replace(/\/$/, '')}/${remote.imageKey}` : null;
      return {
        itemId,
        displayName: item.displayName,
        category: item.category || 'Uncategorized',
        bagsCategory: item.bagsCategory || '',
        ruleCount: rules.filter((rule) => rule.active).length,
        neverAutoCount: rules.filter((rule) => rule.triggerMode === 'NEVER_AUTO').length,
        searchText: [itemId, item.displayName, item.category, item.bagsCategory,
          ...rules.map((rule) => rule.keyword)].join(' ').toLowerCase(),
        thumbnail: imageUrl ? { kind: 'url', url: imageUrl } : atlasThumbnail(itemId),
        rules,
        disabledRules: (disabledByItem.get(itemId) || [])
          .sort((a, b) => a.keyword.localeCompare(b.keyword)),
      };
    })
    .sort((a, b) => a.itemId.localeCompare(b.itemId));

  return {
    catalogVersion: ITEM_CATALOG_VERSION,
    revision: snapshot.revision || 0,
    items,
    categories: [...new Set(items.map((item) => item.category))].sort(),
  };
}

export function queryAdminItemCatalog(catalog, { q = '', category = '', page = 1, limit = 120 } = {}) {
  const needle = String(q).trim().toLowerCase();
  const safeLimit = Math.max(1, Math.min(120, Number(limit) || 120));
  const safePage = Math.max(1, Number(page) || 1);
  const filtered = catalog.items.filter((item) =>
    (!category || item.category === category) && (!needle || item.searchText.includes(needle)));
  const start = (safePage - 1) * safeLimit;
  return {
    catalogVersion: catalog.catalogVersion,
    revision: catalog.revision,
    categories: catalog.categories,
    total: filtered.length,
    page: safePage,
    pageSize: safeLimit,
    items: filtered.slice(start, start + safeLimit).map(({ searchText, rules, disabledRules, ...item }) => item),
  };
}

export function findAdminItem(catalog, itemId) {
  const item = catalog.items.find((entry) => entry.itemId === itemId);
  if (!item) return null;
  const { searchText, ...detail } = item;
  return {
    catalogVersion: catalog.catalogVersion,
    revision: catalog.revision,
    item: detail,
  };
}
