// Review artifact only. This does not change the app catalogue or delete assets.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
// Frozen review baseline; never derive the proposal from the new picker.
const moduleBox = { exports: { TAP_YOUR_DAY_QUESTIONS: require('../packages/engine/src/items/tap-your-day-v2.json') } };
const dictionary = require('../packages/engine/src/items/display-catalog.json');
const art = fs.readFileSync(path.join(root, 'apps/mobile/src/lib/item-images.g.ts'), 'utf8');
const local = new Set([...art.matchAll(/['"](memory\.[^'"]+)['"]\s*:/g)].map(match => match[1]));
const byName = new Map(Object.entries(dictionary).map(([id, item]) => [item.displayName, id]));
const retained = new Map();
const groups = moduleBox.exports.TAP_YOUR_DAY_QUESTIONS.flatMap(question => question.groups.map(group => ({
  kind: question.kind, title: group.title || (question.kind === 'person' ? 'PEOPLE' : 'FEELINGS'), choices: group.choices,
})));
function add(name, label, group, tier = 'optional') {
  const itemId = byName.get(name);
  if (!itemId) throw Error('Unknown icon: ' + name);
  if (retained.has(itemId)) return;
  retained.set(itemId, { itemId, iconName: name, label, group, tier, bundled: local.has(itemId) });
}
for (const group of groups) for (const choice of group.choices) retained.set(choice.itemId, {
  itemId: choice.itemId, iconName: dictionary[choice.itemId]?.displayName || choice.label,
  label: choice.label, group: group.title, tier: group.title === 'CUISINE' ? 'optional' : 'default',
  bundled: local.has(choice.itemId) || choice.itemId.startsWith('tap.person.'),
});
for (const [name, label] of [
  ['Washing Machine', 'Doing Laundry'], ['Vacuum Cleaner', 'Vacuuming'], ['Dishwasher', 'Doing the Dishes'],
]) add(name, label, 'HOME & CARE', 'default');
const variants = {
  'DAILY RHYTHM': [['Exam', 'Taking an Exam'], ['Parcel', 'Sending / Receiving a Parcel'], ['Tax Return', 'Doing Taxes'], ['Moving Box', 'Moving Home']],
  'HOME & CARE': [['Clothes Dryer', 'Drying Clothes'], ['Recycling Bin', 'Recycling'], ['Trash Can', 'Taking Out the Trash'], ['Lawn Mower', 'Mowing the Lawn'], ['Weeding', 'Weeding'], ['Leaf Rake', 'Raking Leaves'], ['Litter Box', 'Caring for My Cat']],
  'MOVEMENT & OUTDOORS': [['Reformer Pilates', 'Pilates'], ['Dance', 'Dancing'], ['Ballet', 'Ballet'], ['Rock Climbing', 'Climbing'], ['Skiing', 'Skiing'], ['Snowboard', 'Snowboarding'], ['Kayak', 'Kayaking'], ['Surfboard', 'Surfing'], ['Roller Skates', 'Roller Skating'], ['Soccer Ball', 'Playing Soccer'], ['Tennis Racket', 'Playing Tennis'], ['Badminton Racket', 'Playing Badminton'], ['Volleyball', 'Playing Volleyball'], ['Bowling Ball', 'Bowling'], ['Boxing Gloves', 'Boxing']],
  'SOCIAL & GOING OUT': [['Birthday', 'Celebrating a Birthday'], ['Concert', 'Going to a Concert'], ['Theater', 'Seeing a Show'], ['Museum', 'Visiting a Museum'], ['Theme Park', 'Visiting a Theme Park'], ['Hugging', 'Sharing a Hug'], ['Holding Hands', 'Holding Hands']],
  'ENTERTAINMENT & DOWNTIME': [['Board Game', 'Playing Board Games'], ['Card Game', 'Playing Cards'], ['Jigsaw Puzzle', 'Doing a Puzzle'], ['Escape Room', 'Visiting an Escape Room'], ['Singing', 'Singing'], ['Karaoke Machine', 'Karaoke'], ['Mobile Gaming', 'Mobile Gaming'], ['Video', 'Watching Videos']],
  'HOBBIES & PERSONAL GROWTH': [['Drawing', 'Drawing'], ['Painting', 'Painting'], ['Knitting Needles', 'Knitting'], ['Crochet Hook', 'Crocheting'], ['Sewing Kit', 'Sewing'], ['Pottery Wheel', 'Making Pottery'], ['Woodworking', 'Woodworking'], ['Video Editing', 'Editing Videos'], ['Tent', 'Camping'], ['Fishing Rod', 'Fishing'], ['Binoculars', 'Birdwatching'], ['Telescope', 'Stargazing']],
  'MEALS': [['Food Delivery', 'Ordering Takeout']],
};
for (const [group, entries] of Object.entries(variants)) for (const [name, label] of entries) add(name, label, group);
const items = [...retained.values()];
const excluded = Object.entries(dictionary).filter(([id]) => !retained.has(id)).map(([itemId, item]) => ({
  itemId, iconName: item.displayName, originalCategory: item.category,
  disposition: 'exclude_from_new_picker_only',
  reason: 'Outside the proposed compact activity/food/people/feeling whitelist; preserve historical references. Not approval to delete the image.',
}));
const proposal = {
  status: 'awaiting_user_approval', appliedToApp: false, physicalDeletionApproved: false,
  imagePolicy: 'After approval, all new selectable icons are bundled locally. R2 is historical-read compatibility only.',
  summary: { baseCatalog: Object.keys(dictionary).length, defaults: items.filter(x => x.tier === 'default').length,
    optional: items.filter(x => x.tier === 'optional').length, excludedFromNewPicker: excluded.length,
    retainedImagesNeedingLocalPackaging: items.filter(x => !x.bundled).length },
  groups: [...new Set(items.map(x => x.group))].map(title => ({ title,
    defaults: items.filter(x => x.group === title && x.tier === 'default'),
    optional: items.filter(x => x.group === title && x.tier === 'optional'),
  })),
  excludedPolicy: 'Exclude all base catalogue IDs outside the retained groups from NEW selection only. Preserve historical references and assets; no physical deletion is authorized.',
  excludedExamples: ['Charger', 'Power Bank', 'Cable', 'Adapter'],
  excludedCount: excluded.length,
};
if (process.argv.includes('--patch')) {
  process.stdout.write('*** Begin Patch\n*** Add File: docs/tap-your-day-icon-proposal.json\n'
    + JSON.stringify(proposal, null, 2).split('\n').map(line => '+' + line).join('\n') + '\n*** End Patch\n');
} else console.log(JSON.stringify(proposal.summary, null, 2));
