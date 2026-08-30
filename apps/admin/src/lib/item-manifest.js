import { createHash, randomUUID } from 'node:crypto';
import {
  ITEM_CATALOG_VERSION,
  ITEM_DICTIONARY,
  applyRemoteItemManifest,
  isRemoteItemManifest,
  normalizeItemKeyword,
} from '@novame/engine';
import {
  r2BumpContentVersion,
  r2GetContentVersion,
  r2GetObjectBytes,
  r2PutObject,
} from './r2-client';

const VALID_MODES = new Set(['AUTO', 'AUTO_UNLESS_EXCLUDED', 'NEVER_AUTO']);
const VALID_TYPES = new Set(['Word', 'Phrase']);
const VALID_RARITIES = new Set(['common', 'uncommon', 'rare']);
const VALID_PROMPT_CATEGORIES = new Set([
  'food drink', 'chores home care', 'self care hygiene', 'health self care',
  'entertainment leisure', 'exercise movement', 'social relationships',
  'travel commute', 'travel getting around', 'nature outdoors',
  'learning hobbies', 'shopping errands',
]);

export function newItemBatchVersion() {
  return `${Date.now()}-${randomUUID().slice(0, 8)}`;
}

export async function loadCurrentItemManifest() {
  const pointer = await r2GetContentVersion();
  const version = String(pointer.itemsVersion || '0');
  if (version === '0') return { version, manifest: null };
  try {
    const value = JSON.parse(new TextDecoder().decode(
      await r2GetObjectBytes(`Items/manifests/${version}.json`),
    ));
    if (!isRemoteItemManifest(value) || value.version !== version) throw new Error('invalid_current_item_manifest');
    return { version, manifest: value };
  } catch (error) {
    throw new Error(`Could not read current Item Manifest: ${error.message}`);
  }
}

function list(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') return value.split(';');
  return [];
}

function cleanSafety(value) {
  if (!Array.isArray(value)) return [];
  return value.map((row) => ({
    keyword: normalizeItemKeyword(String(row?.keyword || '')),
    triggerMode: String(row?.triggerMode || row?.trigger_mode || ''),
    keywordType: String(row?.keywordType || row?.keyword_type || ''),
    exclusions: list(row?.exclusions).map(normalizeItemKeyword).filter(Boolean),
  }));
}

const slug = (value) => normalizeItemKeyword(value).replace(/[^a-z0-9]+/g, '_').slice(0, 54);
const shortHash = (value) => createHash('sha256').update(value).digest('hex').slice(0, 8);

export async function compileItemBatch(rawRows, batchVersion, expectedBaseVersion) {
  if (!Array.isArray(rawRows) || rawRows.length < 1 || rawRows.length > 250) {
    throw new Error('Choose between 1 and 250 icons per batch.');
  }
  if (!/^[0-9]{10,20}-[a-f0-9]{8}$/.test(batchVersion)) throw new Error('Invalid upload batch. Start Preview again.');
  const current = await loadCurrentItemManifest();
  if (expectedBaseVersion != null && String(expectedBaseVersion) !== current.version) {
    throw new Error('The live Item Manifest changed after Preview. Refresh and preview this batch again.');
  }
  const currentItems = current.manifest?.items ?? [];
  const baseByName = new Map(Object.entries(ITEM_DICTIONARY.items)
    .map(([id, item]) => [normalizeItemKeyword(item.displayName), { id, item }]));
  const remoteByName = new Map(currentItems
    .map((item) => [normalizeItemKeyword(item.iconName), item]));
  const seenNames = new Set();
  const seenImages = new Set();
  const errors = [];
  const compiled = [];

  rawRows.forEach((raw, index) => {
    const rowNumber = index + 1;
    const iconName = String(raw?.iconName || raw?.icon_name || '').trim();
    const normalizedName = normalizeItemKeyword(iconName);
    const imageFile = String(raw?.imageFile || raw?.image_file || '').trim();
    if (!iconName || iconName.length > 80) errors.push(`Row ${rowNumber}: iconName is required and must be ≤ 80 characters.`);
    if (!imageFile.toLowerCase().endsWith('.webp')) errors.push(`Row ${rowNumber}: imageFile must name one .webp file.`);
    if (seenNames.has(normalizedName)) errors.push(`Row ${rowNumber}: duplicate iconName in this batch (${iconName}).`);
    seenNames.add(normalizedName);
    if (seenImages.has(imageFile)) errors.push(`Row ${rowNumber}: imageFile is already used by another row (${imageFile}).`);
    seenImages.add(imageFile);
    const bundled = baseByName.get(normalizedName);
    const prior = remoteByName.get(normalizedName);
    const existing = prior || bundled?.item;
    const itemId = prior?.itemId || bundled?.id || `remote.${slug(iconName)}_${shortHash(normalizedName)}`;
    const rarity = String(raw?.rarity || existing?.rarity || 'common').toLowerCase();
    const category = String(raw?.category || existing?.category || '').trim();
    const bagsCategory = String(raw?.bagsCategory || raw?.bags_category || existing?.bagsCategory || '').trim();
    const promptCategory = String(raw?.promptCategory || raw?.prompt_category || prior?.promptCategory || '').trim();
    const visualConcept = String(raw?.visualConcept || raw?.visual_concept || existing?.visualConcept || '').trim();
    if (!VALID_RARITIES.has(rarity)) errors.push(`Row ${rowNumber}: rarity must be common, uncommon, or rare.`);
    if (!category) errors.push(`Row ${rowNumber}: category is required for a new icon.`);
    if (!bagsCategory) errors.push(`Row ${rowNumber}: bagsCategory is required.`);
    if (!promptCategory) errors.push(`Row ${rowNumber}: promptCategory (one Reflect Main_Category) is required.`);
    else if (!VALID_PROMPT_CATEGORIES.has(normalizeItemKeyword(promptCategory))) {
      errors.push(`Row ${rowNumber}: promptCategory “${promptCategory}” is not one of the ten browsable Reflect Main_Category values.`);
    }
    const keywordsMapping = [...new Set(list(raw?.keywordsMapping ?? raw?.keywords_mapping)
      .map(normalizeItemKeyword).filter(Boolean))];
    const keywordSafety = cleanSafety(raw?.keywordSafety ?? raw?.keyword_safety);
    if (!keywordsMapping.length) errors.push(`Row ${rowNumber}: keywordsMapping cannot be empty.`);
    const safetyByKeyword = new Map();
    keywordSafety.forEach((safety) => {
      if (!safety.keyword) errors.push(`Row ${rowNumber}: Keyword Safety contains an empty keyword.`);
      if (safetyByKeyword.has(safety.keyword)) errors.push(`Row ${rowNumber}: duplicate Keyword Safety entry (${safety.keyword}).`);
      safetyByKeyword.set(safety.keyword, safety);
      if (!VALID_MODES.has(safety.triggerMode)) errors.push(`Row ${rowNumber}: invalid Trigger Mode for “${safety.keyword}”.`);
      if (!VALID_TYPES.has(safety.keywordType)) errors.push(`Row ${rowNumber}: invalid Keyword Type for “${safety.keyword}”.`);
      const actualType = safety.keyword.includes(' ') ? 'Phrase' : 'Word';
      if (safety.keywordType && safety.keywordType !== actualType) errors.push(`Row ${rowNumber}: “${safety.keyword}” must be marked ${actualType}.`);
      if (safety.triggerMode === 'AUTO_UNLESS_EXCLUDED' && safety.exclusions.length === 0) {
        errors.push(`Row ${rowNumber}: AUTO_UNLESS_EXCLUDED requires at least one exclusion for “${safety.keyword}”.`);
      }
      if (safety.triggerMode !== 'AUTO_UNLESS_EXCLUDED' && safety.exclusions.length > 0) {
        errors.push(`Row ${rowNumber}: exclusions for “${safety.keyword}” require AUTO_UNLESS_EXCLUDED.`);
      }
    });
    for (const keyword of keywordsMapping) if (!safetyByKeyword.has(keyword)) {
      errors.push(`Row ${rowNumber}: missing Keyword Safety for “${keyword}”.`);
    }
    for (const keyword of safetyByKeyword.keys()) if (!keywordsMapping.includes(keyword)) {
      errors.push(`Row ${rowNumber}: Keyword Safety “${keyword}” is not in keywordsMapping.`);
    }
    compiled.push({
      itemId, iconName, imageFile,
      imageKey: `Items/icons/${itemId}/${batchVersion}.webp`,
      assetVersion: batchVersion,
      rarity, category, bagsCategory, promptCategory,
      ...(visualConcept ? { visualConcept } : {}),
      keywordsMapping, keywordSafety,
      replacesBundled: Boolean(bundled),
      action: prior || bundled ? 'REPLACE' : 'NEW',
    });
  });

  const nextById = new Map(currentItems.map((item) => [item.itemId, item]));
  for (const item of compiled) {
    const { action: _action, imageFile: _imageFile, ...entry } = item;
    nextById.set(item.itemId, entry);
  }
  const nextItems = [...nextById.values()];
  const replacedIds = new Set(nextItems.filter((item) => item.replacesBundled).map((item) => item.itemId));
  const owners = new Map();
  for (const [keyword, owner] of Object.entries(ITEM_DICTIONARY.synonyms)) {
    if (!replacedIds.has(owner)) owners.set(keyword, owner);
  }
  for (const item of nextItems) for (const safety of item.keywordSafety) {
    if (safety.triggerMode === 'NEVER_AUTO') continue;
    const owner = owners.get(safety.keyword);
    if (owner && owner !== item.itemId) {
      errors.push(`Keyword conflict: “${safety.keyword}” already belongs to ${ITEM_DICTIONARY.items[owner]?.displayName || owner}.`);
    } else owners.set(safety.keyword, item.itemId);
  }
  // Exercise the same shared merge used by API and mobile before anything is uploaded.
  applyRemoteItemManifest(ITEM_DICTIONARY, {
    schemaVersion: 1, version: batchVersion, baseCatalogVersion: ITEM_CATALOG_VERSION,
    publishedAt: new Date().toISOString(), items: nextItems,
  });
  return { baseVersion: current.version, errors: [...new Set(errors)], compiled, nextItems };
}

export async function publishItemManifest(version, nextItems) {
  const manifest = {
    schemaVersion: 1,
    version,
    baseCatalogVersion: ITEM_CATALOG_VERSION,
    publishedAt: new Date().toISOString(),
    items: nextItems,
  };
  const body = new TextEncoder().encode(JSON.stringify(manifest));
  await r2PutObject({
    key: `Items/manifests/${version}.json`, body, contentType: 'application/json',
    cacheControl: 'public, max-age=31536000, immutable',
  });
  // The tiny pointer moves last. Until this succeeds every client stays on the
  // complete previous manifest, even if this batch's immutable files landed.
  await r2BumpContentVersion('items', version);
  return manifest;
}
