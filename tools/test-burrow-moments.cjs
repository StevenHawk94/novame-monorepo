const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, hooks, deferred, flush } = require('./lifecycle-test-utils.cjs');

const { momentKind, momentDescription, momentLocalDate } = load('apps/mobile/src/lib/burrow-moments-model.ts');
const { mergeHistory } = load('apps/mobile/src/lib/burrow-history.ts', {
  './api': {}, './async-lifecycle': {}, './session-lifecycle': {},
});
const row = (event_type, payload = {}) => ({ id: event_type, actor_id: 'me', event_type, payload,
  created_at: '2026-10-02T16:12:00Z', localDate: '2026-10-02' });

test('Moments maps completed activities, including sent gifts and Surprises', () => {
  assert.equal(momentKind(row('room_need_refilled', { need: 'water' })), 'water');
  assert.equal(momentKind(row('room_need_refilled', { need: 'food' })), 'feed');
  assert.equal(momentKind(row('memory_created')), 'journal');
  assert.equal(momentKind(row('memory_created', { kind: 'love_note' })), 'letter');
  assert.equal(momentKind(row('affection_sent')), 'affection');
  assert.equal(momentKind(row('game_played')), 'game');
  assert.equal(momentKind(row('adventure_record_saved', { journalKind: 'tap_your_day' })), 'log-day');
  assert.equal(momentKind(row('toy_interacted')), 'toy');
  assert.equal(momentKind(row('rage_room_completed')), 'rage');
  assert.equal(momentKind(row('gift_sent')), 'gift');
  assert.equal(momentKind(row('surprise_sent')), 'surprise');
  assert.equal(momentKind(row('room_media_updated')), null);
  assert.equal(momentKind(row('room_decor_changed')), null);
});

test('Moments uses actor and toy touch count in visible copy', () => {
  assert.equal(momentDescription(row('toy_interacted', { count: 7 }), 'me', 'Alex'), "You squished Alex's plushie 7 times");
  assert.equal(momentDescription({ ...row('affection_sent', { affectionType: 'kiss' }), actor_id: 'alex' }, 'me', 'Alex'), 'Alex sent you a kiss');
  assert.equal(momentLocalDate('2026-10-02T06:00:00Z', 'America/Los_Angeles'), '2026-10-01');
});
test('revised memories, games, Plushie, monster and affection copy matches each viewer perspective',()=>{
 const describe=(type,payload={},other=false,catalog=[])=>momentDescription({...row(type,payload),actor_id:other?'alex':'me'},'me','Alex',catalog);
 assert.equal(describe('memory_created'),'You answered a question in memories room');
 assert.equal(describe('memory_created',{},true),'Alex answered a question in memories room');
 assert.equal(describe('game_played',{gameId:'after_dark_01'}),'You and Alex played Kiss Style');
 assert.equal(describe('game_played',{gameId:'after_dark_01'},true),'You and Alex played Kiss Style');
 assert.equal(describe('toy_interacted',{count:7},true),'Alex squished your plushie 7 times');
 assert.equal(describe('toy_interacted',{count:1}),"You squished Alex's plushie 1 time");
 for(const [monsterId,name] of Object.entries(require('../apps/mobile/src/lib/burrow-moment-names.json').monsters)){
  assert.equal(describe('rage_room_completed',{monsterId}),`You tamed "${name}"`);
  assert.equal(describe('rage_room_completed',{monsterId},true),`Alex tamed "${name}"`);
 }
 for(const [affectionType,tail] of [['gratitude','a thank you'],['miss_you','a “miss you”'],['spicy','some heat 🔥']]){
  assert.equal(describe('affection_sent',{affectionType}),`You sent Alex ${tail}`);
  assert.equal(describe('affection_sent',{affectionType},true),`Alex sent you ${tail}`);
 }
 assert.equal(describe('surprise_sent'),'You sent Alex a surprise');
 assert.equal(describe('surprise_sent',{},true),'Alex sent you a surprise');
 const payload={itemId:'sage',productName:'Green Sage',productCategory:'wallpapers'};
 assert.equal(describe('gift_sent',payload),'You sent Alex a gift 🎁 · Wallpaper-Green Sage');
 assert.equal(describe('gift_sent',payload,true),'Alex sent you a gift 🎁 · Wallpaper-Green Sage');
 const catalog=[{stable_id:'sage',title:'Green Sage',category:'wallpapers'}];
 assert.equal(describe('gift_sent',{itemId:'sage'},false,catalog),'You sent Alex a gift 🎁 · Wallpaper-Green Sage');
 assert.equal(describe('gift_sent',payload,false,[{...catalog[0],title:'Renamed'}]),'You sent Alex a gift 🎁 · Wallpaper-Green Sage');
 assert.equal(describe('gift_sent',{itemId:'deleted'}),'You sent Alex a gift 🎁','missing historical art must not expose raw IDs or invent a product');
});
test('lightweight Moment name lookup stays identical to real game titles and current monster names',()=>{
 const names=require('../apps/mobile/src/lib/burrow-moment-names.json');
 const games=require('../apps/api/src/data/burrow-game-room-v1.json').games;
 assert.deepEqual(names.games,Object.fromEntries(games.map(g=>[g.id,g.title.replace(/\s+[^\x00-\x7F].*$/u,'').trim()])));
 const monsterSource=fs.readFileSync('packages/domain/src/release-room.ts','utf8').split('export type ReleaseMonsterId')[0];
 assert.deepEqual(names.monsters,Object.fromEntries([...monsterSource.matchAll(/\{id:'([^']+)',name:'([^']+)'/g)].map(m=>[m[1],m[2]])));
 assert.equal(Object.keys(names.monsters).length,8);
});
test('care Moments distinguish helper, recipient and self-care on both devices',()=>{
 for(const [need,verb,noun] of [['food','fed','bunny'],['water','watered','flower']]){
  const event={...row('room_need_refilled',{need}),actor_id:'me',target_id:'alex'};
  assert.equal(momentDescription(event,'me','Alex'),`You ${verb} Alex's ${noun}`);
  assert.equal(momentDescription(event,'alex','Sam'),`Sam ${verb} your ${noun}`);
  assert.equal(momentDescription({...event,target_id:'me'},'me','Alex'),`You ${verb} your ${noun}`);
  assert.equal(momentDescription({...event,target_id:'me'},'alex','Sam'),`Sam ${verb} their ${noun}`);
 }
});

test('the nine supplied cropped icon files are genuine WebP images', () => {
  const folder = path.join(__dirname, '../apps/mobile/assets/burrow-webp/moments-icons');
  for (const name of ['water', 'feed', 'journal', 'affection', 'game', 'log-day', 'letter', 'toy', 'rage']) {
    const bytes = fs.readFileSync(path.join(folder, `${name}.webp`));
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  }
});

test('background preparation keeps Moments ready; focus never fetches and manual pull remains explicit', async () => {
  const h = hooks();
  let focused=true,calls=0;
  const waiting = deferred();
  const jsx = (type, props) => ({ type, props });
  const model = { momentKind, momentDescription, momentLocalDate };
  const cache=load('apps/mobile/src/lib/moments-cache-state.ts',{'./burrow-history':{mergeHistory:(a,b)=>[...a,...b]}}).createMomentsCache({
    epoch:()=>1,valid:()=>true,defer:async()=>{},fetch:()=>{
      calls++;return calls<=2?waiting.promise:Promise.resolve({rows:[row('memory_created')],next:null,hasMore:false,timezone:'UTC'});
    },
  });
  const component = load('apps/mobile/src/components/burrow/moments-timeline.tsx', {
    '@/lib/moments-cache':{momentsCache:cache},
    "./burrow-back-button":{BackIcon:'BackIcon',BurrowBackButton:'BackButton'},
    ...require('./burrow-attention-test-mocks.cjs'),
    react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { AppState: { addEventListener: () => ({ remove() {} }) }, Pressable: 'Pressable',
      RefreshControl: 'RefreshControl', SectionList: 'SectionList', ScrollView: 'ScrollView', StyleSheet: { create: value => value, absoluteFillObject: {} },
      Text: 'Text', View: 'View' },
'./burrow-image': { Image: 'Image' }, 'expo-image': { Image: 'Image' }, '@expo/vector-icons': { Feather: 'Feather' },
    'expo-router': { router: { canGoBack: () => true, back() {} } },
    '@react-navigation/native': { useIsFocused: () => focused },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 20, bottom: 20 }) },
    '@/lib/burrow-art-assets': { BURROW_BACKGROUNDS: { common: 'background' } },
    '@/lib/burrow-history': { fetchBurrowHistory: () => {
      calls++;return calls<=2?waiting.promise:Promise.resolve({rows:[row('memory_created')],next:null,hasMore:false,timezone:'UTC'});
    }, historyDayLabel: () => 'Today',
      mergeHistory: (a, b) => [...a, ...b] },
    '@/lib/burrow-moments-model': model,
    '@/lib/burrow-ui-assets': { BURROW_MOMENT_ICONS: { water: 'water' } },
    '@/lib/item-images.g': { ITEM_IMAGES: {} },
    '@/lib/tap-day-images.g': { TAP_DAY_IMAGES: {} },
    '@/lib/session-lifecycle': { sessionEpoch: () => 1 },
    '@/lib/avatar': { getProfileDefaultAvatar: () => 1, isDefaultAvatarId: () => false, resolveAvatarSource: () => 1 },
  });
  const data = { profile: { id: 'me', timezone_name: 'UTC', avatar_url: null },
    partner: { id: 'alex', display_name: 'Alex', avatar_url: null }, localDate: '2026-10-02',
    moments: [row('room_need_refilled', { need: 'water' })] };
  const scroll = () => h.render(() => component.MomentsTimeline({ data })).props.children[2];
  const preparation=cache.prepare(data);await flush();
  const first = scroll();
  assert.equal(first.type, 'SectionList');
  assert.equal(first.props.refreshControl.props.refreshing, false);
  const pending = scroll();
  assert.equal(pending.props.refreshControl.props.refreshing, false);
  assert.equal(pending.props.sections[0].data.length, 1);
  pending.props.refreshControl.props.onRefresh();
  assert.equal(scroll().props.refreshControl.props.refreshing, true);
  waiting.resolve({ rows: [], next: null, hasMore: false, timezone: 'UTC' });
  await preparation;await flush();
  assert.equal(scroll().props.refreshControl.props.refreshing, false);
  assert.equal(calls,2);focused=false;scroll();focused=true;scroll();assert.equal(calls,2,'unchanged cached tab must not refetch on focus');
  data.partner={id:'new-partner',display_name:'New'};await cache.prepare(data);scroll();await flush();
  assert.equal(calls,3);assert.equal(scroll().props.sections[0].data.length,2,'new-scope request must not be invalidated by an old-scope cleanup');
  h.unmount();
});

function timelineFixture(images={}) {
  const h = hooks();
  const jsx = (type, props) => ({ type, props });
  const navigations = [];
  let historyPage = null;
  const component = load('apps/mobile/src/components/burrow/moments-timeline.tsx', {
    '@/lib/moments-cache':{momentsCache:{subscribe(){return()=>{};},read(){return{page:historyPage,loading:false,refreshing:false,error:false};},more:async()=>{},refresh:async()=>{}}},
    "./burrow-back-button":{BackIcon:'BackIcon',BurrowBackButton:'BackButton'},
    ...require('./burrow-attention-test-mocks.cjs'),
    react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Pressable: 'Pressable', RefreshControl: 'RefreshControl', SectionList: 'SectionList',
      Text: 'Text', View: 'View', StyleSheet: { create: value => value, absoluteFillObject: {} } },
    './burrow-image': { Image: 'Image' }, '@expo/vector-icons': { Feather: 'Feather' },
    'expo-router': { router: { push: value => navigations.push(value), canGoBack: () => true, back: () => navigations.push('back') } },
    '@react-navigation/native': { useIsFocused: () => false },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 20, bottom: 20 }) },
    '@/lib/burrow-art-assets': { BURROW_BACKGROUNDS: { common: 'background' } },
    '@/lib/burrow-history': { historyDayLabel: () => 'Today', mergeHistory },
    '@/lib/burrow-moments-model': { momentKind, momentDescription, momentLocalDate },
    '@/lib/burrow-ui-assets': { BURROW_MOMENT_ICONS: {} },
    '@/lib/item-images.g': { ITEM_IMAGES: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`item-${i}`, `image-${i}`])) },
    '@/lib/tap-day-images.g': { TAP_DAY_IMAGES: images },
    '@/lib/session-lifecycle': { sessionEpoch: () => 100 },
    '@/lib/avatar': { getProfileDefaultAvatar: () => 1, isDefaultAvatarId: () => false, resolveAvatarSource: () => 1 },
  });
  const nodes = value => Array.isArray(value) ? value.flatMap(nodes)
    : value && typeof value === 'object' ? [value, ...nodes(value.props?.children)] : [];
  const data = { profile: { id: 'me', timezone_name: 'UTC' }, partner: { id: 'alex', display_name: 'Alex' },
    localDate: '2026-10-02', moments: [] };
  const list = () => nodes(h.render(() => component.MomentsTimeline({ data }))).find(node => node.type === 'SectionList');
  const card = row => {
    const wrapper = list().props.renderItem({ item: row });
    const element = nodes(wrapper).find(node => typeof node.type === 'function');
    return { tree: element.type(element.props), wrapper };
  };
  return { h, data, list, card, nodes, navigations, setHistoryPage(page) { historyPage=page; } };
}

test('real bootstrap/history merge retains complete Adventure bodies and selections for both authors and journal modes',()=>{
  for(const kind of ['tap_your_day','write_freely'])for(const actor_id of ['me','alex']){
    const f=timelineFixture();
    const summary={...row('adventure_record_saved',{journalKind:kind}),actor_id,reference_id:'record-1',reference_type:'reflect'};
    const body='All the words entered during Adventure.\n'+('A complete day, without a line limit. '.repeat(30));
    const items=kind==='tap_your_day'?Array.from({length:13},(_,i)=>({itemId:`item-${i}`,label:`Saved choice ${i}`})):[];
    const detailed={...summary,record:{id:'record-1',body,items,shared:true,version:1}};
    f.data.moments=[summary];f.setHistoryPage({rows:[detailed],timezone:'UTC',next:null,hasMore:false});
    const rows=f.list().props.sections.flatMap(s=>s.data);
    assert.equal(rows.length,1,'one event, not separate summary/detail cards');
    assert.deepEqual(rows[0].record,detailed.record,'summary must never overwrite the authorized record');
    const all=f.nodes(f.card(rows[0]).tree);
    const text=all.find(n=>n.type==='Text'&&n.props.children===body);
    assert.ok(text,'display the full saved body, not the generated event message');assert.equal(text.props.numberOfLines,undefined);
    assert.deepEqual(Array.from(all.filter(n=>n.props.accessibilityRole==='text'),n=>n.props.accessibilityLabel),[...items].sort((a,b)=>a.itemId<b.itemId?-1:1).map(i=>i.label));
    assert.ok(all.every(n=>n.props.children!==momentDescription(summary,'me','Alex')));
    f.h.unmount();
  }
});
test('history hydration, subsequent bootstrap refreshes, older pages and icon-only records do not lose Adventure content',()=>{
  const f=timelineFixture(),summary=row('adventure_record_saved',{journalKind:'tap_your_day'});
  const record={id:'r',body:'',shared:true,items:[{itemId:'item-0',label:'School'}]};
  f.data.moments=[summary];f.list(); // Summary can arrive before its authorized history read.
  f.setHistoryPage({rows:[{...summary,record}],timezone:'UTC',next:null,hasMore:false});
  for(let refresh=0;refresh<3;refresh++){
    f.data.moments=[{...summary,payload:{...summary.payload}},row('affection_sent',{affectionType:'hug'})];
    const entries=f.list().props.sections.flatMap(s=>s.data),event=entries.find(r=>r.id===summary.id);
    assert.deepEqual(event.record,record);
    const all=f.nodes(f.card(event).tree);
    assert.ok(all.some(n=>n.props.accessibilityLabel==='School'));
    assert.ok(all.every(n=>n.props.children!=='You logged your day'));
  }
  f.data.moments=[]; // Record has aged out of the small bootstrap window.
  assert.deepEqual(f.list().props.sections[0].data[0].record,record);
  // A fresh permission-filtered history response still has final authority.
  f.setHistoryPage({rows:[{...summary,record:null}],timezone:'UTC',next:null,hasMore:false});
  f.data.moments=[summary];
  assert.equal(f.list().props.sections[0].data[0].record,null);
  assert.ok(f.nodes(f.card(f.list().props.sections[0].data[0]).tree).every(n=>n.props.accessibilityLabel!=='School'));
  f.h.unmount();
});

test('every Moments event is informational, with no press handler, button role or navigation chevron', () => {
  const f = timelineFixture();
  const events = [row('room_need_refilled', { need: 'water' }), row('room_need_refilled', { need: 'food' }),
    row('memory_created'), row('affection_sent'), row('game_played'),
    row('adventure_record_saved', { journalKind: 'tap_your_day' }), row('memory_created', { kind: 'love_note' }),
    row('toy_interacted'), row('rage_room_completed')];
  for (const event of events) {
    const nodes = f.nodes(f.card(event).tree);
    assert.ok(nodes.every(node => node.type !== 'Pressable' && !node.props.onPress && node.props.accessibilityRole !== 'button'));
    assert.ok(nodes.every(node => node.props.name !== 'chevron-right'));
  }
  assert.equal(f.navigations.length, 0);
  const back = f.nodes(f.list().props.ListHeaderComponent).find(node => node.props.accessibilityLabel === 'Back');
  assert.equal(back.type, 'BackButton');
  assert.equal(back.props.light, true);
  assert.equal(back.props.style, undefined, 'use the full shared circular button');
  back.props.onPress();
  assert.deepEqual(f.navigations, ['back'], 'navigation controls outside event cards still work');
  f.h.unmount();
});

test('timeline icons are 50% smaller, stay centered on the line and leave the card flexible', () => {
  const f = timelineFixture();
  const { tree, wrapper } = f.card(row('room_need_refilled', { need: 'water' }));
  const icon = f.nodes(tree).find(node => node.props.accessibilityLabel === 'water icon');
  assert.equal(icon.props.style.width, 27);
  assert.equal(icon.props.style.height, 27);
  const line = f.nodes(wrapper).find(node => node.props.style?.position === 'absolute');
  assert.equal(line.props.style.left + line.props.style.width / 2, wrapper.props.style.paddingHorizontal + icon.props.style.width / 2);
  assert.equal(tree.props.children[1].props.style.flex, 1);
  f.h.unmount();
});

test('Tap Your Day shows all icon/name pairs with gray separators and natural wrapping, without a type label or truncation', () => {
  const f = timelineFixture();
  for (const count of [0, 1, 6, 7, 13, 97]) {
    const items = Array.from({ length: count }, (_, i) => ({ itemId: `item-${i}`, label: `Selection ${i}`, memory: null }));
    const ordered=[...items].sort((a,b)=>a.itemId<b.itemId?-1:1);
    const event = { ...row('adventure_record_saved', { journalKind: 'tap_your_day' }), record: { body: 'Nice day\nAt school\nAt work\nAt home', items } };
    const nodes = f.nodes(f.card(event).tree);
    const selections = nodes.filter(node => node.type === 'View' && node.props.accessibilityRole === 'text');
    const icons = nodes.filter(node => node.type === 'Image' && node.props.style?.width === 22);
    assert.equal(icons.length, count, 'no display limit, including after the second row');
    assert.deepEqual(Array.from(selections,node => node.props.accessibilityLabel), ordered.map(item => item.label));
    assert.ok(icons.every(node => node.props.accessible === false), 'the icon and visible name are announced once as one pair');
    assert.equal(nodes.find(node => node.type === 'Text' && node.props.children === event.record.body).props.numberOfLines, undefined);
    assert.ok(nodes.every(node => node.props.children !== 'TAP YOUR DAY' && node.props.children !== 'WRITE FREELY'));
    if (count) {
      const flow = nodes.find(node => node.props.style?.flexWrap === 'wrap');
      const clip = nodes.find(node => node.props.children === flow);
      assert.equal(flow.props.style.flexDirection, 'row');
      assert.equal(flow.props.children.length, count);
      assert.equal(clip.props.style.overflow, 'hidden');
      for (const [index, cell] of flow.props.children.entries()) {
        assert.equal(cell.props.style.width, undefined, 'not a fixed six-column grid');
        assert.equal(cell.props.style.maxWidth, '100%', 'long names remain inside the card');
        const dot = f.nodes(cell).find(node => node.props.children === '•');
        const separator = f.nodes(cell).find(node => node.props.children === dot);
        assert.equal(separator.props.style.width, -flow.props.style.marginLeft, 'every wrapped line clips its leading dot without measuring in JS');
        assert.equal(separator.props.accessibilityElementsHidden, true);
        assert.equal(dot.props.style.color, '#ABA69D');
        const label = f.nodes(cell).find(node => node.type === 'Text' && node.props.children === ordered[index].label);
        assert.ok(label, 'saved item name must be visible, not only an accessibility label');
        assert.equal(label.props.numberOfLines, undefined);
        assert.equal(label.props.style.flexShrink, 1);
      }
      assert.ok(icons.every(icon => icon.props.contentFit === 'contain'));
    }
  }
  f.h.unmount();
});

test('Write Freely displays the permitted saved body, while icon-only records have no generated label', () => {
  const f = timelineFixture();
  for (const actor of ['me', 'alex']) {
    const event = { ...row('adventure_record_saved', { journalKind: 'free_write' }), actor_id: actor,
      record: { body: 'My own recorded words\nSecond line\nThird line\nFourth line', items: [] } };
    const nodes = f.nodes(f.card(event).tree);
    assert.ok(nodes.some(node => node.props.children === event.record.body));
    assert.ok(nodes.every(node => node.props.children !== momentDescription(event, 'me', 'Alex')));
  }
  const iconOnly = { ...row('adventure_record_saved', { journalKind: 'tap_your_day' }),
    record: { body: '', items: [{ itemId: 'item-0', label: 'School' }, { itemId: 'legacy-unavailable', label: 'Historic selection' }] } };
  const nodes = f.nodes(f.card(iconOnly).tree);
  assert.ok(nodes.some(node => node.props.accessibilityLabel === 'School'));
  assert.ok(nodes.some(node => node.props.accessibilityLabel === 'Historic selection'));
  assert.ok(nodes.every(node => node.props.children !== 'You logged your day'));
  // Hidden/unavailable records must not expose payload text or gain a detail-fetch action.
  const hidden = { ...row('adventure_record_saved', { journalKind: 'free_write', body: 'Do not expose this' }), record: null };
  const hiddenNodes = f.nodes(f.card(hidden).tree);
  assert.ok(hiddenNodes.every(node => node.props.children !== hidden.payload.body && !node.props.onPress));
  f.h.unmount();
});
test('selection-only Tap records occupy the text column beside the avatar, including whitespace-only notes and multiple rows',()=>{
 const f=timelineFixture();
 for(const body of ['', '   \n\t'])for(const actor_id of ['me','alex'])for(const count of [1,6,7,13,97]){
  const items=Array.from({length:count},(_,i)=>({itemId:`item-${i}`,label:`Selection ${i}`}));
  const event={...row('adventure_record_saved',{journalKind:'tap_your_day'}),actor_id,record:{body,items}};
  const tree=f.card(event).tree,all=f.nodes(tree);
  const flow=all.find(n=>n.props.style?.flexWrap==='wrap');
  const list=all.find(n=>n.props.children===flow);
  const column=all.find(n=>n.props.style?.flex===1&&Array.isArray(n.props.children)&&n.props.children.includes(list));
  assert.ok(column,'selections must live in the text column, not a row below the avatar');
  assert.equal(list.props.style.paddingTop,undefined,'no empty note space above selection-only records');
  const bodyRow=all.find(n=>Array.isArray(n.props.style)&&n.props.style[0]?.flexDirection==='row');
  assert.equal(bodyRow.props.style[1].alignItems,'flex-start','multiple icon rows do not vertically center the avatar');
  assert.equal(all.filter(n=>n.type==='Image'&&n.props.style?.width===22).length,count);
  assert.ok(all.every(n=>n.type!=='Text'||n.props.children!==body));
  assert.equal(flow.props.children.length,count);
 }
 f.h.unmount();
});
test('all 391 picker choices retain their exact artwork in Moments, including the five people icons',()=>{
 const file='apps/mobile/src/lib/tap-day-images.g.ts';
 const imports=Object.fromEntries([...fs.readFileSync(file,'utf8').matchAll(/require\((['"])(.*?)\1\)/g)]
  .map(m=>[m[2],path.resolve(path.dirname(file),m[2])]));
 const {TAP_DAY_IMAGES}=load(file,imports),f=timelineFixture(TAP_DAY_IMAGES);
 const allIds=Object.keys(TAP_DAY_IMAGES);assert.equal(allIds.length,391);
 const event={...row('adventure_record_saved',{journalKind:'tap_your_day'}),
  record:{body:'',items:allIds.map(itemId=>({itemId,label:itemId}))}};
 const selections=f.nodes(f.card(event).tree).filter(n=>n.type==='View'&&n.props.accessibilityRole==='text');
 assert.equal(selections.length,391);assert.equal(allIds.filter(id=>id.startsWith('tap.person.')).length,5);
 for(const item of selections){
  const icon=f.nodes(item).find(n=>n.type==='Image');
  assert.equal(icon.props.source,TAP_DAY_IMAGES[item.props.accessibilityLabel]);assert.equal(icon.props.contentFit,'contain');
  assert.ok(f.nodes(item).some(n=>n.type==='Text'&&n.props.children===item.props.accessibilityLabel));
 }
 // Current Tap art takes priority over old/basic tables when a key overlaps.
 const override=timelineFixture({'item-0':'picker-art'});
 const icon=override.nodes(override.card({...event,record:{body:'',items:[{itemId:'item-0',label:'Selection'}]}}).tree)
  .find(n=>n.type==='Image'&&n.props.style?.width===22);
 assert.equal(icon.props.source,'picker-art');override.h.unmount();f.h.unmount();
});

test('text and selections share one column; long, non-English and historical names stay readable in fixed display order',()=>{
 const f=timelineFixture(),items=[
  {itemId:'item-0',label:'A long saved selection name that must wrap instead of disappearing'},
  {itemId:'item-1',label:'和家人一起吃午餐'},
  {itemId:'retired-item',label:'Historical choice'},
 ];
 const event={...row('adventure_record_saved',{journalKind:'tap_your_day'}),record:{body:'A slow morning, a busy afternoon,\nand a quiet walk home.',items}};
 const all=f.nodes(f.card(event).tree),flow=all.find(n=>n.props.style?.flexWrap==='wrap'),list=all.find(n=>n.props.children===flow);
 const column=all.find(n=>n.props.style?.flex===1&&Array.isArray(n.props.children)&&n.props.children.includes(list));
 assert.ok(column.props.children.some(n=>n?.props?.children===event.record.body));
 assert.deepEqual(Array.from(flow.props.children,n=>n.props.accessibilityLabel),items.map(item=>item.label));
 assert.ok(f.nodes(flow.props.children[2]).some(n=>n.props.children==='✦'));
 assert.ok(f.nodes(flow.props.children[2]).some(n=>n.props.children==='Historical choice'));
 assert.ok(all.every(n=>n.type!=='Pressable'&&!n.props.onPress));f.h.unmount();
});

test('Moments actor filters still work for informational cards', () => {
  const f = timelineFixture();
  f.data.moments = [row('toy_interacted'), { ...row('affection_sent'), actor_id: 'alex' }];
  assert.equal(f.list().props.sections[0].data.length, 2);
  const filters = f.nodes(f.list().props.ListHeaderComponent).filter(node => node.type === 'Pressable' && node.props.accessibilityState);
  filters[1].props.onPress();
  assert.equal(f.list().props.sections[0].data[0].actor_id, 'me');
  filters[2].props.onPress();
  assert.equal(f.list().props.sections[0].data[0].actor_id, 'alex');
  f.h.unmount();
});
test('a new Moments event reuses unchanged normalized rows rather than rebuilding every card',()=>{
 const f=timelineFixture(),old=row('toy_interacted');f.data.moments=[old];
 const first=f.list().props.sections[0].data[0];
 f.data.moments=[{...row('affection_sent'),id:'new-event'},old];
 const after=f.list().props.sections[0].data;
 assert.equal(after.find(x=>x.id===old.id),first);f.h.unmount();
});
