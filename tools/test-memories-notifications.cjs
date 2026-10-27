const {test}=require('node:test'),assert=require('node:assert/strict');const {load}=require('./lifecycle-test-utils.cjs');
test('old unread pages prepare in bounded batches before ready; exact microsecond revision is required',async()=>{
 const requests=[],at='2026-10-24T12:00:00.123456+00:00';
 const pages=Array.from({length:6},(_,i)=>({id:'page'+i,date:'2026-10-23',pageNumber:i+1,question:'Past',answers:[{id:'a'+i,authorId:'you',body:'Words',updatedAt:at}]}));
 const today={id:'today',date:'2026-10-24',pageNumber:7,question:'Now',answers:[]};
 const snapshot={success:true,protocol:2,today,history:[],hasMore:false,nextBefore:null,todayDate:'2026-10-24',timezone:'UTC',pairVersion:'one'};
 const api=load('apps/mobile/src/lib/couple-journal.ts',{
  './api':{apiClient:{get:async path=>{requests.push(path);const page=new URL(path,'https://local').searchParams.get('page');return page?{success:true,page:pages.find(p=>p.id===page)}:{...snapshot,history:[]};}}},
  './async-lifecycle':{withDeadline:p=>p},'./session-lifecycle':{sessionEpoch:()=>1,sessionUserId:()=> 'me',subscribeSessionIdentity(){}},
  './storage':{storage:{getString(){},set(){}}},'../shared/storage/keys':{kBurrowJournal:{keyFor:x=>x}},
  './couple-journal-questions':load('apps/mobile/src/lib/couple-journal-questions.ts'),'./ui-idle':{yieldToUi:async()=>{}},
 });
 const data={profile:{id:'me',timezone_name:'UTC'},partner:{id:'you'},pairVersion:'one',localDate:'2026-10-24',moments:[],
  attention:{scope:'me:you:one',journal:pages.map(p=>({id:p.id,at,pageId:p.id,answerId:p.answers[0].id,revision:at,kind:'answer'}))}};
 await assert.rejects(api.prepareCoupleJournal(data,()=>true),/notification_batch_pending/);
 assert.equal(requests.filter(p=>p.includes('?page=')).length,4);assert.equal(api.preparedCoupleJournalVersion('me:one'),undefined);
 await api.prepareCoupleJournal(data,()=>true);assert.equal(requests.filter(p=>p.includes('?page=')).length,6);
 assert.ok(api.preparedCoupleJournalVersion('me:one'));const n=requests.length;await api.prepareCoupleJournal(data,()=>true);assert.equal(requests.length,n);
});
test('History entry reminder is independent of row unread; opening one page never consumes other pages',()=>{
 const disk=new Map();const api=load('apps/mobile/src/lib/burrow-attention.ts',{
  react:{},'./storage':{storage:{getString:k=>disk.get(k),set:(k,v)=>disk.set(k,v)}},'../shared/storage/keys':{kBurrowAttention:{keyFor:x=>x}},
  './session-lifecycle':{sessionUserId:()=> 'me',subscribeSessionIdentity(){}},'./burrow-presentation':{adventureHasArrived:()=>false},'./burrow-moments-model':{momentKind:()=>null},
  './notification-readiness':{notificationReadiness:{subscribe:()=>()=>{},ready:()=>true,revision:()=>0}},'./notification-content-version':{notificationContentVersion:()=>''},'./shop-gift-preparation':{preparedShopGiftIds:()=>[]},
 });
 const at='2026-10-23T12:00:00.123456+00:00',items=[1,2].map(i=>({id:'a'+i,pageId:'p'+i,answerId:'a'+i,revision:at,at,kind:'answer'}));
 const data={profile:{id:'me'},partner:{id:'you'},pairVersion:'one',localDate:'2026-10-24',attention:{scope:'me:you:one',localDate:'2026-10-23',journal:items}};
 assert.deepEqual([...api.unreadBurrowUpdateIds(data,'journal')],['a1','a2'],'yesterday unread survives today');
 api.dismissJournalHistoryReminder(data,['p1','p2']);assert.equal(api.hasJournalHistoryReminder(data,['p1','p2']),false);
 assert.equal(api.unreadBurrowUpdateIds(data,'journal').length,2,'entry dismissal is not full read');
 const page={id:'p1',answers:[{id:'a1',updatedAt:at}]};api.markBurrowUpdatesSeen(data,'journal',api.journalRenderedAttentionIds(data,page));
 assert.deepEqual([...api.unreadBurrowUpdateIds(data,'journal')],['a2']);
 data.attention.journal=[{...items[0],id:'new',revision:'2026-10-23T12:00:00.123457+00:00'}];
 assert.equal(api.journalRenderedAttentionIds(data,page).length,0,'same millisecond does not imply same revision');
 assert.equal(api.hasJournalHistoryReminder(data,['p1']),true);
});
test('only capability clients receive v2 metadata; old clients keep their original notification shape',async()=>{
 const {readBurrowAttention}=load('apps/api/src/lib/burrow-attention.mjs',{}, {AbortSignal});const calls=[];
 const meta=[{id:'page:p',at:'2026-10-24',kind:'page',pageId:'p'}];
 const query=data=>new Proxy({}, {get:(_t,key)=>key==='then'?(resolve,reject)=>Promise.resolve({data,error:null}).then(resolve,reject):()=>query(data)});
 const db={rpc:(name,args)=>{calls.push({name,args});return query(name==='lock_burrow_pair'?'you':name==='burrow_pair_version_v1'?'one':meta);},
  from:name=>query(name==='couple_journal_pages'?[{id:'old',couple_journal_answers:[{id:'a',author_id:'you',updated_at:'at'}]}]:[])};
 const data={partner:{id:'you'},pairVersion:'one',localDate:'2026-10-24'};
 const legacy=await readBurrowAttention(db,'me',data);assert.equal(legacy.journal[0].id,'a:at');assert.ok(!calls.some(c=>c.name==='couple_journal_attention_v2'));
 const capable=await readBurrowAttention(db,'me',data,undefined,true);assert.equal(capable.journal[0].kind,'page');
 assert.equal(calls.find(c=>c.name==='couple_journal_attention_v2').args.p_user_id,'me');
});
