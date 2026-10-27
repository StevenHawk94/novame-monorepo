const {test}=require('node:test');const assert=require('node:assert/strict');
const {load,hooks,deferred,flush}=require('./lifecycle-test-utils.cjs');
const jsx=(type,props)=>({type,props});
const nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.props?.children),...nodes(x.props?.ListFooterComponent)]:[];
function cacheHarness(disk=new Map()){
 let user='A',identity;
 const imports={
  './storage':{storage:{getString:key=>disk.get(key),set:(key,value)=>disk.set(key,value)}},
  '../shared/storage/keys':{kSurpriseHistory:{keyFor:scope=>'history:'+scope}},
  './session-lifecycle':{sessionUserId:()=>user,subscribeSessionIdentity:fn=>{identity=fn;}},
 };
 const cache=load('apps/mobile/src/lib/surprise-history-cache.ts',imports);
 return {...cache,disk,changeUser:next=>{user=next;identity();}};
}
function historyHarness(fetch,initial=[],cache=cacheHarness()){
 const h=hooks(),calls=[],selected=[];let epoch=1;
 const module=load('apps/mobile/src/components/burrow/surprise-history.tsx',{
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{ActivityIndicator:'Spinner',FlatList:'List',Pressable:'Pressable',Text:'Text',View:'View',StyleSheet:{create:x=>x}},
  '@expo/vector-icons':{Feather:'Icon'},'./surprise-art':{SurprisePortrait:'Portrait'},
  '@/lib/session-lifecycle':{sessionEpoch:()=>epoch},'@/lib/surprise-api':{listSurpriseHistory:(...args)=>{calls.push(args);return fetch(...args);},surpriseTime:()=> '0:12'},
  '@/lib/surprise-history-cache':cache,
  '@/lib/surprise-send-queue':{useSurpriseOutbox:()=>[],retrySurpriseSend(){},surpriseSendFailure:()=>'',canEditRejectedSurprise:()=>false},
  '@/lib/surprise-media-cache':{cachedSurpriseMedia:()=>null},
 });
 const render=()=>h.render(()=>module.SurpriseHistory({scope:'A:B:pair1',userId:'A',name:'Alex',initial,onSelect:item=>selected.push(item)}));
 const action=(tree,text)=>nodes(tree).find(node=>node.type==='Pressable'&&nodes(node.props.children).some(child=>child.type==='Text'&&child.props.children===text));
 const list=tree=>nodes(tree).find(node=>node.type==='List');
 return {h,render,action,list,calls,selected,cache,setInitial:rows=>{initial=rows;},switchAccount:()=>{epoch++;cache.changeUser('C');}};
}
const item=(id,sender_id='B')=>({id,sender_id,recipient_id:sender_id==='B'?'A':'B',sent_at:'2026-10-08T12:00:00Z',opened_at:null,frame:'santa',duration_ms:12000});
test('delivery/open updates merge into already-visible History without dropping earlier paginated rows',async()=>{
 const old=item('old'),next={...item('new'),sent_at:'2026-10-17T00:00:00Z'};
 const h=historyHarness(async()=>({items:[old],nextCursor:null}));h.render();await flush();h.render();
 h.setInitial([next,{...old,opened_at:'2026-10-17T00:01:00Z'}]);h.render();let tree=h.render();
 assert.deepEqual(Array.from(h.list(tree).props.data,row=>row.id),['new','old']);assert.ok(h.list(tree).props.data[1].opened_at);h.h.unmount();
});
test('new drafts accept all current frames, discard retired drafts and never upload a retired send',async()=>{
 let saved,reads=0,posts=0;
 const api=load('apps/mobile/src/lib/surprise-api.ts',{
  'expo-file-system/legacy':{readAsStringAsync:async()=>{reads++;return 'encoded';}},'expo-crypto':{randomUUID:()=> 'key'},
  './api':{apiClient:{post:async()=>{posts++;return{};}}},'./async-lifecycle':{withDeadline:p=>p},
  './storage':{storage:{getString:()=>JSON.stringify(saved)}},'@/shared/storage/keys':{kSurpriseDraft:{name:'draft'}},
  '@/shared/storage/artifacts':{},'./session-lifecycle':{sessionEpoch:()=>1},'./coin-reward-store':{syncCoinWallet(){}},'./surprise-history-cache':{},
  './surprise-media-cache':{keepSentSurpriseMedia:async()=>{}},
 });
 const draft=frame=>({userId:'A',partnerId:'B',pairVersion:'pair',key:'key',frame,photoUri:'photo',audioUri:'voice',durationMs:12000});
 for(const frame of api.SURPRISE_FRAMES){saved=draft(frame);assert.equal(api.readSurpriseDraft('A','B','pair').frame,frame);}
 for(const frame of ['bunny','flower','star','halloween','valentine','new_year','good_morning','sweet_dreams','kiss_you','cuddle_time','thank_you','movie_night','dinner_date','you_got_this','proud_of_you','feel_better','welcome_home','autumn_pumpkin','birthday_cake']){
  saved=draft(frame);assert.equal(api.readSurpriseDraft('A','B','pair'),null);await assert.rejects(api.sendSurprise(saved),/no longer available/);
 }
 assert.equal(reads,0);assert.equal(posts,0);
});
test('history seeds cached metadata, paginates by tab and downloads no media until explicit selection',async()=>{
 const cursor={sentAt:'2026-10-08T12:00:00Z',id:'first'};
 const h=historyHarness(async(direction,before)=>({items:direction==='sent'?[item('sent','A')]:[item(before?'second':'first')],nextCursor:direction==='received'&&!before?cursor:null}),[item('cached')]);
 let tree=h.render();assert.equal(h.list(tree).props.data[0].id,'cached');await flush();tree=h.render();assert.equal(h.list(tree).props.data[0].id,'first');assert.equal(h.selected.length,0);
 const more=h.action(tree,'Load more');more.props.onPress();more.props.onPress();await flush();tree=h.render();assert.equal(h.calls.length,2);assert.deepEqual(h.calls[1],['received',cursor]);assert.equal(h.list(tree).props.data.length,2);
 const row=h.list(tree).props.renderItem({item:h.list(tree).props.data[0]});row.props.onPress();assert.equal(h.selected[0].id,h.list(tree).props.data[0].id);
 h.action(tree,'Sent').props.onPress();tree=h.render();await flush();tree=h.render();assert.equal(h.list(tree).props.data[0].id,'sent');
 h.action(tree,'Received').props.onPress();tree=h.render();assert.equal(h.list(tree).props.data.length,2);assert.equal(h.calls.length,3);h.h.unmount();
});
test('rapid tab switches ignore old requests and cannot release a newer request lock',async()=>{
 const old=deferred(),next=deferred(),third=deferred();let n=0;
 const h=historyHarness(()=>[old,next,third][n++].promise);let tree=h.render();h.action(tree,'Sent').props.onPress();tree=h.render();
 old.resolve({items:[item('stale')],nextCursor:null});await flush();tree=h.render();assert.equal(h.list(tree).props.data.length,0);
 next.resolve({items:[item('sent','A')],nextCursor:null});await flush();tree=h.render();assert.equal(h.list(tree).props.data[0].id,'sent');
 h.action(tree,'Received').props.onPress();tree=h.render();assert.equal(h.calls.length,3);
 third.resolve({items:[item('fresh')],nextCursor:null});await flush();tree=h.render();assert.equal(h.list(tree).props.data[0].id,'fresh');h.h.unmount();
});
test('late history responses are discarded after account change or unmount',async()=>{
 for(const unmount of [false,true]){const pending=deferred(),h=historyHarness(()=>pending.promise);h.render();if(unmount)h.h.unmount();else h.switchAccount();pending.resolve({items:[item('private')],nextCursor:null});await flush();assert.equal(h.list(h.render()).props.data.length,0);h.h.unmount();}
});
test('warm history survives restart, paints without spinners and silently refreshes each tab',async()=>{
 const cache=cacheHarness();
 cache.saveSurpriseHistoryPage('A:B:pair1','received',{items:[item('saved')],nextCursor:null});
 cache.saveSurpriseHistoryPage('A:B:pair1','sent',{items:[],nextCursor:null});
 const restarted=cacheHarness(cache.disk),pending=deferred();
 const h=historyHarness(()=>pending.promise,[],restarted);
 let tree=h.render();tree=h.render();
 assert.equal(h.list(tree).props.data[0].id,'saved');
 assert.equal(h.list(tree).props.refreshing,false);
 assert.equal(nodes(tree).some(node=>node.type==='Spinner'),false);
 pending.reject(Error('offline'));await flush();tree=h.render();
 assert.equal(h.list(tree).props.data[0].id,'saved');assert.equal(h.action(tree,'Retry'),undefined);
 h.action(tree,'Sent').props.onPress();tree=h.render();tree=h.render();
 assert.equal(nodes(tree).some(node=>node.type==='Spinner'),false,'cached empty tab is also immediate');
 await flush();h.h.unmount();
});
test('send/receive/open cache updates survive restart and outrank an older refresh',()=>{
 const cache=cacheHarness(),scope='A:B:pair1';const revision=cache.surpriseHistoryRevision();
 cache.rememberSurprises(scope,[{...item('new'),photoUrl:'private-signed-url',audioUrl:'secret'},item('sent','A')]);
 cache.rememberSurpriseOpened(scope,'new');
 const refreshed=cache.saveSurpriseHistoryPage(scope,'received',{items:[item('old')],nextCursor:null},false,revision);
 assert.ok(refreshed.items.some(row=>row.id==='new'&&row.opened_at));
 cache.rememberSurprises(scope,[item('new')]);assert.ok(cache.cachedSurpriseHistory(scope,'received').items.find(row=>row.id==='new').opened_at);
 const restart=cacheHarness(cache.disk);assert.equal(restart.cachedSurpriseHistory(scope,'sent').items[0].id,'sent');
 assert.equal(restart.cachedSurpriseHistory(scope,'received').items.length,2);
 assert.ok([...cache.disk.values()].every(value=>!value.includes('private-signed-url')&&!value.includes('secret')));
 assert.equal(restart.cachedSurpriseHistory('A:B:pair2','received').items.length,0);
 restart.changeUser('C');assert.equal(restart.cachedSurpriseHistory(scope,'received').items.length,0);
});
test('history metadata cache is bounded and the manifest clears it on account removal',()=>{
 const cache=cacheHarness(),scope='A:B:pair1';
 cache.rememberSurprises(scope,Array.from({length:130},(_,i)=>item(String(i))));
 assert.equal(cache.cachedSurpriseHistory(scope,'received').items.length,100);
 const fs=require('node:fs');assert.match(fs.readFileSync(require('node:path').join(__dirname,'../apps/mobile/src/shared/storage/keys.ts'),'utf8'),/kSurpriseHistory = definePrefixKey\('burrow_surprise_history:v1:', 'user'\)/);
});
test('successful native send updates the durable Sent cache before navigating away',async()=>{
 const cache=cacheHarness();let epoch=1;const pending=deferred();
 const api=load('apps/mobile/src/lib/surprise-api.ts',{
  'expo-file-system/legacy':{EncodingType:{Base64:'base64'},readAsStringAsync:async()=> 'encoded-file'},
  'expo-crypto':{randomUUID:()=> 'key'},'./api':{apiClient:{post:()=>pending.promise}},
  './async-lifecycle':{withDeadline:p=>p},'./storage':{storage:{}},
  '@/shared/storage/keys':{kSurpriseDraft:{name:'draft'}},
  '@/shared/storage/artifacts':{},'./session-lifecycle':{sessionEpoch:()=>epoch},
  './coin-reward-store':{syncCoinWallet(){}},'./surprise-history-cache':cache,
  './surprise-media-cache':{keepSentSurpriseMedia:async()=>{}},
 });
 const send=api.sendSurprise({userId:'A',partnerId:'B',pairVersion:'pair1',key:'key',frame:'ghost',photoUri:'face.jpg',audioUri:'voice.m4a',durationMs:12000});
 await flush();pending.resolve({id:'receipt',wallet:{balance:700,version:2}});await send;
 const restarted=cacheHarness(cache.disk),page=restarted.cachedSurpriseHistory('A:B:pair1','sent');
 assert.equal(page.items[0].id,'receipt');assert.equal(page.items[0].frame,'ghost');assert.equal(page.items[0].duration_ms,12000);
});
test('background send returns its receipt without publishing before the outbox rechecks pairing generation',async()=>{
 let mutations=0;const api=load('apps/mobile/src/lib/surprise-api.ts',{
  'expo-file-system/legacy':{EncodingType:{Base64:'base64'},readAsStringAsync:async()=> 'encoded-file'},'expo-crypto':{randomUUID:()=> 'key'},
  './api':{apiClient:{}},'./async-lifecycle':{withDeadline:p=>p},'./storage':{storage:{}},'@/shared/storage/keys':{kSurpriseDraft:{name:'draft'}},
  '@/shared/storage/artifacts':{},'./session-lifecycle':{sessionEpoch:()=>1},'./coin-reward-store':{syncCoinWallet(){mutations++;}},
  './surprise-history-cache':{cachedSurpriseHistory(){mutations++;throw Error('Premature history activation');},rememberSurprises(){mutations++;}},
  './surprise-media-cache':{keepSentSurpriseMedia:async()=>{mutations++;}},
 });
 const result=await api.sendSurprise({userId:'A',partnerId:'B',pairVersion:'pair1',key:'key',frame:'ghost',photoUri:'face.jpg',audioUri:'voice.m4a',durationMs:12000},async body=>{
  assert.equal(body.key,'key');return{id:'receipt',wallet:{balance:700,version:2}};
 });assert.equal(result.id,'receipt');assert.equal(mutations,0);
});
test('rain uses a fixed particle pool with rasterized native transforms and reduced-motion fallback',async()=>{
 const parent=hooks();let active=parent,reduceCallback,memoCalls=0;const timings=[];
 class Value{constructor(value){this.value=value;}setValue(value){this.value=value;}interpolate(options){return options;}stopAnimation(fn){fn(this.value);}}
 const animation=()=>({start(){},stop(){}});
 const module=load('apps/mobile/src/components/burrow/surprise-rain.tsx',{
  '@/lib/surprise-preview':{useSurprisePreview:()=> 'shared-composite.png'},
  react:{memo:fn=>{memoCalls++;return fn;},useRef:(...args)=>active.react.useRef(...args),useState:(...args)=>active.react.useState(...args),useEffect:(...args)=>active.react.useEffect(...args)},
  'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{Animated:{Value,View:'AnimatedView',timing:(_value,options)=>{timings.push(options);return{kind:'nativeTiming',stop(){},start(callback){callback?.({finished:true});}};},loop:child=>{assert.equal(child.kind,'nativeTiming');return animation();}},Easing:{linear:'linear'},StyleSheet:{create:x=>x,absoluteFillObject:{}},View:'View',AccessibilityInfo:{isReduceMotionEnabled:async()=>false,addEventListener:(_event,fn)=>{reduceCallback=fn;return{remove(){}};}}},
  './surprise-art':{SurprisePortrait:'Portrait'},
 });
 const render=props=>{active=parent;return parent.render(()=>module.SurpriseRain({frame:'santa',uri:'one-cached-face.jpg',playing:true,...props}));};
 let tree=render();tree.props.onLayout({nativeEvent:{layout:{width:390,height:844}}});tree=render();
 assert.equal(tree.props.style.backgroundColor,'transparent','the rain never replaces the real page with a brown backdrop');
 const particles=nodes(tree).filter(node=>typeof node.type==='function');assert.equal(particles.length,18);assert.equal(memoCalls,1);
 for(const face of particles){const child=hooks();active=child;const drawn=child.render(()=>face.type(face.props));assert.equal(drawn.props.renderToHardwareTextureAndroid,true);assert.equal(drawn.props.shouldRasterizeIOS,true);child.unmount();}
 assert.ok(timings.length>18);assert.ok(timings.every(options=>options.useNativeDriver===true&&options.isInteraction===false));
 for(let index=0;index<18;index++)assert.equal(timings[index*2+1].duration,(1400+(index*47%400))/.8/.7,'all modes are another 30% slower than the previous shared speed');
 tree=render({uri:undefined});assert.equal(nodes(tree).filter(node=>typeof node.type==='function').length,18);
 tree=render({playing:false});assert.equal(nodes(tree).filter(node=>typeof node.type==='function').length,18);
 await flush();active=parent;reduceCallback(true);tree=render();assert.equal(nodes(tree).filter(node=>typeof node.type==='function').length,0);assert.equal(nodes(tree).filter(node=>node.type==='Portrait').length,1);parent.unmount();
});
