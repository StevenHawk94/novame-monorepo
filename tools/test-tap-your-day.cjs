/* Offline API regression tests. Run: node --test tools/test-tap-your-day.cjs
 * Transpile the actual modules; replace only service boundaries. No live AI,
 * database writes, auth sessions, or additional test dependencies are needed.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, imports = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, allowJs: true, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports, console, URL, setTimeout, clearTimeout,
    require(name) {
      if (Object.hasOwn(imports, name)) return imports[name];
      throw new Error('Unexpected dependency: ' + name);
    },
  }, { filename: file });
  return module.exports;
}
const plain = (value) => JSON.parse(JSON.stringify(value));
const { ApiError } = load('packages/api-client/src/error.ts');
function mobileHarness(post) {
  return load('apps/mobile/src/lib/reflect-api.ts', {
    '@novame/api-client': { ApiError },
    'expo-crypto': { randomUUID: () => 'same-client-key' },
    './api': { apiClient: { post } },
    './cosmetics-api': { confirmCloverAward() {} },
    '../shared/storage/keys': { kReflectShareDefaults: { name: 'share' }, kReflectState: { name: 'state' } },
    './storage': { storage: { getString: () => undefined, set() {} } },
    './supabase': { supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: 'writer' } } } }) } } },
  });
}
const legacyChoices = require('../packages/engine/src/items/tap-your-day-v1.json');
const catalog = load('packages/engine/src/items/tap-your-day.ts', { './tap-your-day-v1.json': legacyChoices });
const personItems = load('packages/engine/src/items/tap-person-items.ts').TAP_PERSON_ITEMS;
const rawDictionary = require('../packages/engine/src/items/dictionary.json');
const dictionary = load('packages/engine/src/items/dictionary.ts', { './dictionary.json': rawDictionary, './tap-person-items': { TAP_PERSON_ITEMS: personItems } }).ITEM_DICTIONARY;
const picks = catalog.TAP_YOUR_DAY_CHOICES.map(({ itemId }) => ({ itemId }));
const draftInput = (body = '') => ({ mode: 'prompt', selectionVersion: catalog.TAP_YOUR_DAY_VERSION, selectedItems: picks, body });
function aiHarness(result = { items: {}, bunnyText: null }) {
  const calls = [];
  const ai = load('apps/api/src/lib/reflect-ai.js', {
    './ai': {
      callAI: async (input) => {
        calls.push(input);
        if (result instanceof Error) throw result;
        return { text: JSON.stringify(result) };
      },
      parseAIJson: JSON.parse,
    },
  });
  const draft = load('apps/api/src/lib/reflect-draft.js', {
    '@supabase/supabase-js': { createClient() { throw new Error('Live DB access forbidden'); } },
    '@novame/engine': { ...catalog, matchItems: () => [{ itemId: 'memory.0002_coffee', displayName: 'Coffee', sourceExcerpt: 'Made coffee.' }] },
    '@/lib/remote-items': { getMergedDictionary: async () => dictionary },
    '@/lib/reflect-ai': ai,
  });
  return { ai, draft, calls };
}
const response = { json: (body, options = {}) => ({ status: options.status || 200, body }) };
const request = (body) => ({ headers: new Headers(), json: async () => body });
function routeImports(db, draft, ai) {
  return {
    'next/server': { NextResponse: response, after() {} },
    '@novame/engine': { ...catalog, XP_RULES: { reflect: { award: 30 } } },
    '@/lib/auth-guard': { verifyToken: async () => ({ id: 'writer' }) },
    '@/lib/reflect-draft': { ...draft, serviceClient: () => db },
    '@/lib/reflect-ai': ai,
    '@/lib/ai-usage': { recordAIUsage: async () => {} },
    '@/lib/reflect-analysis-store': {},
  };
}
function dbHarness({ tier = 'plus', consent = true, existing = null, storedDraft = null, matched = [], reflectMode = 'prompt' } = {}) {
  const rpcCalls = [];
  let inserted = null;
  const db = {
    from(table) {
      const query = {
        select() { return this; }, eq() { return this; }, order() { return this; },
        insert(value) { inserted = { ...value, id: 'draft-1', ai_memories: {} }; return this; },
        update() { return this; },
        single() {
          return Promise.resolve({ data: table === 'profiles'
            ? { subscription_tier: tier, ai_consent_at: consent ? '2026-08-01' : null }
            : inserted });
        },
        maybeSingle() {
          return Promise.resolve({ data: table === 'reflects'
            ? { id: 'reflect-1', mode: reflectMode, shared_with_user_id: null }
            : storedDraft || existing });
        },
        then(resolve, reject) {
          return Promise.resolve({ data: table === 'reflect_items' ? matched : [], count: 0 }).then(resolve, reject);
        },
      };
      return query;
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      return { data: { reflect_id: 'reflect-1', updated: args?.p_edits?.length || 0, error: null }, error: null };
    },
  };
  return { db, rpcCalls, inserted: () => inserted };
}

test('all 131 choices reference registered bundled WebP art', () => {
  assert.equal(catalog.TAP_YOUR_DAY_CHOICES.length, 131);
  assert.equal(new Set(picks.map((pick) => pick.itemId)).size, 131);
  for (const choice of catalog.TAP_YOUR_DAY_CHOICES) {
    assert.ok(dictionary.items[choice.itemId], choice.label);
    const art = fs.readFileSync(choice.itemId.startsWith('tap.person.')
      ? path.join(root, 'apps/mobile/assets/items/tap-person', choice.itemId.slice('tap.person.'.length) + '.webp')
      : path.join(root, 'apps/mobile/assets/items/each', choice.itemId + '.webp'));
    assert.equal(art.subarray(0, 4).toString(), 'RIFF');
    assert.equal(art.subarray(8, 12).toString(), 'WEBP');
  }
});
test('all choices survive resolution, including the 30 feelings and last two picks', async () => {
  const { draft } = aiHarness();
  const resolved = await draft.resolveDraftInput(null, draftInput('Happy Day'));
  assert.equal(resolved.error, undefined);
  assert.equal(resolved.matches.length, 131);
  assert.equal(resolved.matches.at(-1).displayName, 'Silly');
  assert.ok(resolved.matches.every((item) => item.sourceExcerpt === ''));
  assert.equal(resolved.matches.find((item) => item.itemId === 'tap.person.pets').selectionLabel, 'Pets');
});
test('mobile prepare sends all 131 selections and their version without truncation', async () => {
  const mobile = mobileHarness(async (url, body) => {
    assert.equal(url, '/api/reflect/prepare');
    assert.equal(body.selectionVersion, catalog.TAP_YOUR_DAY_VERSION);
    assert.equal(body.selectedItems.length, 131);
    return { success: true, draftId: 'one', matches: body.selectedItems };
  });
  const result = await mobile.prepareReflect({ ...draftInput(), promptId: 9 });
  assert.equal(result.ok, true);
  assert.equal(result.draft.matchedItems.length, 131);
});
for (const code of ['too_many_items_in_category', 'invalid_selection_version', 'unknown_item', 'invalid_selection_item']) {
  test('old API selection incompatibility is not a network failure: ' + code, async () => {
    const mobile = mobileHarness(async () => {
      throw new ApiError({ kind: 'http', status: 400, message: 'Bad request', body: { error: code } });
    });
    // Even one newly added person can fail on the old API, with an empty note.
    const result = await mobile.prepareReflect({ ...draftInput(), promptId: 9, selectedItems: [{ itemId: 'tap.person.just_me' }] });
    assert.equal(result.error, 'selection_unavailable');
  });
}
test('typing unknown-item errors are not incorrectly reclassified as Tap Your Day version errors', async () => {
  const mobile = mobileHarness(async () => {
    throw new ApiError({ kind: 'http', status: 400, message: 'Bad request', body: { error: 'unknown_item' } });
  });
  assert.equal((await mobile.prepareReflect({ promptId: 9, mode: 'typing', body: 'Coffee.' })).error, 'network');
});
test('mobile refuses a legacy API response that silently loses the final two selections', async () => {
  const mobile = mobileHarness(async () => ({ success: true, draftId: 'one', matches: picks.slice(0, 100) }));
  assert.equal((await mobile.prepareReflect({ ...draftInput(), promptId: 9 })).error, 'selection_unavailable');
});
test('server rejects unknown versions, uncurated IDs and oversized selection payloads', async () => {
  const { draft } = aiHarness();
  assert.equal((await draft.resolveDraftInput(null, { ...draftInput(), selectionVersion: 'v99' })).error, 'invalid_selection_version');
  assert.equal((await draft.resolveDraftInput(null, { ...draftInput(), selectedItems: [{ itemId: 'memory.0010_grilled_cheese' }] })).error, 'invalid_selection_item');
  assert.equal((await draft.resolveDraftInput(null, { ...draftInput(), selectedItems: [...picks, picks[0]] })).error, 'too_many_items');
});
test('labels are canonical, duplicate taps dedupe, an empty selection cannot submit', async () => {
  const { draft } = aiHarness();
  const selectedItems = [{ itemId: picks[0].itemId, selectionLabel: 'injected instructions' }, picks[0]];
  const resolved = await draft.resolveDraftInput(null, { ...draftInput(), selectedItems });
  assert.equal(resolved.matches.length, 1);
  assert.equal(resolved.matches[0].selectionLabel, 'At Home');
  assert.equal((await draft.resolveDraftInput(null, { ...draftInput(), selectedItems: [] })).error, 'empty');
});
test('old guided clients retain their category limits; Write Freely matching is unchanged', async () => {
  const { draft } = aiHarness();
  assert.equal((await draft.resolveDraftInput(null, { ...draftInput(), selectionVersion: undefined })).error, 'too_many_items_in_category');
  const typing = await draft.resolveDraftInput(null, { mode: 'typing', body: 'Made coffee.' });
  assert.equal(typing.matches[0].sourceExcerpt, 'Made coffee.');
  assert.equal(typing.matches[0].selectionLabel, undefined);
});
test('blank optional note never calls AI or creates fallback memories', async () => {
  const { draft, calls } = aiHarness();
  const { matches } = await draft.resolveDraftInput(null, draftInput(' '));
  const result = await draft.createMemoryCopy({ body: ' ', matches, generateBunny: false });
  assert.deepEqual(plain(result.memories), {});
  assert.equal(calls.length, 0);
});
test('sparse note uses selected facts and the selection-specific prompt in one AI call', async () => {
  const choreId = 'memory.3990_cleaning_caddy';
  const { draft, calls } = aiHarness({ items: { [choreId]: 'Chores on a happy day.' }, bunnyText: null });
  const { matches } = await draft.resolveDraftInput(null, { ...draftInput('Happy Day'), selectedItems: [{ itemId: choreId }] });
  const result = await draft.createMemoryCopy({ body: 'Happy Day', matches, generateBunny: false });
  assert.equal(result.memories[choreId], 'Chores on a happy day.');
  assert.equal(calls.length, 1);
  assert.match(calls[0].systemInstruction, /EXPLICIT SELECTION EVIDENCE/);
  const sent = JSON.parse(calls[0].userText);
  assert.equal(sent.items[0].name, 'Chores');
  assert.equal(sent.items[0].selectionKind, 'activity');
  assert.equal(sent.generateBunny, false);
});
test('large selections receive adequate output budget; every item has a safe failure fallback', async () => {
  const { draft, calls } = aiHarness(new Error('AI offline'));
  const { matches } = await draft.resolveDraftInput(null, draftInput('Dentist at 3pm with Sam.'));
  const result = await draft.createMemoryCopy({ body: 'Dentist at 3pm with Sam.', matches, generateBunny: false });
  assert.ok(calls[0].generationConfig.maxOutputTokens > 8000);
  assert.equal(Object.keys(result.memories).length, 131);
  assert.equal(result.memories['tap.person.pets'], 'Pets.');
  assert.equal(result.memories['tap.person.just_me'], 'Time alone.');
  assert.ok(Object.values(result.memories).every((text) => !text.includes('Dentist') && !text.includes('Sam')));
});
test('absence statements fall back to the selected fact, not a fake no-memory record', async () => {
  const id = picks[0].itemId;
  const { draft } = aiHarness({ items: { [id]: 'No specific memory was recorded for this day.' } });
  const { matches } = await draft.resolveDraftInput(null, { ...draftInput('Happy Day'), selectedItems: [picks[0]] });
  const result = await draft.createMemoryCopy({ body: 'Happy Day', matches, generateBunny: false });
  assert.equal(result.memories[id], 'At Home.');
});
test('typing uses the original prompt and original output budget', async () => {
  const { ai, calls } = aiHarness();
  await ai.runReflectCopy({ journal: 'Coffee.', generateBunny: true, items: [{ id: 'coffee', name: 'Coffee', evidence: 'Coffee.' }] });
  assert.equal(calls[0].systemInstruction, ai.REFLECT_COPY_SYSTEM_PROMPT);
  assert.equal(calls[0].generationConfig.maxOutputTokens, 160);
});
for (const scenario of [
  { tier: 'free', body: '', consent: false, aiCalls: 0 },
  { tier: 'free', body: 'Happy Day', consent: true, aiCalls: 0 },
  { tier: 'plus', body: '', consent: true, aiCalls: 0 },
  { tier: 'plus', body: 'Happy Day', consent: false, aiCalls: 0 },
  { tier: 'plus', body: 'Happy Day', consent: true, aiCalls: 1 },
]) {
  test('prepare permissions/context ' + JSON.stringify(scenario), async () => {
    const { ai, draft, calls } = aiHarness();
    const { db, inserted } = dbHarness(scenario);
    const route = load('apps/api/src/app/api/reflect/prepare/route.js', routeImports(db, draft, ai));
    const result = await route.POST(request({ ...draftInput(scenario.body), userId: 'writer', promptId: 9, idempotencyKey: 'draft-key-123' }));
    assert.equal(result.status, 200);
    assert.equal(calls.length, scenario.aiCalls);
    assert.equal(inserted().matches.length, 131);
    assert.equal(inserted().mode, 'prompt');
    assert.equal(result.body.matches.length, 131);
    assert.equal(Object.keys(result.body.aiMemories).length, scenario.aiCalls ? 131 : 0);
  });
}
test('each new person can prepare a Free reflection without any written note or AI consent', async () => {
  for (const itemId of Object.keys(personItems)) {
    const { ai, draft, calls } = aiHarness();
    const { db, inserted } = dbHarness({ tier: 'free', consent: false });
    const route = load('apps/api/src/app/api/reflect/prepare/route.js', routeImports(db, draft, ai));
    const result = await route.POST(request({ ...draftInput(), selectedItems: [{ itemId }], userId: 'writer', promptId: 9, idempotencyKey: 'draft-person-123' }));
    assert.equal(result.status, 200, itemId);
    assert.equal(inserted().body, '');
    assert.equal(result.body.matches.length, 1);
    assert.equal(result.body.matches[0].itemId, itemId);
    assert.equal(calls.length, 0);
    assert.deepEqual(plain(result.body.aiMemories), {});
  }
});
test('enrichment after upgrade preserves generated items and only targets requested blanks', async () => {
  const { ai, draft, calls } = aiHarness();
  const { matches } = await draft.resolveDraftInput(null, draftInput('Happy Day'));
  const first = matches[0].itemId;
  const second = matches[1].itemId;
  const { db } = dbHarness({ storedDraft: { body: 'Happy Day', mode: 'prompt', matches, ai_memories: { [first]: 'A quiet day at home.' } } });
  const route = load('apps/api/src/app/api/reflect/enrich/route.js', routeImports(db, draft, ai));
  const result = await route.POST(request({ userId: 'writer', draftId: 'draft-1', emptyItemIds: [first, second] }));
  assert.equal(result.status, 200);
  assert.equal(result.body.aiMemories[first], 'A quiet day at home.');
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].userText).items.map((item) => item.id), [second]);
});
test('finalize sends all 131 memories AND sharing choices to the atomic RPC', async () => {
  const { ai, draft } = aiHarness();
  const { db, rpcCalls } = dbHarness({ storedDraft: { body: '', local_date: '2026-08-27', mode: 'prompt' } });
  const route = load('apps/api/src/app/api/reflect/finalize/route.js', routeImports(db, draft, ai));
  const result = await route.POST(request({
    userId: 'writer', draftId: 'draft-1',
    memories: picks.map(({ itemId }) => ({ itemId, text: 'Manually entered.', source: 'manual' })),
    visibility: picks.map(({ itemId }) => ({ itemId, visible: false })),
  }));
  assert.equal(result.status, 200);
  const final = rpcCalls.find((call) => call.name === 'finalize_reflect_draft').args;
  assert.equal(final.p_memories.length, 131);
  assert.equal(final.p_visibility.length, 131);
  assert.equal(final.p_visibility.at(-1).visible, false);
  assert.equal(final.p_memories.at(-1).itemId, picks.at(-1).itemId);
  assert.ok(rpcCalls.some((call) => call.name === 'broadcast_reflect_feed_change'));
});
test('My Logs exposes mode and selection label; editing all 131 retains last items', async () => {
  const { ai, draft } = aiHarness();
  const matched = [{ item_id: 'tap.person.pets', match_label: 'Pets', source_excerpt: '', visible_to_paired: false, items: { display_name: 'Dog' } }];
  const { db, rpcCalls } = dbHarness({ matched });
  const route = load('apps/api/src/app/api/reflect/edit-memories/route.js', routeImports(db, draft, ai));
  const get = await route.GET({ url: 'https://example.test?userId=writer&reflectId=reflect-1', headers: new Headers() });
  assert.equal(get.body.mode, 'prompt');
  assert.equal(get.body.items[0].displayName, 'Pets');
  assert.equal(get.body.items[0].visible, false);
  const post = await route.POST(request({ userId: 'writer', reflectId: 'reflect-1', edits: picks.map(({ itemId }) => ({ itemId, text: 'Edited.' })) }));
  assert.equal(post.status, 200);
  assert.equal(rpcCalls.find((call) => call.name === 'edit_reflect_item_memories').args.p_edits.length, 131);
});

test('v2 has the exact requested food grouping, labels and 16 representative cuisines', () => {
  assert.deepEqual(plain(catalog.TAP_YOUR_DAY_QUESTIONS.map(q => q.groups.reduce((n,g) => n + g.choices.length, 0))), [49,47,5,30]);
  const groups = catalog.TAP_YOUR_DAY_QUESTIONS[1].groups;
  assert.deepEqual(plain(groups.map(g=>g.title)), ['MEALS','CUISINE','SNACKS','DRINKS']);
  assert.deepEqual(plain(groups[0].choices.map(c=>c.label)), ['Breakfast','Noodles','Pizza','Pasta','Sandwich','Wrap','Burger','Taco','Dumplings','Sushi','Salad','Rice','Soup','Curry','Meat','Seafood','Vegetables','Fast Food']);
  assert.deepEqual(plain(groups[2].choices.map(c=>c.label)), ['Fruit','Snack','Pastry','Dessert']);
  assert.deepEqual(plain(groups[3].choices.map(c=>c.label)), ['Water','Coffee','Tea','Juice','Smoothie','Soda','Milk','Energy Drink','Alcohol']);
  assert.deepEqual(plain(groups[1].choices.map(c=>[c.label,dictionary.items[c.itemId].displayName])), [
    ['American Food','Corn Dog'],['Chinese Food','Dim Sum'],['Japanese Food','Bento Box'],['Korean Food','Korean BBQ'],
    ['Mexican Food','Enchiladas'],['Italian Food','Ravioli'],['Indian Food','Chicken Tikka Masala'],['Thai Food','Pad Thai'],
    ['Vietnamese Food','Pho'],['Mediterranean Food','Falafel Plate'],['Middle Eastern Food','Shawarma'],['Caribbean Food','Jerk Chicken'],
    ['Filipino Food','Adobo'],['French Food','Crepes'],['Greek Food','Gyro'],['Ethiopian Food','Injera'],
  ]);
});
test('old v1 clients keep all 102 original IDs and meanings, including the retired person option', async () => {
  const { draft } = aiHarness();
  const oldInput = { mode:'prompt', selectionVersion:'tap-your-day-v1', body:'', selectedItems:legacyChoices.map(c=>({itemId:c.itemId})) };
  const result = await draft.resolveDraftInput(null, oldInput);
  assert.equal(result.matches.length, 102);
  assert.deepEqual(plain(result.matches.map(c=>c.selectionLabel)), legacyChoices.map(c=>c.label));
  assert.equal(catalog.tapYourDayChoice('memory.0056_rice_bowl', 'tap-your-day-v1').label, 'Rice & Noodles');
  assert.equal(catalog.tapYourDayChoice('memory.0056_rice_bowl').label, 'Rice');
  assert.equal(catalog.tapYourDayChoice('memory.1542_meeting_room'), undefined);
  assert.equal((await draft.resolveDraftInput(null,{...oldInput,selectedItems:[...oldInput.selectedItems,oldInput.selectedItems[0]]})).error,'too_many_items');
  assert.equal((await draft.resolveDraftInput(null,{...oldInput,selectedItems:[{itemId:'tap.person.pets'}]})).error,'invalid_selection_item');
});
test('new people are selection-only; old item definitions and keyword matching remain unchanged', () => {
  assert.deepEqual(plain(dictionary.synonyms), rawDictionary.synonyms);
  assert.deepEqual(plain(dictionary.exclusions), rawDictionary.exclusions);
  for(const [id,item] of Object.entries(rawDictionary.items)) assert.deepEqual(plain(dictionary.items[id]),item);
  assert.equal(Object.keys(dictionary.items).length, 5444);
  for(const id of Object.keys(personItems)) {
    assert.ok(!Object.values(dictionary.synonyms).includes(id));
    assert.equal(catalog.tapYourDayChoice(id).kind,'person');
    const migration=fs.readFileSync(path.join(root,'supabase/migrations/20260827000067_tap_person_items.sql'),'utf8');
    assert.ok(migration.includes("'"+id+"'"));
  }
});
test('cuisine copy uses the selected category, not the representative dish as a claimed fact', async () => {
  const {draft,calls}=aiHarness();
  const {matches}=await draft.resolveDraftInput(null,{...draftInput('Happy day'),selectedItems:[{itemId:'memory.0119_dim_sum'}]});
  const result=await draft.createMemoryCopy({body:'Happy day',matches,generateBunny:false});
  assert.equal(result.memories['memory.0119_dim_sum'],'Chinese Food.');
  assert.equal(JSON.parse(calls[0].userText).items[0].name,'Chinese Food');
  assert.match(calls[0].systemInstruction,/Chinese Food.*Dim Sum/);
});
test('cropped people retain transparent margins, centered bounds and distinct image registrations', async () => {
  const sharp=require(require.resolve('sharp',{paths:[path.dirname(require.resolve('next',{paths:[path.join(root,'apps/api')]}))]}));
  const imageMap=fs.readFileSync(path.join(root,'apps/mobile/src/lib/tap-person-images.ts'),'utf8');
  for(const id of Object.keys(personItems)) {
    const name=id.slice('tap.person.'.length);
    assert.ok(imageMap.includes("'"+id+"': require('../../assets/items/tap-person/"+name+".webp')"));
    const {data,info}=await sharp(path.join(root,'apps/mobile/assets/items/tap-person',name+'.webp')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    assert.equal(info.width,256);assert.equal(info.height,256);
    let left=256,right=-1,top=256,bottom=-1;
    for(let y=0;y<256;y++)for(let x=0;x<256;x++)if(data[(y*256+x)*4+3]>0){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
    assert.ok(left>=16 && top>=16 && right<=239 && bottom<=239, name+' has clear margins');
    assert.ok(Math.abs((left+right)/2-127.5)<=1 && Math.abs((top+bottom)/2-127.5)<=1, name+' is centered');
  }
});
