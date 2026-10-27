const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,hooks}=require('./lifecycle-test-utils.cjs');
const {groupAffectionInbox,affectionReceivedCopy}=load('apps/mobile/src/lib/affection-inbox.ts');
const plain=x=>JSON.parse(JSON.stringify(x));
test('all same-type unread events collapse into at most six live groups, including legacy backlog >100',()=>{
  const data={affectionInbox:Array.from({length:130},(_,n)=>({id:'c'+n,affection_type:'cuddle',completed_at:'2026-10-23T10:00:00Z'}))};
  assert.equal(groupAffectionInbox(data).length,1);assert.equal(groupAffectionInbox(data)[0].ids.length,130);
  data.affectionInbox.push(...['hug','kiss','miss_you','gratitude','spicy'].map(type=>({id:type,affection_type:type,completed_at:'2026-10-23T10:00:01Z'})));
  assert.equal(groupAffectionInbox(data).length,6);
  assert.equal(groupAffectionInbox({...data,affectionInboxGroups:[{affection_type:'cuddle',completed_at:'2026-10-23',ids:['full','full','all']} ]})[0].ids.length,2);
});
test('requested singular/plural copy is type-specific, with dynamic count and partner name',()=>{
  assert.deepEqual(plain(affectionReceivedCopy('cuddle','Alex',6)),{title:'Alex sent you 6 cuddles',body:'Someone really wants to hold you.'});
  assert.equal(affectionReceivedCopy('hug','Alex',1).title,'Alex sent you a hug');
  assert.equal(affectionReceivedCopy('kiss','Alex',2).title,'Alex sent you 2 kisses');
  assert.equal(affectionReceivedCopy('miss_you','Alex',3).title,'Alex sent you 3 "miss you"');
  assert.equal(affectionReceivedCopy('gratitude','Alex',4).title,'Alex sent you thanks 4 times');
  assert.equal(affectionReceivedCopy('spicy','Alex',5).title,'Alex is feeling extra spicy x 5');
});
test('open card updates count before Receive; click freezes membership; later arrivals form the next batch',()=>{
  const h=hooks(),animations=[],received=[];let closed=0;
  const jsx=(type,props)=>({type,props}),nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
  class Value{setValue(){}stopAnimation(){}}
  const {ReceiveModal}=load('apps/mobile/src/components/burrow/affection-hub.tsx',{
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{Animated:{Value,timing:()=>({start:fn=>animations.push(fn)})},Pressable:'Button',Text:'Text',View:'View',StyleSheet:{create:x=>x,absoluteFillObject:{}}},
    '@react-navigation/native':{},'expo-router':{},'react-native-safe-area-context':{},'./burrow-image':{Image:'Image'},
    '@/lib/burrow-daily-entry':{},'@/lib/app-major-update-api':{},'@/lib/burrow-art-assets':{},'@/lib/burrow-store':{},
    '@/lib/burrow-ui-assets':{BURROW_AFFECTION_ICONS:{cuddle:'cuddle'}},'@/lib/haptics':{haptics:{medium:async()=>{}}},
    './affection-gesture':{},'./burrow-back-button':{},'./affection-limit-screen':{},'./affection-heart-burst':{AFFECTION_BURST_DURATION:960},
    '@/lib/partner-pairing':{},'@/lib/burrow-attention':{},
  });
  let ids=['a'],visible=true;
  const render=()=>h.render(()=>ReceiveModal({visible,messages:[{affection_type:'cuddle',completed_at:'2026-10-23',ids:[...ids]}],partnerName:'Alex',onClose:()=>closed++,onReceive:list=>received.push(plain(list))}));
  assert.ok(nodes(render()).some(n=>n.props?.children==='Alex sent you a cuddle'));
  ids=['a','b','c','d','e','f'];assert.ok(nodes(render()).some(n=>n.props?.children==='Alex sent you 6 cuddles'));
  const receive=nodes(render()).find(n=>n.type==='Button'&&n.props.children?.props?.children==='Receive');
  receive.props.onPress();receive.props.onPress();assert.equal(received.length,1);assert.deepEqual(received[0],ids);
  ids.push('after-tap');assert.ok(nodes(render()).some(n=>n.props?.children==='Alex sent you 6 cuddles'),'animation freezes the accepted count');
  animations[0]({finished:true});assert.equal(closed,0);assert.ok(nodes(render()).some(n=>n.props?.children==='Alex sent you a cuddle'));
  nodes(render()).find(n=>n.type==='Button'&&n.props.children?.props?.children==='Receive').props.onPress();assert.deepEqual(received[1],['after-tap']);
  ids=[];render();animations[1]({finished:true});assert.equal(closed,1);h.unmount();
});
