const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, imports, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
  }).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,console,Date,
    require:n=>{assert.ok(Object.hasOwn(imports,n),n);return imports[n];},...globals});
  return module.exports;
}
function outbox() {
  let owner='A', fail=false, pending=[], onGet;
  const disk=new Map(), requests=[];
  const api=load('apps/mobile/src/lib/reflect-settlement-outbox.ts',{
    './api':{apiClient:{
      get:async(url)=>{requests.push({url}); await onGet?.(); return {success:true,pending};},
      post:async(url,body)=>{requests.push({url,body}); if(fail)throw Error('offline');return {success:true};},
    }},
    './supabase':{supabase:{auth:{getSession:async()=>({data:{session:{user:{id:owner}}}})}}},
    './storage':{storage:{getString:k=>disk.get(k),set:(k,v)=>disk.set(k,v),remove:k=>disk.delete(k),getAllKeys:()=>[...disk.keys()]}},
    '../shared/storage/keys':{kReflectSettlement:{prefix:'settlement:'}},
  });
  return {api,disk,requests,setOwner:v=>owner=v,setFail:v=>fail=v,setPending:v=>pending=v,onGet:fn=>onGet=fn};
}
const draft={userId:'A',reflectId:'reflect-1',draftId:'draft-1'};
const memory=[{itemId:'soup',text:'Edited before the connection dropped.',source:'manual',visible:false,edited:true}];
test('each keystroke is durably checkpointed; an older acknowledgement cannot delete newer edits',()=>{
  const h=outbox(), a=h.api.writeSettlementCheckpoint(draft,memory);
  const b=h.api.writeSettlementCheckpoint(draft,[{...memory[0],text:''}]);
  assert.ok(b.revision>a.revision);
  h.api.clearSettlementCheckpoint('A','draft-1',a.revision);
  assert.equal(h.api.readSettlementCheckpoint('A','draft-1').memories[0].text,'');
  h.api.clearSettlementCheckpoint('A','draft-1',b.revision);
  assert.equal(h.disk.size,0);
});
test('cold restart uses local edits when available and server snapshot when no response ever reached the phone',async()=>{
  const h=outbox(); h.setPending([{id:'draft-1'},{id:'server-only'}]);
  h.api.writeSettlementCheckpoint(draft,memory);
  let refresh=0; assert.equal(await h.api.recoverReflectSettlements(()=>refresh++),true);
  const saves=h.requests.filter(r=>r.url.endsWith('/finalize'));
  assert.equal(saves.length,2); assert.equal(saves[0].body.memories[0].visible,false);
  assert.equal(saves[1].body.useSaved,true); assert.equal(saves[1].body.memories,undefined);
  assert.equal(h.disk.size,0); assert.equal(refresh,1);
  assert.ok(h.requests.every(r=>!/(prepare|enrich)/.test(r.url)));
});
test('offline edits survive failure and a lost Done response can be acknowledged without rerunning AI',async()=>{
  const h=outbox(); h.api.writeSettlementCheckpoint(draft,memory); h.setFail(true);
  assert.equal(await h.api.recoverReflectSettlements(),false); assert.equal(h.disk.size,1);
  // Server has already completed: pending is empty, but local unacknowledged Done remains.
  h.setFail(false); assert.equal(await h.api.recoverReflectSettlements(),true); assert.equal(h.disk.size,0);
  assert.equal(h.requests.filter(r=>r.url.endsWith('/finalize')).length,2);
});
test('active settlement, Paywall detour and in-flight Save cannot be auto-completed by recovery',async()=>{
  const h=outbox();h.api.beginReflectPreparation();
  await h.api.recoverReflectSettlements();assert.equal(h.requests.length,0);
  h.api.holdReflectSettlement('draft-1');h.api.endReflectPreparation();
  await h.api.recoverReflectSettlements();assert.equal(h.requests.length,0);
  h.api.releaseReflectSettlement('draft-1');await h.api.recoverReflectSettlements();
  assert.equal(h.requests.length,1);
});
test('UUID ownership is checked before upload and again after an asynchronous lookup',async()=>{
  const h=outbox(), cp=h.api.writeSettlementCheckpoint(draft,memory);
  h.setOwner('B'); assert.equal(await h.api.flushSettlementCheckpoint(cp),false);
  assert.equal(h.requests.length,0);
  h.setOwner('A'); h.setPending([{id:'draft-1'}]);h.onGet(()=>h.setOwner('B'));
  await h.api.recoverReflectSettlements();
  assert.equal(h.requests.filter(r=>r.body).length,0);assert.equal(h.disk.size,1);
});

function guideHarness() {
  let cursor=0, focused=true, image=null, active=null, shown=0, completed=0;
  const slots=[],effects=[],timers=new Map();let nextTimer=0;
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((x,i)=>Object.is(x,b[i]));
  const react={
    useState(initial){const i=cursor++;slots[i]??={value:typeof initial==='function'?initial():initial};return [slots[i].value,v=>slots[i].value=v];},
    useRef(current){const i=cursor++;slots[i]??={current};return slots[i];},
    useCallback(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps))slots[i]={deps,value:fn};return slots[i].value;},
    useEffect(fn,deps){const i=cursor++,old=slots[i];if(same(old?.deps,deps))return;const slot=slots[i]={deps};effects.push(()=>{old?.cleanup?.();slot.cleanup=fn();});},
  };
  const jsx=(type,props)=>({type,props});
  const animation=()=>({start(){},stop(){}});
  const {FeatureGuideModal}=load('apps/mobile/src/components/main/feature-guide-modal.tsx',{
    react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{
      Animated:{Value:class{constructor(v){this.v=v;}setValue(v){this.v=v;}},timing:animation,sequence:animation,
        parallel:()=>({start:()=>shown++,stop(){}}),View:'AnimatedView'},
      Easing:{out:x=>x,inOut:x=>x},Image:{resolveAssetSource:()=>({uri:'bundle://guide.png'})},
      Modal:'Modal',Pressable:'Pressable',Text:'Text',View:'View',StyleSheet:{create:x=>x,absoluteFillObject:{}},
    },
    'expo-image':{Image:'Image',useImage:()=>image},
    'expo-router':{useFocusEffect:fn=>react.useEffect(()=>focused?fn():undefined,[fn,focused])},
    '@/lib/icons':{ICONS:{}},'@/lib/haptics':{},
    '@/lib/feature-guides':{shouldShowFeatureGuide:()=>!completed,completeFeatureGuide:()=>completed++},
    '@/lib/modal-coordinator':{useActiveModalSlot:()=>active,requestModalSlot:()=>active='guide',releaseModalSlot:()=>active=null},
  },{
    setTimeout(fn){timers.set(++nextTimer,fn);return nextTimer;},clearTimeout:id=>timers.delete(id),
  });
  return {
    render(){cursor=0;const tree=FeatureGuideModal({guide:'reflect'});effects.splice(0).forEach(fn=>fn());return tree;},
    imageReady(){image={width:74,height:74};},focus(v){focused=v;},
    shown:()=>shown,completed:()=>completed,timers,
  };
}
function nodes(node){return !node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(nodes)];}
test('guide waits for decoded icon AND actual onDisplay before any popup animation; dismiss completes it once',()=>{
  const h=guideHarness();h.render();assert.equal(h.render().props.visible,false);assert.equal(h.shown(),0);
  h.imageReady();h.render();h.render();let tree=h.render();
  assert.equal(tree.props.visible,true);assert.equal(h.shown(),0);
  nodes(tree).find(n=>n.type==='Image').props.onDisplay();tree=h.render();assert.equal(h.shown(),1);
  tree.props.onRequestClose();h.render();assert.equal(h.completed(),1);
  h.focus(false);h.render();h.focus(true);h.render();assert.equal(h.render().props.visible,false);
});
test('a failed native display releases the invisible modal without marking the guide seen',()=>{
  const h=guideHarness();h.imageReady();h.render();h.render();h.render();
  for(const fn of [...h.timers.values()])fn();
  assert.equal(h.render().props.visible,false);assert.equal(h.completed(),0);assert.equal(h.shown(),0);
});
test('all three flows disable native dismiss and protect both submission and settlement',()=>{
  const layout=fs.readFileSync(path.join(root,'apps/mobile/app/(main)/_layout.tsx'),'utf8');
  for(const route of ['reflect-guided','reflect-typing','shared-memory-create']){
    assert.match(layout,new RegExp('name="'+route+'"[^\n]+gestureEnabled: false'));
    assert.match(fs.readFileSync(path.join(root,'apps/mobile/app/(main)',route+'.tsx'),'utf8'),/useReflectExitGuard\(submitting\)/);
  }
  const source=fs.readFileSync(path.join(root,'apps/mobile/src/components/main/reflect-settlement.tsx'),'utf8');
  assert.match(source,/useReflectExitGuard\(!completed\)/);
  assert.match(source,/setCompleted\(result.snapshot\)/);
  assert.match(source,/writeSettlementCheckpoint\(draft, next\)/);
});
