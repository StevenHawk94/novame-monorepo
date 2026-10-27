// Validate the immutable historical display catalog. Matching data is retired.
const fs = require('node:fs');
const display = require('../packages/engine/src/items/display-catalog.json');
const groups = require('../packages/engine/src/items/tap-your-day-local.json');
if (Object.keys(display).length !== 5439) throw Error('Historical IDs must be preserved');
for (const [id, item] of Object.entries(display)) {
  if (!item.displayName || !item.rarity || !item.category) throw Error('Invalid historical display: ' + id);
  if ('keywords' in item || 'synonyms' in item) throw Error('Matching vocabulary must not return');
}
const choices = groups.flatMap(g => [...g.defaults, ...g.optional]);
if (new Set(choices.map(x => x.itemId)).size !== 391) throw Error('Manual selection catalog changed');
if (fs.existsSync('apps/mobile/assets/data/legacy-item-matching.dict')) throw Error('Retired matching asset returned');
console.log('5439 historical item displays and 391 manual picks preserved; no matching vocabulary.');
