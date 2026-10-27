const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {load,hooks}=require('./lifecycle-test-utils.cjs');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const jsx=(type,props)=>({type,props});
const nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.props?.children)]:[];
test('Friends Room omits its header wallet without removing the shared coin-shop action from spending pages',()=>{
 const source=read('apps/mobile/src/components/burrow/burrow-screen.tsx');
 assert.match(source,/data&&section!=='friends_room'&&<CoinWallet balance=\{data.wallet.balance\}/);
 assert.match(source,/onPress=\{\(\)=>openBurrow\('carrot_shop'\)\}/);
 assert.match(source,/if\(section==='collection'\)return <CollectionRoomScreen/);
});
test('Affection selection and sending share the supplied send artwork',()=>{
 for(const name of ['affection-hub','affection-detail-screen']){
  const source=read(`apps/mobile/src/components/burrow/${name}.tsx`);
  assert.match(source,/source=\{BURROW_BACKGROUNDS.affectionSend\}/);
  assert.doesNotMatch(source,/BURROW_BACKGROUNDS.affectionSelect/);
 }
});
test('Moments delegates both people’s initial and uploaded avatars to the shared avatar component',()=>{
 const assets=Object.fromEntries(Array.from({length:10},(_,i)=>[`../../assets/profile/default-${i+1}.webp`,i+1]));
 const avatar=load('apps/mobile/src/lib/avatar.ts',assets);
 const parent=hooks();let active=parent;
 const model=load('apps/mobile/src/lib/burrow-moments-model.ts');
 const module=load('apps/mobile/src/components/burrow/moments-timeline.tsx',{
  '@/lib/moments-cache':{momentsCache:{subscribe(){return()=>{};},read(){return{page:null,loading:false,refreshing:false,error:false};}}},
    "./burrow-back-button":{BackIcon:'BackIcon',BurrowBackButton:'BackButton'},
  react:Object.fromEntries(Object.keys(parent.react).map(key=>[key,(...args)=>active.react[key](...args)])),
  'react/jsx-runtime':{jsx,jsxs:jsx},
  'react-native':{AppState:{addEventListener:()=>({remove(){}})},Pressable:'Pressable',RefreshControl:'Refresh',SectionList:'List',Text:'Text',View:'View',StyleSheet:{create:x=>x,absoluteFillObject:{}}},
  './burrow-image':{Image:'Image'},'@/components/ui/user-avatar':{UserAvatar:'UserAvatar'},'@expo/vector-icons':{Feather:'Icon'},
  'expo-router':{router:{}},'@react-navigation/native':{useIsFocused:()=>false},
  'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:59,bottom:34})},
  '@/lib/burrow-art-assets':{BURROW_BACKGROUNDS:{common:1}},
  '@/lib/burrow-history':{historyDayLabel:()=>'',mergeHistory:(a,b)=>[...a,...b]},
  '@/lib/burrow-moments-model':model,'@/lib/burrow-ui-assets':{BURROW_MOMENT_ICONS:{water:1}},
  ...require('./burrow-attention-test-mocks.cjs'),
  '@/lib/item-images.g':{ITEM_IMAGES:{}},'@/lib/tap-day-images.g':{TAP_DAY_IMAGES:{}},'@/lib/session-lifecycle':{sessionEpoch:()=>1},'@/lib/avatar':avatar,
 });
 const data={profile:{id:'me',avatar_url:'default-4'},partner:{id:'alex',avatar_url:'default-8'},moments:[],localDate:'2026-10-09'};
 const tree=parent.render(()=>module.MomentsTimeline({data})),list=nodes(tree).find(node=>node.type==='List');
 function avatarElement(actor,person){
  const row={id:actor,actor_id:actor,event_type:'room_need_refilled',payload:{need:'water'},created_at:'2026-10-09T12:00:00Z'};
  const card=nodes(list.props.renderItem({item:row})).find(node=>typeof node.type==='function');
  const portrait=nodes(card.type(card.props)).find(node=>node.type?.name==='MomentAvatar');
  return {...portrait,props:{...portrait.props,person:person??portrait.props.person}};
 }
 for(const [actor,expected] of [['me','default-4'],['alex','default-8']]){
  const child=hooks();active=child;const element=avatarElement(actor);
  const portrait=child.render(()=>element.type(element.props));
  assert.equal(portrait.type,'UserAvatar');assert.equal(portrait.props.avatarUrl,expected);assert.equal(portrait.props.userId,actor);child.unmount();
 }
 const child=hooks();active=child;let element=avatarElement('alex',{id:'alex',avatar_url:'https://test/face.jpg'});
 let image=child.render(()=>element.type(element.props));assert.equal(image.props.avatarUrl,'https://test/face.jpg');
 element=avatarElement('alex',{id:'alex',avatar_url:'https://test/new.jpg'});
 assert.equal(child.render(()=>element.type(element.props)).props.avatarUrl,'https://test/new.jpg');
 child.unmount();parent.unmount();
});
