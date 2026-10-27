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

test('durable Adventure inputs retain edge back; legacy submissions and settlement remain protected',()=>{
  const layout=fs.readFileSync(path.join(root,'apps/mobile/app/(main)/_layout.tsx'),'utf8');
  for(const route of ['reflect-guided','reflect-typing'])
    assert.match(layout,new RegExp('name="'+route+'" options=\\{majorUpdate \\? MAIN_ADVENTURE_INPUT_OPTIONS[\\s\\S]*?gestureEnabled: false'));
  const read=file=>fs.readFileSync(path.join(root,file),'utf8');
  const edge=load('apps/mobile/src/lib/page-edge-gesture.ts',{});
  const policy=load('apps/mobile/src/lib/main-navigation-options.ts',{'./page-edge-gesture':edge});
  assert.equal(policy.MAIN_ADVENTURE_INPUT_OPTIONS.gestureEnabled,true);
  assert.equal(policy.MAIN_ADVENTURE_INPUT_OPTIONS.fullScreenGestureEnabled,false);
  assert.match(layout,/name="shared-memory-create"[^\n]+gestureEnabled: false/);
  const retired = read('apps/mobile/app/(main)/shared-memory-create.tsx');
  assert.match(retired, /<Redirect href=/);
  assert.match(retired, /section: 'memories_room'/);
  assert.doesNotMatch(retired, /matchItems|prepareReflect|useReflectExitGuard/);
  assert.match(read('apps/mobile/app/(main)/reflect-guided.tsx'),/useReflectExitGuard\(submitting,/);
  assert.match(read('apps/mobile/app/(main)/reflect-typing.tsx'),/AdventureJournalScreen as default/);
  const journal=read('apps/mobile/src/components/burrow/adventure-journal-screen.tsx');
  assert.match(journal,/keepBurrowTextDraft/);
  assert.ok(journal.indexOf('queueAdventureJournal(')<journal.indexOf('setJobId(id)'),
    'Save acknowledges durable storage before leaving the editable form');
});
