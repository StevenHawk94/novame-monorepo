const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load,hooks}=require('./lifecycle-test-utils.cjs');
const avatar=load('apps/mobile/src/lib/avatar.ts');
test('initials replace every legacy portrait; genuine uploads remain eligible even in older snapshots without the flag',()=>{
 for(let i=1;i<=10;i++){assert.equal(avatar.uploadedAvatarUri(`default-${i}`,true),null);assert.equal(avatar.uploadedAvatarUri(`default-${i}`,false),null);}
 assert.equal(avatar.uploadedAvatarUri(null,true),null);
 assert.equal(avatar.uploadedAvatarUri('https://example.test/photo.jpg',false),'https://example.test/photo.jpg');
 assert.equal(avatar.uploadedAvatarUri('https://example.test/photo.jpg',undefined),'https://example.test/photo.jpg');
 assert.equal(avatar.uploadedAvatarUri('https://example.test/old-default.jpg',true),null);
 assert.equal(avatar.initialAvatar('a','  Alice ').initial,'A');assert.equal(avatar.initialAvatar('b','李明').initial,'李');
 assert.equal(avatar.initialAvatar('c','e\u0301lise').initial,'É');assert.equal(avatar.initialAvatar('d','').initial,'?');
 assert.doesNotMatch(fs.readFileSync('apps/mobile/src/lib/avatar.ts','utf8'),/require\(|assets\/profile/);
});
test('all pair color collisions resolve consistently on both devices without randomization or extra requests',()=>{
 for(let a=0;a<100;a++)for(let b=a+1;b<100;b++){
  const idA=`user-${a}`,idB=`user-${b}`;
  const mine=avatar.initialAvatar(idA,'A',idB),theirs=avatar.initialAvatar(idB,'B',idA);
  assert.notEqual(mine.backgroundColor,theirs.backgroundColor);
  avatar.configureAvatarPair({id:idA,display_name:'Alice'},{id:idB,display_name:'Bob'});
  assert.equal(avatar.initialAvatar(idA).backgroundColor,mine.backgroundColor);
  avatar.configureAvatarPair({id:idB,display_name:'Bob'},{id:idA,display_name:'Alice'});
  assert.equal(avatar.initialAvatar(idA).backgroundColor,mine.backgroundColor);
 }
 avatar.configureAvatarPair(null);assert.equal(avatar.initialAvatar('user-1').initial,'?');
});
test('uploaded photo failure falls back to native initial; switching photo retries; no bundled asset is requested',()=>{
 const h=hooks(),jsx=(type,props)=>({type,props}),{UserAvatar}=load('apps/mobile/src/components/ui/user-avatar.tsx',{
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{View:'View',Text:'Text'},'expo-image':{Image:'Image'},'@/lib/avatar':avatar,
 });
 let url='https://example.test/a.jpg';const render=()=>h.render(()=>UserAvatar({userId:'a',name:'Alice',avatarUrl:url,isDefaultAvatar:false}));
 let tree=render();assert.equal(tree.props.children.type,'Image');tree.props.children.props.onError();tree=render();
 assert.equal(tree.props.children.type,'Text');assert.equal(tree.props.children.props.children,'A');
 url='https://example.test/b.jpg';render();tree=render();assert.equal(tree.props.children.type,'Image');h.unmount();
});
test('one shared role palette is identical at Menu, Affection, Game and Moments sizes, from either account',()=>{
 const jsx=(type,props)=>({type,props});
 for(const [self,other]of [['a','b'],['b','a']]){
  avatar.configureAvatarPair({id:self,display_name:self==='a'?'Alice':'Bob'},{id:other,display_name:other==='a'?'Alice':'Bob'});
  avatar.configureAvatarPairRole(self,other,'a');
  for(const size of [38,48,52,72,77])for(const userId of [self,other]){
   const h=hooks(),{UserAvatar}=load('apps/mobile/src/components/ui/user-avatar.tsx',{
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{View:'View',Text:'Text'},'expo-image':{Image:'Image'},'@/lib/avatar':avatar,
   });
   const tree=h.render(()=>UserAvatar({userId,otherUserId:userId===self?other:self,name:userId==='a'?'Alice':'Bob',avatarUrl:'default-1',isDefaultAvatar:true,size}));
   assert.equal(tree.props.style[0].backgroundColor,userId==='a'?'#FFC547':'#83513E');assert.equal(tree.props.children.type,'Text');assert.equal(tree.props.children.props.children,userId==='a'?'A':'B');h.unmount();
  }
 }
 avatar.configureAvatarPair(null);
});
test('shared palette updates retained avatars, survives same-pair bootstrap refresh and rejects another pair role',()=>{
 avatar.configureAvatarPair({id:'a'},{id:'b'});let calls=0;const stop=avatar.subscribeAvatarIdentity(()=>calls++);
 avatar.configureAvatarPairRole('a','b','a');assert.equal(calls,1);const rev=avatar.avatarIdentityRevision();
 avatar.configureAvatarPair({id:'a'},{id:'b'});avatar.configureAvatarPairRole('a','b','a');assert.equal(avatar.avatarIdentityRevision(),rev);
 avatar.configureAvatarPairRole('other','b','b');assert.equal(avatar.initialAvatar('a','Alice').backgroundColor,'#FFC547');
 avatar.configureAvatarPair({id:'a'},{id:'c'});avatar.configureAvatarPairRole('a','b','a');assert.notEqual(avatar.initialAvatar('a','Alice').backgroundColor,'#FFC547');
 avatar.configureAvatarPair(null);stop();
});
test('uploaded and locally cached photos win over default initials consistently at every size',()=>{
 const jsx=(type,props)=>({type,props});avatar.configureAvatarPair({id:'a'},{id:'b'});avatar.configureAvatarPairRole('a','b','a');
 for(const size of [38,48,52,72,77])for(const local of [null,'file:///local/latest.jpg']){
  const h=hooks(),{UserAvatar}=load('apps/mobile/src/components/ui/user-avatar.tsx',{
   react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{View:'View',Text:'Text'},'expo-image':{Image:'Image'},'@/lib/avatar':avatar,
   '@/lib/profile-avatar-local':{localProfileAvatarUri:()=>local,subscribeLocalProfileAvatar:()=>()=>{}},
  });
  const tree=h.render(()=>UserAvatar({userId:'a',name:'Alice',otherUserId:'b',avatarUrl:'https://example.test/latest.jpg',isDefaultAvatar:false,size}));
  assert.equal(tree.props.children.type,'Image');assert.equal(tree.props.children.props.source.uri,local??'https://example.test/latest.jpg');h.unmount();
 }
 avatar.configureAvatarPair(null);
 const menu=fs.readFileSync('apps/mobile/app/(main)/(modals)/me.tsx','utf8');assert.doesNotMatch(menu,/fallbackBackgroundColor|fallbackTextColor/);
 const affection=fs.readFileSync('apps/mobile/src/components/burrow/affection-delivery.tsx','utf8');assert.match(affection,/isDefaultAvatar=\{person\?\.is_default_avatar\}/);
 const game=fs.readFileSync('apps/mobile/src/components/burrow/game-room-screen.tsx','utf8'),moments=fs.readFileSync('apps/mobile/src/components/burrow/moments-timeline.tsx','utf8');
 for(const source of [game,moments]){assert.match(source,/UserAvatar/);assert.match(source,/isDefaultAvatar=\{person\?\.is_default_avatar\}/);}
});
test('the foreground gate hydrates cached role metadata and propagates pairing-status updates without an extra read',()=>{
 const h=hooks(),listeners=new Set();let data={profile:{id:'a'},partner:{id:'b'},pairVersion:'v1'},cached={paired:true,partner:{userId:'b'},initiatorId:'a'},reads=0;
 avatar.configureAvatarPair(data.profile,data.partner);
 const gate=load('apps/mobile/src/components/burrow/burrow-sync-gate.tsx',{
  react:{...h.react,useEffect(){},useMemo:()=>''},'react-native':{AppState:{}},
  '@/lib/supabase':{},'@/lib/use-major-update':{useMajorUpdateEnabled:()=>true},'@/lib/burrow-sync-controller':{},
  '@/lib/burrow-store':{useBurrowSnapshot:()=>({data})},'@/lib/burrow-memory-local':{},'@/lib/session-lifecycle':{},
  '@/lib/friends-api':{getCachedPairing:()=>{reads++;return cached;},subscribePairingStatus:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}},
  '@/lib/avatar':avatar,'@/lib/release-room-api':{releaseRoomScope:d=>d.profile.id+':'+d.partner.id+':'+d.pairVersion},
  '@/lib/ui-idle':{},'@/lib/burrow-game-room-cache':{},'@/lib/burrow-foreground-prewarm':{},'@/lib/use-home-entry':{useHomeEntry:()=>({pending:false})},
  '@/lib/surprise-inbox':{},'@/lib/friend-visit-local':{},
 });
 h.render(gate.BurrowSyncGate);assert.equal(avatar.initialAvatar('a','Alice').backgroundColor,'#FFC547');assert.equal(avatar.initialAvatar('b','Bob').backgroundColor,'#83513E');
 for(const fn of listeners)fn({...cached,initiatorId:'b'});assert.equal(avatar.initialAvatar('b','Bob').backgroundColor,'#FFC547');assert.equal(reads,1);
 for(const fn of listeners)fn({...cached,partner:{userId:'old-partner'}});assert.notEqual(avatar.initialAvatar('a','Alice').backgroundColor,'#FFC547');
 data={profile:{id:'c'},partner:{id:'d'},pairVersion:'v2'};avatar.configureAvatarPair(data.profile,data.partner);h.render(gate.BurrowSyncGate);assert.equal(listeners.size,1);
 assert.notEqual(avatar.initialAvatar('c','Chris').backgroundColor,'#FFC547');h.unmount();assert.equal(listeners.size,0);avatar.configureAvatarPair(null);
});
