import { normalizeItemKeyword } from '@novame/engine';

export const AUTO_KEYWORD_TEMPLATE_HEADERS = [
  'item_id',
  'icon_name',
  'category',
  'existing_auto_keywords',
  'auto_keywords_to_add',
];

const MAX_CSV_BYTES = 4 * 1024 * 1024;
const MAX_ROWS = 6_000;
const MAX_ADDITIONS = 25_000;

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function buildAutoKeywordTemplateCsv(catalog) {
  const lines = [AUTO_KEYWORD_TEMPLATE_HEADERS.join(',')];
  for (const item of catalog.items) {
    const existing = item.rules
      .filter((rule) => rule.active && rule.triggerMode !== 'NEVER_AUTO')
      .map((rule) => rule.keyword)
      .join(' | ');
    lines.push([
      item.itemId,
      item.displayName,
      item.category,
      existing,
      '',
    ].map(csvCell).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function parseCsv(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  if (new TextEncoder().encode(source).byteLength > MAX_CSV_BYTES) {
    throw new Error('CSV is larger than 4 MB.');
  }
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"'; index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') {
      row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = '';
    } else cell += char;
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted cell.');
  if (cell.length || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  return rows.filter((cells) => cells.some((value) => value.trim()));
}

function splitKeywords(value) {
  return String(value ?? '').split(/[|;\r\n]+/).map((entry) => entry.trim()).filter(Boolean);
}

export function compileAutoKeywordBatchCsv(csv, catalog) {
  let rows;
  try { rows = parseCsv(csv); }
  catch (error) {
    return { additions: [], skipped: [], errors: [error.message] };
  }
  if (!rows.length) return { additions: [], skipped: [], errors: ['CSV is empty.'] };
  if (rows.length - 1 > MAX_ROWS) {
    return { additions: [], skipped: [], errors: [`CSV has more than ${MAX_ROWS.toLocaleString()} data rows.`] };
  }

  const headers = rows[0].map((value) => value.trim().toLowerCase());
  const missingHeaders = AUTO_KEYWORD_TEMPLATE_HEADERS.filter((header) => !headers.includes(header));
  if (missingHeaders.length) {
    return { additions: [], skipped: [], errors: [`Missing template columns: ${missingHeaders.join(', ')}.`] };
  }
  const column = Object.fromEntries(headers.map((header, index) => [header, index]));
  const itemById = new Map(catalog.items.map((item) => [item.itemId, item]));
  const activeOwner = new Map();
  for (const item of catalog.items) for (const rule of item.rules) {
    if (rule.active && rule.triggerMode !== 'NEVER_AUTO') activeOwner.set(rule.keyword, item.itemId);
  }

  const additions = [];
  const skipped = [];
  const errors = [];
  const batchOwner = new Map();
  for (let index = 1; index < rows.length; index += 1) {
    const values = rows[index];
    const rowNumber = index + 1;
    const requested = values[column.auto_keywords_to_add] ?? '';
    if (!requested.trim()) continue;
    const itemId = String(values[column.item_id] ?? '').trim();
    const item = itemById.get(itemId);
    if (!item) {
      errors.push(`Row ${rowNumber}: unknown item_id “${itemId || '(blank)'}”.`);
      continue;
    }
    const iconName = String(values[column.icon_name] ?? '').trim();
    if (iconName && iconName !== item.displayName) {
      errors.push(`Row ${rowNumber}: icon_name does not match ${itemId}; download a fresh template.`);
      continue;
    }
    const neverAuto = new Set(item.rules
      .filter((rule) => rule.triggerMode === 'NEVER_AUTO').map((rule) => rule.keyword));
    const disabled = new Set(item.disabledRules.map((rule) => rule.keyword));
    for (const rawKeyword of splitKeywords(requested)) {
      const keyword = normalizeItemKeyword(rawKeyword);
      if (!keyword || keyword.length > 100) {
        errors.push(`Row ${rowNumber}: “${rawKeyword}” must normalize to 1–100 characters.`);
        continue;
      }
      const priorBatchOwner = batchOwner.get(keyword);
      if (priorBatchOwner) {
        if (priorBatchOwner !== itemId) {
          errors.push(`Row ${rowNumber}: “${keyword}” is assigned to more than one icon in this file.`);
        } else skipped.push({ rowNumber, itemId, iconName:item.displayName, keyword, reason:'duplicate in file' });
        continue;
      }
      batchOwner.set(keyword, itemId);
      const owner = activeOwner.get(keyword);
      if (owner) {
        if (owner !== itemId) {
          errors.push(`Row ${rowNumber}: “${keyword}” already belongs to ${itemById.get(owner)?.displayName || owner}.`);
        } else skipped.push({ rowNumber, itemId, iconName:item.displayName, keyword, reason:'already active' });
        continue;
      }
      if (neverAuto.has(keyword)) {
        errors.push(`Row ${rowNumber}: “${keyword}” is NEVER_AUTO for ${item.displayName}.`);
        continue;
      }
      if (disabled.has(keyword)) {
        errors.push(`Row ${rowNumber}: “${keyword}” is disabled for ${item.displayName}; restore it in the single-icon editor.`);
        continue;
      }
      additions.push({ rowNumber, itemId, iconName:item.displayName, keyword });
    }
  }
  if (additions.length > MAX_ADDITIONS) errors.push(`A batch can add at most ${MAX_ADDITIONS.toLocaleString()} keywords.`);
  return { additions, skipped, errors:[...new Set(errors)] };
}
