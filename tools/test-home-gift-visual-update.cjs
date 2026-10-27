const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const {load,hooks}=require('./lifecycle-test-utils.cjs');
const presentation=load('apps/mobile/src/lib/burrow-presentation.ts',{'@novame/engine':{}});

// Execute the real Home useMemo expression, not a copy of its dependencies.
function homeMemo(){
  const source=fs.readFileSync('apps/mobile/src/components/burrow/burrow-screen.tsx','utf8');
  const ast=ts.createSourceFile('burrow-screen.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let expression;
  const visit=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='homeDesign')expression=node.initializer.getText(ast);ts.forEachChild(node,visit);};
  visit(ast);assert.ok(expression);
  return vm.runInNewContext(`(data,section,useMemo)=>(${expression})`);
}
for(const paired of [false,true])test(`${paired?'paired':'solo'} shelf selection invalidates retained Home preparation without restart or focus change`,async()=>{
  const h=hooks(),select=homeMemo(),resident=new Set(),decoded=[];
  const gift=id=>({stable_id:id,title:id,item_type:'souvenir',metadata:{},tags:['adventure_v2_gift']});
  const a=gift('gift-a'),b=gift('gift-b');
  let data={profile:{id:'me'},partner:paired?{id:'partner'}:null,pairVersion:paired?'pair-1':null,
    catalog:[a,b],loadouts:[],roomPhotos:[],adventureCollection:{displays:[{user_id:'me',gift_id:a.stable_id}]}};
  const art={floor:1,day:2,night:3,letter:4};
  const api=load('apps/mobile/src/lib/home-art-preparation.ts',{
    'react-native':{Platform:{OS:'web'},TurboModuleRegistry:{get:()=>null}},
    './burrow-art-assets':{HOME_BACKGROUND_FLOOR:{source:art.floor},BURROW_FIXED_ART:{letter:{source:art.letter}},
      burrowArtFor:()=>({source:art.day,nightSource:art.night}),burrowArtForItem:item=>item?{source:item.stable_id}:null},
    './burrow-home-layout':{HOME_ART_PLACEMENTS:[{slot:'shelf_decor',category:'shelf_decor'}]},'./burrow-presentation':presentation,
    './burrow-map-model':{burrowMapEnvironment:()=>({season:'autumn'})},'./use-burrow-storefront':{countryForVisit:()=> 'US'},
    './burrow-outfit-assets':{OUTFIT_LAYERS:{default:{}},outfitKey:()=> 'default'},
    './prepared-burrow-images':{preparedImageKey:String,preparedBurrowImage:source=>resident.has(source)?{}:undefined,
      prepareBurrowImages:async sources=>{decoded.push([...sources]);sources.forEach(source=>resident.add(source));},retainHomeImages(){}},
    './burrow-room-photo-cache':{loadRoomPhoto:async()=>{throw Error('no photo');}},'./coin-ui-asset':{COIN_UI_ASSET:5},
    './burrow-environment-state':{prepareBurrowEnvironment:async()=>{},refreshBurrowEnvironment:async()=>{}},
  });
  const render=()=>h.render(()=>select(data,'home',h.react.useMemo));
  const previous=render();await api.prepareHomeArt(previous);assert.equal(api.isHomeArtPrepared(previous),true);
  data={...data,adventureCollection:{...data.adventureCollection,displays:[{user_id:'me',gift_id:b.stable_id}]}};
  const next=render();assert.equal(next,data);assert.notEqual(next,previous);
  assert.equal(presentation.roomSlots(next,'me').shelf_decor,b);
  assert.equal(api.isHomeArtPrepared(next),false,'new gift needs its own decode, not the old prepared Home');
  await api.prepareHomeArt(next);assert.equal(api.isHomeArtPrepared(next),true);
  assert.ok(decoded.some(sources=>sources.includes(b.stable_id)));
  const before=render();data={...data,moments:[{id:'new'}]};assert.equal(render(),before,'unrelated feed updates do not rebuild the room');
  h.unmount();
});

test('Photo Frame hides the daily-remaining caption but keeps daily allowance enforcement and actions',()=>{
  const h=hooks(),jsx=(type,props)=>({type,props});
  const {PhotoFrameSheet}=load('apps/mobile/src/components/burrow/photo-frame-sheet.tsx',{
    'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{Modal:'Modal',Pressable:'Button',Text:'Text',View:'View',StyleSheet:{create:x=>x,absoluteFillObject:{}},useWindowDimensions:()=>({height:844})},
    '@expo/vector-icons':{Feather:'Icon'},'./room-photo':{RoomPhoto:'Photo'},'@/lib/room-photo-crop':{FRAME_PHOTO_ASPECT:1},
  });
  const nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.props?.children)]:[];
  for(const remaining of [0,1,5]){
    const tree=nodes(PhotoFrameSheet({remaining,limit:remaining===5?5:1,onClose(){},onChoose(){},onHistory(){}}));
    assert.equal(tree.some(n=>n.type==='Text'&&JSON.stringify(n.props.children).includes('updates left today')),false);
    const choose=tree.find(n=>n.type==='Button'&&n.props.disabled!==undefined);assert.equal(choose.props.disabled,remaining===0);
    assert.ok(tree.some(n=>n.props?.children==='History'));
  }
  h.unmount();
});
