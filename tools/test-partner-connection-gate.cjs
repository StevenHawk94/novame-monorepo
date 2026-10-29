const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,hooks,deferred,flush}=require('./lifecycle-test-utils.cjs');
function harness({paired=false,route='game-room'}={}){
 const h=hooks(),requests=[],listeners=[];let owner='A',epoch=1,segments=['(main)',route],overlay=false;
 let state={pairInvalidated:false,data:{profile:{id:'A',display_name:'Alice',avatar_url:'https://test/self',is_default_avatar:false},partner:null,pairAccessVerified:true}};
 const pair=(version='one')=>{state={pairInvalidated:false,data:{...state.data,profile:{id:owner,display_name:'Alice'},partner:{id:'B',display_name:'Bob',avatar_url:'https://test/bob',is_default_avatar:false},pairVersion:version,pairAccessVerified:true}};};
 if(paired)pair();let dismissedKeyboard=0;
 const jsx=(type,props)=>({type,props});
 const api=load('apps/mobile/src/components/main/partner-connection-gate.tsx',{
 react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},
 '@/lib/overlay-presence':{useOverlayPresent:()=>overlay},
 'react-native':{AppState:{currentState:'active',addEventListener:(_,fn)=>{listeners.push(fn);return{remove(){}};}},Keyboard:{dismiss:()=>dismissedKeyboard++}},
 'expo-router':{useSegments:()=>segments,router:new Proxy({},{get(){throw Error('must not navigate');}})},
 'expo-image':{Image:{prefetch:url=>{const d=deferred();requests.push({url,...d});return d.promise;}}},
 '@/components/ui/screen-overlay':{ScreenOverlay:'Overlay'},'@/components/onboarding/partner-pairing-ui':{PairingConnectedPage:'Connected'},
 '@/lib/burrow-store':{useBurrowSnapshot:()=>state,getBurrowSnapshot:()=>state},
 '@/lib/session-lifecycle':{sessionUserId:()=>owner,sessionEpoch:()=>epoch},'@/lib/async-lifecycle':{withDeadline:p=>p},
 });
 const render=()=>h.render(api.PartnerConnectionGate);
 return{render,h,requests,pair,listeners,setOverlay:v=>{overlay=v;},get state(){return state;},set state(v){state=v;},get keyboard(){return dismissedKeyboard;},route:r=>{segments=['(main)',r];},switch(){owner='C';epoch++;},async ready(){requests.forEach(r=>r.resolve(true));await flush();}};
}
test('pairing during launch announcement waits and resumes without losing its pending success',async()=>{
 const h=harness();h.render();h.setOverlay(true);h.pair();h.render();assert.equal(h.requests.length,0);assert.equal(h.render().props.visible,false);
 h.setOverlay(false);h.render();assert.equal(h.requests.length,1);await h.ready();assert.equal(h.render().props.visible,true);h.h.unmount();
});
test('incoming pairing on an arbitrary room prepares first, then overlays; closing performs no navigation',async()=>{
 const h=harness();assert.equal(h.render().props.visible,false);h.pair();assert.equal(h.render().props.visible,false);assert.equal(h.requests.length,1);
 await h.ready();let tree=h.render();assert.equal(tree.props.visible,true);assert.equal(tree.props.children.props.partner.name,'Bob');
 tree.props.children.props.onContinue();assert.equal(h.render().props.visible,false);assert.equal(h.keyboard,1);h.h.unmount();
});
test('duplicate broadcasts and same-pair refreshes never repeat a dismissed connection',async()=>{
 const h=harness();h.render();h.pair();h.render();await h.ready();h.render().props.onRequestClose();h.render();
 h.state={...h.state,pairInvalidated:true};assert.equal(h.render().props.visible,false);
 h.state={...h.state,pairInvalidated:false};assert.equal(h.render().props.visible,false);assert.equal(h.requests.length,1);h.h.unmount();
});
test('verification gaps during avatar preparation retry the pending prompt, not lose it',async()=>{
 const h=harness();h.render();h.pair();h.render();h.state={...h.state,pairInvalidated:true};h.render();
 h.requests[0].resolve(true);await flush();assert.equal(h.render().props.visible,false);
 h.state={...h.state,pairInvalidated:false};h.render();assert.equal(h.requests.length,2);await h.ready();assert.equal(h.render().props.visible,true);h.h.unmount();
});
test('cold restoration and explicit invite success do not create a second global prompt',async()=>{
 const restored=harness({paired:true});restored.render();await flush();assert.equal(restored.requests.length,0);assert.equal(restored.render().props.visible,false);restored.h.unmount();
 const inline=harness({route:'pair-partner'});inline.render();inline.pair();inline.render();await flush();assert.equal(inline.requests.length,0);inline.route('moments');assert.equal(inline.render().props.visible,false);inline.h.unmount();
});
test('explicit minimal pairing receipt followed by verified bootstrap on Home announces only inline',async()=>{
 const h=harness();h.render();h.route('pair-partner');h.render();h.pair();
 h.state={...h.state,data:{...h.state.data,pairAccessVerified:undefined}};h.render();
 h.route('index');h.render();h.state={...h.state,data:{...h.state.data,pairAccessVerified:true}};h.render();await h.ready();
 assert.equal(h.requests.length,0);assert.equal(h.render().props.visible,false);
 // Suppressing the explicit generation must not swallow a later passive pair.
 h.state={...h.state,data:{...h.state.data,partner:null,pairVersion:undefined}};h.render();
 h.pair('two');h.render();await h.ready();assert.equal(h.render().props.visible,true);h.h.unmount();
});
test('unpair/account switch discards a late prepared success; no stale partner is displayed',async()=>{
 for(const change of ['unpair','account']){
  const h=harness();h.render();h.pair();h.render();if(change==='account')h.switch();else h.state={pairInvalidated:true,data:null};h.render();await h.ready();assert.equal(h.render().props.visible,false);h.h.unmount();
 }
});
test('background delivery waits for foreground; failed portrait preload uses ready initials',async()=>{
 const h=harness();h.render();h.listeners[0]('background');h.pair();h.render();h.requests[0].reject(Error('offline'));await flush();
 assert.equal(h.render().props.visible,false);h.listeners[0]('active');const tree=h.render();assert.equal(tree.props.visible,true);assert.equal(tree.props.children.props.partner.avatarUrl,undefined);h.h.unmount();
});
test('re-pairing after an authoritative unpair presents the new generation once',async()=>{
 const h=harness({paired:true});h.render();h.state={...h.state,data:{...h.state.data,partner:null,pairVersion:undefined}};h.render();h.pair('two');h.render();await h.ready();assert.equal(h.render().props.visible,true);h.h.unmount();
});
