const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load,hooks,deferred,flush}=require('./lifecycle-test-utils.cjs');
const jsx=(type,props)=>({type,props}),nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
function harness({cached='YRZQDM',response={inviteCode:'YRZQDM'},copy=async()=>{}}={}){
 const h=hooks(),listeners=new Set(),copies=[];let owner='me',epoch=1,requests=0;
 const api=load('apps/mobile/src/components/me/account-match-code-card.tsx',{
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{View:'View',Text:'Text',Pressable:'Button',StyleSheet:{create:v=>v}},
  'expo-clipboard':{setStringAsync:async code=>{copies.push(code);await copy();}},
  '@/lib/partner-invite-cache':{cachedPartnerInvite:()=>cached},
  '@/lib/friends-api':{fetchFriends:()=>{requests++;return Promise.resolve(response);}},
  '@/lib/session-lifecycle':{sessionUserId:()=>owner,sessionEpoch:()=>epoch,subscribeSessionIdentity:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}},
 });
 const render=()=>h.render(api.AccountMatchCodeCard),button=label=>nodes(render()).find(n=>n.type==='Button'&&n.props.accessibilityLabel===label);
 return{h,render,button,copies,listeners,requests:()=>requests,text:()=>nodes(render()).filter(n=>n.type==='Text').map(n=>n.props.children).join('|'),switch:()=>{owner='other';epoch++;listeners.forEach(fn=>fn());}};
}
test('Account Management embeds own match-code card without depending on pairing state',()=>{
 assert.match(fs.readFileSync('apps/mobile/src/components/me/account-management-screen.tsx','utf8'),/<AccountMatchCodeCard\/>/);
});
test('prepared own code renders immediately after pairing and copies without a network read',async()=>{
 const h=harness();assert.match(h.text(),/YRZQDM/);assert.equal(h.requests(),0);
 h.button('Copy match code').props.onPress();await flush();assert.deepEqual(h.copies,['YRZQDM']);assert.match(h.text(),/Copied/);h.h.unmount();assert.equal(h.listeners.size,0);
});
test('missing cache prepares asynchronously, unavailable result retains explicit retry',async()=>{
 const h=harness({cached:null,response:{inviteCode:null}});assert.match(h.text(),/Preparing/);await flush();assert.ok(h.button('Retry loading match code'));assert.equal(h.button('Copy match code'),undefined);
 h.button('Retry loading match code').props.onPress();await flush();assert.equal(h.requests(),2);h.h.unmount();
});
test('a newly fetched valid code becomes selectable/copyable; malformed data never does',async()=>{
 for(const code of ['HA54J3','bad']){const h=harness({cached:null,response:{inviteCode:code}});h.render();await flush();assert.equal(!!h.button('Copy match code'),code==='HA54J3');h.h.unmount();}
});
test('late response cannot reveal previous account code after identity switch',async()=>{
 const d=deferred(),h=harness({cached:null,response:d.promise});h.render();h.switch();d.resolve({inviteCode:'YRZQDM'});await flush();assert.doesNotMatch(h.text(),/YRZQDM/);assert.equal(h.button('Copy match code'),undefined);h.h.unmount();
});
test('identity switch clears prepared code; old copy completion does not publish feedback',async()=>{
 const d=deferred(),h=harness({copy:()=>d.promise});h.button('Copy match code').props.onPress();h.switch();d.resolve();await flush();assert.doesNotMatch(h.text(),/YRZQDM|Copied/);assert.equal(h.button('Copy match code'),undefined);h.h.unmount();
});
test('clipboard failure keeps code and retry, duplicate taps do not queue clipboard writes',async()=>{
 const d=deferred(),h=harness({copy:()=>d.promise});const b=h.button('Copy match code');b.props.onPress();b.props.onPress();assert.equal(h.copies.length,1);d.reject(Error('clipboard unavailable'));await flush();assert.match(h.text(),/Could not copy/);assert.match(h.text(),/YRZQDM/);assert.ok(h.button('Copy match code'));h.h.unmount();
});
