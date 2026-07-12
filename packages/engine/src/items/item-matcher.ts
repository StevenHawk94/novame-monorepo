/**
 * Item matching engine (C8). Pure function: reflect text in, matched items out.
 *
 * Rules (schema 1.6 + decision Q5a):
 *   1. tokenize on non-word chars, keeping original offsets
 *   2. dictionary lookup -- the dictionary holds every variant (apple/apples/an
 *      apple), so there's no lemmatizer and matching never drifts
 *   3. negation guard: a negator (didn't / no / without / skipped / never /
 *      avoided) within 3 tokens before the noun drops the hit
 *   4. dedupe: the same item counts once per reflect
 *   5. cap at 5, ranked rare > uncommon > common, then by appearance
 *   6. multi-word entries (apple pie) matched before single tokens
 *
 * The label is the noun plus any adjectives immediately before it. Adjectives
 * are open-class and can't be enumerated, so instead of detecting them we walk
 * back from the noun collecting words until we hit a stopword (article,
 * determiner, preposition, filler) -- "delicious apple" keeps delicious, "an
 * apple" and "uh an apple" reduce to Apple. Title-cased for display. Free users
 * store this label as the memory; paid users get an extra AI-refined line.
 */
export type ItemRarity = 'common' | 'uncommon' | 'rare';

export interface ItemDef {
  displayName: string;
  rarity: ItemRarity;
  category: string;
  sheetId: string;
  row: number;
  col: number;
  /** Placeholder glyph until sprite art lands. */
  emoji?: string;
}

export interface ItemDictionary {
  items: Record<string, ItemDef>;
  synonyms: Record<string, string>;
}

export interface ItemMatch {
  itemId: string;
  displayName: string;
  rarity: ItemRarity;
  /** Noun + adjective prefix, title-cased. The free-tier memory excerpt. */
  label: string;
}

const NEGATORS = new Set([
  "didn't", 'didnt', 'did', 'not', 'no', 'without', 'skipped', 'never', 'avoided', "couldn't", 'couldnt',
]);

const STOPWORDS = new Set([
  'a', 'an', 'the', 'some', 'any', 'this', 'that', 'these', 'those',
  'my', 'your', 'his', 'her', 'its', 'our', 'their',
  'of', 'to', 'in', 'on', 'at', 'for', 'with', 'and', 'or', 'but',
  'i', 'you', 'he', 'she', 'we', 'they', 'it',
  'had', 'have', 'has', 'ate', 'drank', 'got', 'made', 'was', 'were', 'is', 'are',
  'then', 'just', 'really', 'so', 'uh', 'um', 'er', 'eh', 'like',
]);

const RARITY_RANK: Record<ItemRarity, number> = { rare: 3, uncommon: 2, common: 1 };
const MAX_ITEMS = 5;

interface Token {
  word: string;
  start: number;
  end: number;
}

function tokenize(text: string): Token[] {
  // Normalize smart/curly apostrophes to ASCII first: iOS keyboards produce
  // U+2019 by default, which the tokenizer's [a-z0-9'] class wouldn't keep, so
  // "didn't" would split into "didn" + "t" and the negation guard would miss it.
  const normalized = text.replace(/[’‘`´]/g, "'");
  const tokens: Token[] = [];
  const re = /[a-z0-9']+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalized)) !== null) {
    tokens.push({ word: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

function maxPhraseLen(synonyms: Record<string, string>): number {
  let mx = 1;
  for (const k of Object.keys(synonyms)) {
    const n = k.split(' ').length;
    if (n > mx) mx = n;
  }
  return mx;
}

function titleCase(s: string): string {
  return s
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

function buildLabel(tokens: Token[], nounStartIdx: number, displayName: string): string {
  const adjs: string[] = [];
  for (let j = nounStartIdx - 1; j >= 0 && j >= nounStartIdx - 3; j--) {
    const w = tokens[j].word;
    if (STOPWORDS.has(w) || NEGATORS.has(w)) break;
    adjs.unshift(w);
  }
  const label = adjs.length ? `${adjs.join(' ')} ${displayName}` : displayName;
  return titleCase(label);
}

export function matchItems(text: string, dict: ItemDictionary): ItemMatch[] {
  const { items, synonyms } = dict;
  const tokens = tokenize(text);
  const maxLen = maxPhraseLen(synonyms);
  const hits = new Map<string, { itemId: string; tokenIndex: number; label: string }>();
  const consumed = new Array(tokens.length).fill(false);

  for (let i = 0; i < tokens.length; i++) {
    if (consumed[i]) continue;
    for (let len = Math.min(maxLen, tokens.length - i); len >= 1; len--) {
      const phrase = tokens.slice(i, i + len).map((t) => t.word).join(' ');
      const itemId = synonyms[phrase];
      if (!itemId) continue;

      let negated = false;
      for (let j = Math.max(0, i - 3); j < i; j++) {
        if (NEGATORS.has(tokens[j].word)) { negated = true; break; }
      }
      if (negated) {
        for (let k = i; k < i + len; k++) consumed[k] = true;
        break;
      }

      if (!hits.has(itemId)) {
        hits.set(itemId, { itemId, tokenIndex: i, label: buildLabel(tokens, i, items[itemId].displayName) });
      }
      for (let k = i; k < i + len; k++) consumed[k] = true;
      break;
    }
  }

  const ranked = [...hits.values()].sort((a, b) => {
    const ra = RARITY_RANK[items[a.itemId].rarity] ?? 1;
    const rb = RARITY_RANK[items[b.itemId].rarity] ?? 1;
    if (rb !== ra) return rb - ra;
    return a.tokenIndex - b.tokenIndex;
  });

  return ranked.slice(0, MAX_ITEMS).map((h) => ({
    itemId: h.itemId,
    displayName: items[h.itemId].displayName,
    rarity: items[h.itemId].rarity,
    label: h.label,
  }));
}
