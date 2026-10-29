const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, hooks, clock, deferred, flush } = require('./lifecycle-test-utils.cjs');

const jsx = (type, props) => ({ type, props });
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes)
  : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
const native = { Pressable: 'Pressable', Text: 'Text', View: 'View',
  StyleSheet: { create: value => value, absoluteFillObject: {} },
  useWindowDimensions: () => ({ width: 390, height: 844 }) };
const layoutModel=load('apps/mobile/src/lib/burrow-care-layout.ts');
test('watering hold duration uses real foreground time even when rendering drops frames; particle steps stay bounded',()=>{
 const model=load('apps/mobile/src/lib/care-water-motion.ts',{'./burrow-care-layout':layoutModel}),state=model.createWaterMotion();
 state.holding=true;const layout=layoutModel.careLayout(390,700);
 for(let i=0;i<5;i++)assert.equal(model.advanceWaterMotion(state,500,layout),false);
 assert.equal(model.advanceWaterMotion(state,510,layout),true);assert.equal(state.progress,1);
 assert.equal(model.advanceWaterMotion(state,500,layout),false,'one completion only');assert.ok(state.drops.length<=600);
});
test('a delayed first native frame counts the hold already in progress rather than restarting its clock',()=>{
 const model=load('apps/mobile/src/lib/care-water-motion.ts',{'./burrow-care-layout':layoutModel}),state=model.createWaterMotion(),layout=layoutModel.careLayout(390,700);
 state.holding=true;state.holdStartedAt=10000;
 assert.equal(model.advanceWaterMotion(state,0,layout,false,10800),false);assert.ok(Math.abs(state.progress-.8/3)<1e-9);
 assert.equal(model.advanceWaterMotion(state,16,layout,false,13001),true);
});

test('already-cared status is a cream centered card with exact copy and a brown OK button, not a system alert', () => {
  const { CareStatusDialog } = load('apps/mobile/src/components/burrow/care-status-dialog.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { ...native, Modal: 'Modal' },
    '@/lib/burrow-care-cooldown': load('apps/mobile/src/lib/burrow-care-cooldown.ts'),
  });
  for(const kind of ['food','water']) {
    let closes=0;
    const tree=nodes(CareStatusDialog({kind,onClose:()=>closes++}));
    const modal=tree.find(n=>n.type==='Modal'); assert.equal(modal.props.transparent,true);
    assert.ok(tree.some(n=>n.props?.children===(kind==='food'?'Your bunny is full and happy.':'Your flower is fresh and growing.')));
    assert.ok(tree.some(n=>n.props?.style?.backgroundColor==='#FFF8EE'));
    const button=tree.find(n=>n.props?.accessibilityLabel==='OK');
    assert.equal(button.props.style.backgroundColor,'#662F19');
    button.props.onPress(); modal.props.onRequestClose(); assert.equal(closes,2);
  }
});
test('partner care status names the actual room owner instead of saying Your',()=>{
 const model=load('apps/mobile/src/lib/burrow-care-cooldown.ts');
 assert.equal(model.careCooldownMessage('food','  Irina  '),"Irina's bunny is full and happy.");
 assert.equal(model.careCooldownMessage('water','Irina'),"Irina's flower is fresh and growing.");
});

function careHarness(kind,options={}) {
  const h = hooks(), timer = clock(), intervals = new Map(), listeners = new Set(), focusEffects = new Set();
  let intervalId = 0, pulses = 0, completed = 0, complete = false;
  const globals = { ...timer.globals,
    setInterval(fn, ms) {
      const id = ++intervalId, item = {};
      intervals.set(id, item);
      const tick = () => { if (!intervals.has(id)) return; fn();
        if (intervals.has(id)) item.timer = timer.globals.setTimeout(tick, ms); };
      item.timer = timer.globals.setTimeout(tick, ms); return id;
    },
    clearInterval(id) { const item = intervals.get(id); if (item) timer.globals.clearTimeout(item.timer); intervals.delete(id); },
    requestAnimationFrame: fn => timer.globals.setTimeout(() => fn(timer.globals.Date.now()), 16),
    cancelAnimationFrame: id => timer.globals.clearTimeout(id),
  };
  const appState = { currentState: 'active', addEventListener(_, listener) {
    listeners.add(listener); return { remove: () => listeners.delete(listener) };
  } };
  class Value { interpolate() { return 0; } }
  const motion=require('./motion-test-utils.cjs').motionHarness(h,timer);
  const component = load('apps/mobile/src/components/burrow/care-interaction.tsx', {
    'react-native-reanimated':motion.reanimated,
    './care-progress':{CareProgress:'CareProgress'},
    '@/lib/care-water-motion':load('apps/mobile/src/lib/care-water-motion.ts',{'./burrow-care-layout':layoutModel}),
    react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { ...native, useWindowDimensions:()=>options.screen??{width:390,height:844}, AppState: appState, Animated: { Value, View: 'AnimatedView',
      timing: (_, options) => { let id; return {
        start(done) { id = timer.globals.setTimeout(done, options.duration); },
        stop() { timer.globals.clearTimeout(id); },
      }; } } },
    'expo-router': { useFocusEffect(callback) { h.react.useEffect(() => {
      const entry = { callback, cleanup: callback() }; focusEffects.add(entry);
      return () => { entry.cleanup?.(); focusEffects.delete(entry); };
    }, [callback]); } },
    'react-native-svg': { __esModule: true, default: 'Svg', Circle: 'Circle', ClipPath: 'ClipPath',
      Defs: 'Defs', Ellipse: 'Ellipse', G: 'G', Path: 'Path', Rect:'Rect' },
    './burrow-image': { Image: 'Image' },
    '@/lib/haptics': { haptics: { selection: async () => { pulses++; } } },
    '@/lib/burrow-care-layout':layoutModel,
  }, globals)[kind === 'food' ? 'FeedInteraction' : 'WaterInteraction'];
  const render = () => h.render(() => component({ ...options,complete, onComplete: () => completed++ }));
  const press = label => nodes(render()).find(node => node.type === 'Pressable'&&(!label||node.props.accessibilityLabel===label)).props;
  render();
  return { timer, intervals, render, motion, activate:()=>press().onAccessibilityAction(), start: label => press(label).onPressIn(), release: label => press(label).onPressOut(),
    pulses: () => pulses, completed: () => completed,
    setComplete(value) { complete = value; render(); },
    state(value) { appState.currentState = value; listeners.forEach(listener => listener(value)); },
    blur() { focusEffects.forEach(entry => { entry.cleanup?.(); entry.cleanup = null; }); },
    focus() { focusEffects.forEach(entry => { entry.cleanup = entry.callback(); }); },
    unmount: h.unmount, listeners,
  };
}

test('feeding vibrates throughout the hold and completes on the last bite without another phase', () => {
  const h = careHarness('food');
  h.start(); assert.equal(h.pulses(), 1);
  h.timer.advance(4100);
  assert.equal(h.completed(), 0); assert.ok(h.pulses() >= 40);
  h.timer.advance(100); assert.equal(h.completed(), 1);
  assert.equal(h.intervals.size, 0);
  const pulses = h.pulses(); h.timer.advance(1000);
  h.start(); assert.equal(h.pulses(), pulses); assert.equal(h.completed(), 1);
  h.unmount(); assert.equal(h.timer.timers.size, 0);
});

test('feeding release stops feedback, and resuming the final bite does not leak a timer', () => {
  const h = careHarness('food');
  h.start(); h.timer.advance(12 * 320); h.release();
  const pulses = h.pulses(); h.timer.advance(1000);
  assert.equal(h.pulses(), pulses); assert.equal(h.completed(), 0);
  h.start();h.timer.advance(350); assert.equal(h.completed(), 1); assert.equal(h.intervals.size, 0);
  h.unmount();
});

test('feeding meter visits every percentage 0–100 rather than jumping with fourteen bites',()=>{
 const h=careHarness('food');h.start();
 assert.ok(h.motion.timings.some(a=>a.value===1&&a.config.duration===4160&&a.config.easing==='linear'));
 const ui=hooks(),nativeMotion=require('./motion-test-utils.cjs').motionHarness(ui),progress={value:0};
 const {CareProgress}=load('apps/mobile/src/components/burrow/care-progress.tsx',{
  react:ui.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{TextInput:'Counter',View:'View',StyleSheet:{create:x=>x}},
  'react-native-reanimated':{...nativeMotion.reanimated,useAnimatedReaction(){}},
 });
 for(let percent=0;percent<=100;percent++){
  progress.value=percent/100;
  const tree=ui.render(()=>CareProgress({progress,label:'Feeding',color:'#F1813C'}));
  assert.equal(nodes(tree).find(n=>n.type==='Counter').props.animatedProps.text,`Feeding ${percent}%`);
 }
 h.timer.advance(4250);
 assert.equal(h.completed(),1);h.unmount();assert.equal(h.timer.timers.size,0);
});

test('watering vibrates for the full three-second hold and completes immediately at the threshold', () => {
  const h = careHarness('water');
  h.start(); h.timer.advance(2900);
  assert.equal(h.completed(), 0); assert.ok(h.pulses() >= 29);
  h.timer.advance(150); assert.equal(h.completed(), 1); assert.equal(h.intervals.size, 0);
  const pulses = h.pulses(); h.timer.advance(1000); h.start();
  assert.equal(h.pulses(), pulses); assert.equal(h.completed(), 1);
  h.unmount(); assert.equal(h.timer.timers.size, 0);
});

for (const kind of ['food', 'water']) {
  test(`${kind}: backgrounding, navigation blur, external completion and unmount stop hold feedback`, () => {
    const h = careHarness(kind);
    h.start(); h.timer.advance(500); h.state('background');
    let pulses = h.pulses(); h.timer.advance(1000); h.start();
    assert.equal(h.pulses(), pulses); assert.equal(h.completed(), 0);
    h.state('active'); h.timer.advance(500); assert.equal(h.pulses(), pulses);
    h.start(); h.timer.advance(300); h.blur();
    pulses = h.pulses(); h.timer.advance(1000); h.start(); assert.equal(h.pulses(), pulses);
    h.focus(); h.start(); h.timer.advance(300); assert.ok(h.pulses() > pulses);
    h.setComplete(true); pulses = h.pulses(); h.timer.advance(1000); assert.equal(h.pulses(), pulses);
    h.unmount(); assert.equal(h.timer.timers.size, 0); assert.equal(h.listeners.size, 0);
  });
}

test('watering interruption resets the unfinished hold rather than combining short holds', () => {
  const h = careHarness('water');
  h.start(); h.timer.advance(2000); h.release();
  h.timer.advance(500); h.start(); h.timer.advance(2000);
  assert.equal(h.completed(), 0);
  h.timer.advance(1100); assert.equal(h.completed(), 1); h.unmount();
});
for(const kind of ['food','water'])test(`${kind}: screen-reader activation uses the same duration and rewards only once`,()=>{
 const h=careHarness(kind);h.activate();h.activate();h.timer.advance(kind==='food'?4100:2900);assert.equal(h.completed(),0);
 h.timer.advance(200);assert.equal(h.completed(),1);h.activate();h.timer.advance(500);assert.equal(h.completed(),1);h.unmount();assert.equal(h.timer.timers.size,0);
});

test('reference copy is shown once and the carrot viewport contains the entire leaf crown',()=>{
  for(const kind of ['food','water']){
    const h=careHarness(kind),tree=nodes(h.render());
    assert.equal(tree.filter(node=>node.props?.children==='Press and Hold').length,1);
    assert.ok(tree.some(node=>node.type==='CareProgress'&&node.props.label===(kind==='food'?'Feeding':'Watering')&&node.props.progress.value===0));
    if(kind==='food')assert.equal(tree.find(node=>node.type==='Svg').props.viewBox,'0 -24 230 424');
    h.unmount();
  }
});

test('can and flower are equivalent hold targets; two fingers never duplicate completion or cancel each other',()=>{
  const can='Hold the watering can for three seconds',flower='Hold the flower for three seconds';
  for(const target of [can,flower]){
    const h=careHarness('water');h.start(target);h.timer.advance(3050);
    assert.equal(h.completed(),1);h.unmount();
  }
  const h=careHarness('water');h.start(can);h.timer.advance(1600);h.start(flower);h.release(can);
  h.timer.advance(1450);assert.equal(h.completed(),1);h.release(flower);h.start(can);
  assert.equal(h.completed(),1);h.unmount();
});

test('watering animation is dormant before a hold and returns to no scheduled frames once released',()=>{
  const h=careHarness('water');assert.equal(h.timer.timers.size,0);
  h.start();h.timer.advance(400);assert.ok(h.timer.timers.size>0);
  h.release();h.timer.advance(2500);assert.equal(h.timer.timers.size,0);
  h.unmount();
});

test('measured content height overrides the window estimate, shrinking art without scaling or distorting its proportions',()=>{
  for(const kind of ['food','water']){
    const h=careHarness(kind,{availableHeight:700});
    const before=nodes(h.render()).find(node=>node.type==='Svg').props;
    h.render().props.onLayout({nativeEvent:{layout:{height:430}}});
    const after=nodes(h.render()).find(node=>node.type==='Svg').props;
    if(kind==='food'){assert.ok(after.height<before.height);assert.equal(after.width/after.height,230/424);}
    else assert.ok(Number(after.viewBox.split(' ')[3])<Number(before.viewBox.split(' ')[3]));
    h.unmount();
  }
});

test('every screen size and flower shape has a downturned nozzle gap and clips drops halfway down visible flower art',()=>{
  for(const [width,height] of [[320,350],[375,520],[390,698],[430,800],[768,850]]){
    for(const bounds of [[0,0,100,500],[30,20,450,460],[0,100,600,250]]){
      const asset={source:1,width:600,height:500,bounds};
      const layout=layoutModel.careLayout(width,height,asset);
      assert.ok(layout.carrotTop+layout.carrotHeight<height-75);
      assert.equal(layout.waterEnd,layout.flower.top+layout.flower.height*.5);
      assert.ok(layout.stageTop+layout.flower.top+layout.flower.height<height-70);
      assert.ok(layout.canHit.width>0&&layout.canHit.height>0);
      for(const hole of [[-221.9,-25.6],[-217.9,-34.8],[-214,-44],[-210,-53.2],[-206.1,-62.4]]){
        const point=layoutModel.wateringCanPoint(...hole,-75,layout.can);
        assert.ok(point.y<layout.flower.top-layout.stageHeight*.10);
        assert.ok(point.x>0&&point.x<layout.stageWidth);
      }
      // Uniform image scale means no stretching, despite transparent margins.
      assert.equal(layout.flower.image.width/asset.width,layout.flower.image.height/asset.height);
    }
  }
  assert.ok(layoutModel.careLayout(390,430).can.scale<layoutModel.careLayout(390,700).can.scale);
});

test('rendered water clip plane follows actual layout and no fixed floor-height particle cutoff remains',()=>{
  const asset={source:1,width:500,height:500,bounds:[70,33,426,500]};
  const h=careHarness('water',{flower:asset,availableHeight:698}),layout=layoutModel.careLayout(390,698,asset);
  h.start('Hold the flower for three seconds');h.timer.advance(800);
  const tree=nodes(h.render()),clip=tree.find(node=>node.type==='Rect');
  assert.equal(clip.props.height,layout.waterEnd);
  assert.equal(tree.filter(node=>typeof node.type==='function'&&node.props.motion).length,5,'five native opacity buckets render the water paths');
  h.unmount();
});

function screenHarness(kind,{localized=false}={}) {
  const h = hooks(), save = deferred(), marks = [], alerts = [], navigation = [], targets = [], timer = clock(),toyRatings=[];
  let requests = 0, coolingDown = false, epoch = 1, rejectedCode='network_error',reserves=0,diskFails=false,synchronousProjection=()=>{};
  const params = { kind };
  let data = { profile: { id: 'me' }, roomPhotos: [], localDate: '2026-10-07', toyId: 'default',vase:{stable_id:'vase-1'} };
  const art = { bounds: [0, 0, 600, 600], width: 600, height: 600, source: 1 };
  const Screen = load('apps/mobile/app/(main)/room-interaction.tsx', {
    ...require('./rating-test-mocks.cjs'),
    '@/lib/use-page-back-gesture':{usePageBackGesture:()=>{}},
    '@/lib/use-page-entry-settled':{usePageEntrySettled:()=>true},
    '@/lib/toy-interaction-records':{recordToyInteraction(){},flushToyInteractions(){}},
    react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { ...native, ActivityIndicator: 'ActivityIndicator', KeyboardAvoidingView: 'KeyboardAvoidingView',
      TextInput: 'TextInput', Modal: 'Modal', Alert: { alert: (...args) => alerts.push(args) },
      Keyboard: {}, Platform: { OS: 'ios' }, TurboModuleRegistry: { get: () => localized?{}:null } },
    'expo-router': { Stack:{Screen:'ScreenOptions'},router: { canGoBack:()=>true, back() {navigation.push('back');}, push: path => navigation.push(path) }, useLocalSearchParams: () => params },
    '@expo/vector-icons': { Feather: 'Feather' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '@/lib/burrow-art-assets': { BURROW_ART: { couple_dolls: [art], vases: [art] }, burrowArtForItem: (item,category) => category==='vases'&&item?{...art,source:item.stable_id}:null },
    '@/lib/burrow-presentation': { roomSlots: () => ({ couple_doll: { stable_id: data.toyId },wallpaper:data.wallpaper,vase:data.vase,dresser_plant:{stable_id:'kettle-not-a-flower'} }) },
    '@/lib/app-major-update-api': {enqueueRoomCare:(_data,...args)=>{if(diskFails)throw Error('intent_not_saved');requests++;targets.push(args);synchronousProjection();}},
    '@/lib/room-care-model':{...load('apps/mobile/src/lib/room-care-model.ts'),currentRoomCare:()=>({version:2})},
    ...require('./burrow-attention-test-mocks.cjs'),
    '@/lib/official-rating-milestones':{recordPhotoToyPlayForRating:(user,toy,photo)=>{if(toy&&photo)toyRatings.push([user,toy,photo]);}},
    '@/lib/burrow-store': { useBurrow: () => ({ data, loading: false }),
      runBurrowAction: (_name,fn,options) => { requests++; fn('key'); return save.promise.then(ok=>{if(!ok)options.onError({body:{error:rejectedCode}});return ok;}); }, getBurrowSnapshot: () => ({ data,error: 'unrelated_error' }) },
    '@/lib/burrow-care-cooldown': { careCoolingDown: () => coolingDown,
      beginCareSubmission:()=>{reserves++;return()=>reserves--;},
      careCooldownMessage: which => which === 'food' ? 'Your bunny is happy now.' : 'Your flower is happy now.',
      markCareCompleted: (...args) => marks.push(args) },
    '@/lib/room-photo-errors': { TOY_PHOTO_DAILY_LIMIT_TITLE: 'Daily limit', TOY_PHOTO_DAILY_LIMIT_MESSAGE: 'Try tomorrow' },
    '@/lib/burrow-toy-photos': load('apps/mobile/src/lib/burrow-toy-photos.ts'),
    '@/components/burrow/burrow-back-button': { BurrowBackButton: 'BackButton' },
    '@/components/burrow/garden-care-interaction': { GardenCareInteraction: 'Garden' },
    '@/components/burrow/care-quest-celebration': { CareQuestCelebration: 'CarePopup' },
    '@/components/burrow/care-status-dialog': { CareStatusDialog: 'CareStatus' },
    '@/components/burrow/interactive-doll': { InteractiveDoll: 'Doll' },
    '@/components/burrow/localized-toy': { LocalizedToy: 'LocalizedToy' },
    '@/components/burrow/doll-photo-preview': { DollPhotoPreview: 'PhotoPreview' },
    '@/components/burrow/room-photo': {RoomPhotoEditor:'PhotoEditor'},
    '@/components/burrow/touch-note-entry': {TouchNoteEntry:'TouchNoteEntry'},
    '@/components/burrow/plushie-room-background': {PlushieRoomBackground:'PlushieRoomBackground'},
    '@/lib/burrow-text-drafts': { readBurrowTextDraft: () => null },
    '@/lib/session-lifecycle': { sessionEpoch: () => epoch },
  }, timer.globals);
  const render = () => h.render(Screen.default);
  render(); render();
  return { render, save, marks, alerts, navigation, targets, timer, params, art,toyRatings, get data(){return data;}, requests: () => requests,
    replaceVase(id){data={...data,vase:{stable_id:id}};},
    replaceToy(id){data={...data,toyId:id};},
    replaceWallpaper(id){data={...data,wallpaper:{stable_id:id}};},
    finish: () => nodes(render()).find(node => node.type==='Garden').props.onComplete(),failDisk(){diskFails=true;},
    onProjection(fn){synchronousProjection=fn;},
    coolDown() { coolingDown = true; }, rejectWith(code){rejectedCode=code;},reserves:()=>reserves,changeSession() { epoch++; }, unmount: h.unmount };
}

test('Toy review receives only a real saved photo after an actual own-Toy gesture, never just uploading/visiting',()=>{
 const h=screenHarness('toy');assert.equal(h.toyRatings.length,0);
 assert.equal(nodes(h.render()).some(n=>n.type==='Doll'),false,'empty dolls do not mount an interaction controller');
 h.data.roomPhotos=[{id:'face',ownerId:'me',kind:'doll',toyId:'default'}];
 h.render();assert.equal(h.toyRatings.length,0,'upload metadata alone is not an interaction');
 nodes(h.render()).find(n=>n.type==='Doll').props.onInteract();assert.deepEqual(h.toyRatings,[['me','default','face']]);h.unmount();
});
for(const localized of [false,true])test(`empty Plushie is a camera preview, not an interactive controller (${localized?'Skia':'native fallback'})`,()=>{
 const h=screenHarness('toy',{localized});let all=nodes(h.render());
 assert.equal(all.some(n=>['Doll','LocalizedToy'].includes(n.type)),false);
 const preview=all.find(n=>n.type==='PhotoPreview');assert.ok(preview);assert.equal(preview.props.photo,undefined);
 assert.equal(preview.props.label,'Add plushie photo');assert.equal(preview.props.onInteract,undefined);
 const stage=all.find(n=>n.props?.testID==='plushie-play-area');
 const copy=all.find(n=>n.props?.children==='Add your babe’s face and give them a squeeze.');
 const page=all.find(n=>Array.isArray(n.props?.children)&&n.props.children.includes(stage));
 assert.ok(page.props.children.indexOf(copy)>page.props.children.indexOf(stage),'copy sits below the character stage');
 assert.equal(copy.props.style.at(-1).color,'#FFFFFF');
 assert.equal(all.some(n=>String(n.props?.children).includes('Align face inside Plushie')),false);
 preview.props.onEditPhoto();all=nodes(h.render());assert.ok(all.some(n=>n.props?.children==='Choose how to add photos'));
 h.data.roomPhotos=[{id:'local-plushie-photo',ownerId:'me',kind:'doll',toyId:'default'}];all=nodes(h.render());
 const interactive=all.find(n=>n.type===(localized?'LocalizedToy':'Doll'));assert.ok(interactive,'locally saved photos enable play without a network wait');
 interactive.props.onInteract();assert.equal(h.toyRatings.length,1);
 h.data.roomPhotos=[];all=nodes(h.render());assert.equal(all.some(n=>['Doll','LocalizedToy'].includes(n.type)),false,'photo rollback locks the doll again');h.unmount();
});

test('changing equipped Plushie has no temporary flow banner or delayed stage resize',()=>{
 const h=screenHarness('toy');
 h.data.roomPhotos=[{id:'face-a',ownerId:'me',kind:'doll',toyId:'default'},{id:'face-b',ownerId:'me',kind:'doll',toyId:'other'}];
 let all=nodes(h.render());const stage=all.find(n=>n.props?.testID==='plushie-play-area');
 const stageStyle=Object.assign({},...stage.props.style.filter(Boolean));
 assert.equal(stageStyle.overflow,'visible');assert.equal(stageStyle.zIndex,1,'particle subtree paints above the preceding instruction text');
 stage.props.onLayout?.({nativeEvent:{layout:{height:480}}});all=nodes(h.render());
 const before=JSON.stringify(all.find(n=>n.type==='Doll').props.artStyle);
 h.replaceToy('other');h.render();all=nodes(h.render());
 assert.equal(all.some(n=>n.props?.accessibilityRole==='alert'||String(n.props?.children).includes('Toy updated in')),false);
 assert.equal(JSON.stringify(all.find(n=>n.type==='Doll').props.artStyle),before);
 h.timer.advance(3000);all=nodes(h.render());assert.equal(JSON.stringify(all.find(n=>n.type==='Doll').props.artStyle),before);h.unmount();
});

test('returning from a hidden purchased-Plushie page cannot retain a zero-height stage or shrink the new empty toy',()=>{
 const h=screenHarness('toy',{localized:true});
 h.data.roomPhotos=[{id:'face-a',ownerId:'me',kind:'doll',toyId:'default'}];
 let all=nodes(h.render()),stage=all.find(n=>n.props?.testID==='plushie-play-area');
 stage.props.onLayout?.({nativeEvent:{layout:{height:0,y:0}}});
 const page=all.find(n=>Array.isArray(n.props?.children)&&n.props.children.includes(stage));
 page.props.onLayout({nativeEvent:{layout:{height:0}}});
 h.replaceToy('new-purchased-toy');all=nodes(h.render());
 const preview=all.find(n=>n.type==='PhotoPreview');assert.ok(preview.props.style.width>=270,'zero hidden layout must not size the visible toy');
 const bg=all.find(n=>n.type==='PlushieRoomBackground');assert.ok(bg.props.floorY>200,'floor must not cover the whole wall');
 h.unmount();
});

test('Plushie backdrop follows the active room wallpaper and preserves the approved play-page floor seam independent of child layout',()=>{
 const h=screenHarness('toy');h.replaceWallpaper('paper-A');h.data.roomPhotos=[{id:'face',ownerId:'me',kind:'doll',toyId:'default'}];
 let all=nodes(h.render());let bg=all.find(n=>n.type==='PlushieRoomBackground');assert.equal(bg.props.wallpaper.stable_id,'paper-A');
 const stage=all.find(n=>n.props?.testID==='plushie-play-area');stage.props.onLayout?.({nativeEvent:{layout:{height:540,y:70}}});
 bg=all.find(n=>n.type==='PlushieRoomBackground');
 assert.ok(Math.abs(bg.props.floorY-(844-68)*.56)<1e-8);
 h.replaceWallpaper('paper-B');all=nodes(h.render());assert.equal(all.find(n=>n.type==='PlushieRoomBackground').props.wallpaper.stable_id,'paper-B');
 h.unmount();
});
test('Plushie creation and play use the brown/white header, soft copy, yellow photo action and correct room perspective',()=>{
 for(const partner of [false,true]){
  const h=screenHarness('toy');h.data.partner={id:'partner',display_name:' Alex '};
  if(partner)Object.assign(h.params,{ownerId:'partner',actorId:'me'});
  let all=nodes(h.render());
  const title=all.find(n=>n.props?.children==='Make a Plushie');assert.equal(title.props.style.at(-1).color,'#FFFFFF');
  assert.ok(all.some(n=>n.type==='BackButton'&&n.props.light===true));
  assert.ok(all.some(n=>n.type==='Feather'&&n.props.name===(partner?'clock':'more-vertical')&&n.props.color==='#FFFFFF'));
  const copy=all.find(n=>n.props?.children===(partner?'Add your face so Alex can give you a squeeze.':'Add your babe’s face and give them a squeeze.'));
  assert.equal(copy.props.style[0].fontWeight,'400');assert.equal(copy.props.style[0].fontSize,16);
  assert.equal(copy.props.style[1].color,'#FFFFFF');
  assert.equal(all.some(n=>n.props?.children==='Align face inside Plushie.'),false);
  const addComponent=all.find(n=>typeof n.type==='function'&&n.props?.label==='Add Photo'),add=addComponent.type(addComponent.props);
  assert.equal(add.props.style({pressed:false})[0].backgroundColor,'#FFD36F');
  h.data.roomPhotos=[{id:'face',ownerId:partner?'partner':'me',kind:'doll',toyId:'default'}];all=nodes(h.render());
  assert.ok(all.some(n=>n.props?.children===(partner?'Alex’s Plushie':'Your Plushie')));
  assert.equal(all.some(n=>n.props?.children==='Touch to rub · Drag to pull'),false,'approved default page has no extra gesture banner');
  assert.equal(all.some(n=>n.props?.accessibilityLabel==='显示影响范围'),false);h.unmount();
 }
});

test('own watering and partner fertilizer use their distinct reference artwork, unaffected by decoration replacement',()=>{
  for(const partner of [false,true]){
    const h=screenHarness('water');
    if(partner){h.data.partner={id:'partner',display_name:'Irina'};Object.assign(h.params,{ownerId:'partner',actorId:'me'});h.render();h.render();}
    assert.equal(nodes(h.render()).find(node=>node.type==='Garden').props.action,partner?'fertilizer':'water');
    assert.equal(nodes(h.render()).find(node=>node.type==='Garden').props.flower.source,'vase-1');
    h.replaceVase('replacement-flower');
    assert.equal(nodes(h.render()).find(node=>node.type==='Garden').props.action,partner?'fertilizer':'water');
    assert.equal(nodes(h.render()).find(node=>node.type==='Garden').props.flower.source,'replacement-flower','equipped flower updates without resetting the action');
    assert.ok(nodes(h.render()).some(node=>node.props?.children===(partner?"Fertilize Irina's flower":'Water your flower')));
    h.unmount();
  }
});

test('care headings distinguish my room from the partner target and use the partner display name',()=>{
  for(const kind of ['food','water'])for(const partner of [false,true]){
    const h=screenHarness(kind);
    h.data.partner={id:'partner',display_name:'  Alex  '};
    if(partner)Object.assign(h.params,{ownerId:'partner',actorId:'me'});
    h.render();h.render();
    const expected=kind==='food'?(partner?"Feed Alex's bunny some greens":'Feed your bunny'):(partner?"Fertilize Alex's flower":'Water your flower');
    assert.ok(nodes(h.render()).some(node=>node.props?.children===expected));
    h.unmount();
  }
});

test('Plushie menu offers Collection separately from Change Photo, including after daily photo quota', () => {
  const h = screenHarness('toy');
  const press = label => {
    const node = nodes(h.render()).find(node => node.props?.accessibilityLabel === label);
    assert.ok(node, label); node.props.onPress();
  };
  press('Plushie menu'); press('Plushies Collection');
  assert.deepEqual(h.navigation, ['/(main)/toy-collection']);
  assert.equal(nodes(h.render()).some(node => node.props?.accessibilityLabel === 'Change Photo'), false);
  press('Plushie menu'); press('Change Photo');
  assert.equal(nodes(h.render()).find(node => node.type === 'Modal').props.visible, true);
  h.data.dollPhotoChangesUsed = ['default'];
  press('Plushie menu'); press('Change Photo');
  assert.deepEqual(h.alerts, [['Daily limit', 'Try tomorrow']]);
  press('Plushie menu'); press('Plushies Collection');
  assert.equal(h.navigation.length, 2); h.unmount();
});
test('Toy interaction keeps one original-canvas scale, without per-costume width or height fitting',()=>{
 const h=screenHarness('toy');let baseline;
 for(const bounds of [[100,10,500,600],[30,10,570,600],[230,160,370,570]]){
  h.art.bounds=bounds;const doll=nodes(h.render()).find(n=>n.type==='PhotoPreview');
  const style=JSON.parse(JSON.stringify(doll.props.artStyle));baseline??=style;assert.deepEqual(style,baseline);
  assert.equal(style.width,style.height);assert.equal(style.left,0);assert.equal(style.top,0);
 }
 h.unmount();
});

test('Plushie stage fills the space between copy and footer, clamps on small screens, and does not set native screen status-bar options',()=>{
 const h=screenHarness('toy');
 const all=()=>nodes(h.render());
 assert.equal(all().some(n=>n.type==='ScreenOptions'),false);
 const initial=all(),area=initial.find(n=>n.props?.testID==='plushie-play-area');
 const style=Object.assign({},...area.props.style.filter(Boolean));
 assert.equal(style.flexGrow,1);assert.equal(style.minHeight,0);
 const page=initial.find(n=>Array.isArray(n.props?.children)&&n.props.children.includes(area));
 page.props.onLayout({nativeEvent:{layout:{height:530}}});
 let doll=all().find(n=>n.type==='PhotoPreview');assert.ok(doll,'empty toys use a static camera preview');
 assert.ok(doll.props.style.height<=400);
 h.data.roomPhotos=[{id:'face',ownerId:'me',kind:'doll',toyId:'default'}];
 doll=all().find(n=>n.type==='Doll');assert.equal(doll.props.showActions,true);
 assert.equal(doll.props.style.height,Math.min(390*.94,(844-68)*.43,420),'approved play-page size does not inherit the creation stage height');
 assert.equal(doll.props.containerStyle.height,(844-68)*.73);
 h.unmount();
});


for (const kind of ['food', 'water']) for (const partner of [false,true]) {
  test(`${kind}: ${partner?'partner':'own'} room Done exits immediately while save continues after unmount`, async () => {
    const h = screenHarness(kind);
    if(partner){h.data.partner={id:'partner',display_name:'Irina'};Object.assign(h.params,{ownerId:'partner',actorId:'me'});h.render();h.render();}
    h.finish(); h.finish();
    const popup = nodes(h.render()).find(node => node.type === 'CarePopup' && node.props.visible !== false);
    assert.ok(popup); assert.equal(popup.props.title, kind === 'food' ? 'Yum!' : 'Ahh!');
    assert.equal(popup.props.message,`${partner?"Irina's":'Your'} ${kind==='food'?'bunny is full and happy.':'flower is fresh and growing.'}`);
    assert.equal(popup.props.icon,kind==='water'?'heart':undefined,'watering alone switches to a heart; feeding keeps its existing icon');
    assert.equal(h.requests(), 1); assert.equal(h.marks.length, 0);
    popup.props.onClose();popup.props.onClose();
    assert.deepEqual(h.navigation,['back']);
    assert.equal(nodes(h.render()).some(node=>node.type==='CarePopup'&&node.props.visible!==false),false);
    h.unmount();
    h.save.resolve(true); await flush();
    assert.deepEqual(h.marks, [],'the shared settled observer, not an unmounted page, owns confirmed cooldown');assert.deepEqual(h.navigation,['back']);
  });
}

test('watering completion shares the feeding card layout, with the requested heart and title/body typography',()=>{
 for(const kind of ['food','water']){
  const h=hooks(),back=[],title=kind==='water'?'Ahh!':'Yum!',message=kind==='water'?'Your flower is fresh and growing.':'Your bunny is full and happy.';
  let closed=0,removed=0;
  const {CareQuestCelebration}=load('apps/mobile/src/components/burrow/care-quest-celebration.tsx',{
   react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},
   '@/lib/care-confetti-motion':load('apps/mobile/src/lib/care-confetti-motion.ts'),
   'react-native':{...native,...require('./motion-test-utils.cjs').careConfettiHarness(),AppState:{addEventListener:()=>({remove(){}})},BackHandler:{addEventListener:(_name,fn)=>{back.push(fn);return{remove:()=>removed++};}}},
   'react-native-reanimated':{...require('./motion-test-utils.cjs').motionHarness(h).reanimated,withSpring:value=>value},
  });
  const tree=nodes(h.render(()=>CareQuestCelebration({title,message,icon:kind==='water'?'heart':undefined,onClose:()=>closed++})));
  assert.equal(tree.find(n=>n.props?.children===(kind==='water'?'❤️':'🎉')).props.style.fontSize,48);
  const heading=tree.find(n=>n.props?.children===title),body=tree.find(n=>n.props?.children===message);
  assert.equal(heading.props.style.fontSize,22);assert.equal(body.props.style.fontSize,15);
  assert.equal(heading.props.style.textAlign,'center');assert.equal(body.props.style.textAlign,'center');
  tree.find(n=>n.type==='Pressable').props.onPress();assert.equal(closed,1);
  assert.equal(back[0](),true);assert.equal(closed,2);h.unmount();assert.equal(removed,1);
 }
});

test('failed durable care save cannot display success or coins, restores retry, and does not start cooldown', async () => {
  const h = screenHarness('food'); h.failDisk();h.finish();
  const tree = nodes(h.render());
  assert.equal(tree.some(node => node.type === 'CarePopup' && node.props.visible !== false), false);
  assert.equal(tree.find(node => node.type === 'Garden').props.complete, false);
  assert.ok(tree.some(node => node.props?.children === 'Could not save on this device. Please hold to try again.'));
  assert.equal(h.marks.length, 0); h.unmount();
});
for(const kind of ['food','water'])for(const partner of [false,true])test(`${kind}: ${partner?'partner':'own'} synchronous reward projection cannot replace the finishing artwork with a cooldown page`,()=>{
 const h=screenHarness(kind);if(partner){h.data.partner={id:'partner',display_name:'Irina'};Object.assign(h.params,{ownerId:'partner',actorId:'me'});h.render();h.render();}
 h.onProjection(()=>{h.coolDown();const during=nodes(h.render());assert.ok(during.some(n=>n.type==='Garden'));
  assert.equal(during.some(n=>n.type==='CareStatus'),false);assert.equal(during.find(n=>n.type==='CarePopup').props.visible,false,'no completion before enqueue returns');});
 h.finish();const after=nodes(h.render());assert.equal(after.find(n=>n.type==='CarePopup').props.visible,true);assert.equal(h.requests(),1);h.unmount();
});

for(const kind of ['food','water'])test(`${kind}: another device's refreshed cooldown at the final frame presents status instead of submitting again`,async()=>{
 const h=screenHarness(kind),complete=nodes(h.render()).find(n=>n.type==='Garden').props.onComplete;h.coolDown();complete();await flush();
 assert.equal(h.requests(),0);assert.equal(h.reserves(),0);const status=nodes(h.render()).find(n=>n.type==='CareStatus');assert.ok(status);
 assert.equal(h.marks.length,0);status.props.onClose();status.props.onClose();assert.deepEqual(h.navigation,['back']);h.unmount();
});

test('existing cooldown does not show a speculative success or submit another care action', () => {
  const h = screenHarness('water'); h.coolDown();h.render();
  assert.equal(h.requests(), 0); assert.equal(h.alerts.length, 0);
  const popup = nodes(h.render()).find(node => node.type === 'CareStatus');
  assert.equal(popup.props.kind, 'water'); popup.props.onClose();
  assert.equal(nodes(h.render()).some(node => node.type === 'CareStatus'), false);
  assert.deepEqual(h.navigation,['back'],'a full direct/deep-link entry exits instead of reopening the care gesture');
  assert.equal(nodes(h.render()).some(node => node.type === 'CarePopup' && node.props.visible !== false), false); h.unmount();
});

test('late care failure cannot dismiss a success popup on a different interaction screen', async () => {
  const h = screenHarness('food'); h.finish();
  h.params.kind = 'water'; h.render(); h.render();
  h.save.resolve(false); await flush();
  const tree = nodes(h.render());
  assert.equal(tree.find(node => node.type === 'Garden').props.complete, false);
  assert.equal(tree.some(node => node.props?.accessibilityRole === 'alert'), false); h.unmount();
});
for(const kind of ['food','water'])test(`${kind}: partner care submits the partner owner and keeps the current instant celebration`,async()=>{
  const h=screenHarness(kind);
  h.data.partner={id:'partner',display_name:'Irina'};
  Object.assign(h.params,{ownerId:'partner',actorId:'me'});
  h.render();h.render();h.finish();
  assert.deepEqual(h.targets,[['partner',kind]]);
  assert.ok(nodes(h.render()).some(node=>node.type==='CarePopup'&&node.props.visible!==false));
  assert.match(nodes(h.render()).find(node=>node.type==='CarePopup'&&node.props.visible!==false).props.message,/Irina's (bunny|flower)/);
  h.save.resolve(true);await flush();
  assert.deepEqual(h.marks,[],'the page never marks an unverified completion');
  const popup=nodes(h.render()).find(node=>node.type==='CarePopup'&&node.props.visible!==false);
  popup.props.onClose();popup.props.onClose();
  assert.deepEqual(h.navigation,['back']);h.unmount();
});
for(const kind of ['food','water'])for(const partner of [false,true])test(`${kind}: ${partner?'partner':'own'} room exits on Done after a confirmed save, not automatically`,async()=>{
  const h=screenHarness(kind);
  if(partner){h.data.partner={id:'partner',display_name:'Irina'};Object.assign(h.params,{ownerId:'partner',actorId:'me'});h.render();h.render();}
  h.finish();h.save.resolve(true);await flush();
  assert.equal(h.navigation.length,0);
  const popup=nodes(h.render()).find(n=>n.type==='CarePopup');assert.ok(popup);
  popup.props.onClose();popup.props.onClose();assert.deepEqual(h.navigation,['back']);h.unmount();
});
test('Done exits immediately even if the background save later fails, without another navigation or popup',async()=>{
  const h=screenHarness('water');h.finish();nodes(h.render()).find(n=>n.type==='CarePopup').props.onClose();
  assert.deepEqual(h.navigation,['back']);h.unmount();
  h.save.resolve(false);await flush();
  assert.deepEqual(h.navigation,['back']);assert.equal(h.marks.length,0);assert.equal(h.alerts.length,0);
});
test('a pending Done never navigates again after changing interaction scope or unmounting',async()=>{
  for(const unmount of [false,true]){
    const h=screenHarness('food');h.finish();nodes(h.render()).find(n=>n.type==='CarePopup').props.onClose();
    if(unmount)h.unmount();else{h.params.kind='water';h.render();h.render();}
    h.save.resolve(true);await flush();assert.deepEqual(h.navigation,['back']);h.unmount();
  }
});
test('a background care completion cannot mark cooldowns after an account or pair change',async()=>{
  for(const account of [false,true]){
    const h=screenHarness('food');h.data.partner={id:'partner',display_name:'Irina'};
    Object.assign(h.params,{ownerId:'partner',actorId:'me'});h.render();h.render();h.finish();
    nodes(h.render()).find(n=>n.type==='CarePopup').props.onClose();h.unmount();
    if(account)h.changeSession();else h.data.partner=null;
    h.save.resolve(true);await flush();assert.equal(h.marks.length,0);assert.deepEqual(h.navigation,['back']);
  }
});
test('unpaired, foreign-owner and stale-account routes never fall back to caring for myself',()=>{
  for(const extra of [{ownerId:'foreign',actorId:'me'},{ownerId:'partner',actorId:'old'},{ownerId:'partner',actorId:'me'}]){
    const h=screenHarness('food');
    Object.assign(h.params,extra);h.render();h.render();
    assert.equal(nodes(h.render()).some(node=>node.type==='Garden'),false);
    assert.equal(h.requests(),0);h.unmount();
  }
});
test('unpairing while partner care saves cannot publish a late cooldown or success into another room',async()=>{
  const h=screenHarness('food');h.data.partner={id:'partner',display_name:'Irina'};
  Object.assign(h.params,{ownerId:'partner',actorId:'me'});h.render();h.render();h.finish();
  h.data.partner=null;h.render();h.render();h.save.resolve(true);await flush();
  assert.equal(h.marks.length,0);assert.equal(nodes(h.render()).some(node=>node.type==='CarePopup'&&node.props.visible!==false),false);h.unmount();
});
test('partner toy shares camera/upload flow but exposes no play, deformation or Collection controls',()=>{
 for(const source of ['camera','library']){
  const h=screenHarness('toy');h.data.partner={id:'partner',display_name:'Irina'};h.data.pairVersion='one';
  h.data.roomPhotos=[{id:'partner-face',ownerId:'partner',kind:'doll',toyId:'default'},{id:'mine',ownerId:'me',kind:'doll',toyId:'default'}];
  Object.assign(h.params,{ownerId:'partner',actorId:'me',pairVersion:'one'});h.render();h.render();
  const tree=nodes(h.render()),preview=tree.find(n=>n.type==='PhotoPreview');
  assert.equal(preview.props.photo.id,'partner-face');assert.equal(tree.some(n=>n.type==='Doll'),false);
  assert.equal(tree.some(n=>n.props?.children==='✋  Squeeze'||n.props?.children==='✊  Punch'),false);
  preview.props.onEditPhoto();
  const label=source==='camera'?'Take Photo':'Upload Photo';
  const pick=nodes(h.render()).find(n=>n.type==='Pressable'&&nodes(n.props.children).some(child=>child.props?.children===label));assert.ok(pick,label);
  pick.props.onPress();h.timer.advance(320);
  const editor=nodes(h.render()).find(n=>n.type==='PhotoEditor');assert.equal(editor.props.ownerId,'partner');assert.equal(editor.props.initialSource,source);
  h.params.pairVersion='old';h.render();h.render();assert.equal(nodes(h.render()).some(n=>n.type==='PhotoEditor'),false);
  assert.equal(h.requests(),0);h.unmount();
 }
});
