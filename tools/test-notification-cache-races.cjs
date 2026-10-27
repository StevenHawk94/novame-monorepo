const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,deferred,flush}=require('./lifecycle-test-utils.cjs');
test('a late Love Note pagination response cannot erase a newly prepared head note',async()=>{
 const requests=[],data={profile:{id:'me'},partner:{id:'you'},pairVersion:'one',memoryEntries:[]};
 const api=load('apps/mobile/src/lib/use-love-notes.ts',{
  react:{},'@react-navigation/native':{},'./burrow-attention':{attentionScope:()=> 'me:you:one'},
  './burrow-history':{fetchBurrowHistory:()=>{const read=deferred();requests.push(read);return read.promise;}},
  './love-note-model':load('apps/mobile/src/lib/love-note-model.ts'),
  './session-lifecycle':{sessionEpoch:()=>1,sessionUserId:()=> 'me',subscribeSessionIdentity(){}},
 });
 const note=(id,at)=>({id,author_id:'you',body:'💌 '+id,created_at:at,updated_at:at});
 const old=note('old','2026-10-18'),fresh=note('new','2026-10-19'),earlier=note('earlier','2026-10-17');
 let a=api.prepareLoveNotes(data);requests[0].resolve({rows:[old],next:{before:'old'},hasMore:true});await a;
 const more=api.prepareLoveNotes(data,()=>true,true);
 data.attention={letters:[{id:'new:2026-10-19'}]};
 const head=api.prepareLoveNotes(data);requests[2].resolve({rows:[fresh,old],next:null,hasMore:false});await head;
 assert.equal(api.loveNotesReady(data),true);
 requests[1].resolve({rows:[earlier],next:null,hasMore:false});await more;
 assert.equal(api.loveNotesReady(data),true,'publishing an older page cannot revoke a ready notification body');
});
test('a journal read started before a local save cannot overwrite the saved snapshot',async()=>{
 const read=deferred(),questions=load('apps/mobile/src/lib/couple-journal-questions.ts'),today=questions.coupleJournalDate('UTC');
 const api=load('apps/mobile/src/lib/couple-journal.ts',{
  './api':{apiClient:{get:()=>read.promise}},'./async-lifecycle':{withDeadline:p=>p},
  './session-lifecycle':{sessionEpoch:()=>1,sessionUserId:()=> 'me',subscribeSessionIdentity(){}},
  './storage':{storage:{getString(){},set(){}}},'../shared/storage/keys':{kBurrowJournal:{keyFor:x=>x}},'./couple-journal-questions':questions,
 });
 const scope='me:one',base={today:{id:'today',date:today,answers:[]},history:[],timezone:'UTC',todayDate:today};
 api.cacheCoupleJournal(scope,base,false);
 const prepare=api.prepareCoupleJournal({profile:{id:'me',timezone_name:'UTC'},pairVersion:'one',localDate:today,moments:[]},()=>true);
 const saved={...base,today:{...base.today,answers:[{id:'answer',authorId:'me',body:'Saved now',updatedAt:'now'}]}};
 api.cacheCoupleJournal(scope,saved,false);read.resolve({...base,success:true});
 await assert.rejects(prepare,/journal_changed_during_read/);
 assert.equal(api.cachedCoupleJournal(scope).today.answers[0].body,'Saved now');
});
test('module preparation is idle, bounded, scope-checked and never invokes a screen component',()=>{
 const calls=[],evaluated=[];const routes=['../../app/(main)/room-interaction','../../app/(main)/game-room','../../app/(main)/surprise-room','../components/burrow/couple-journal-screen','../../app/(main)/music-player','../../app/(main)/menu','../../app/(main)/gift-library'];
 const imports={};routes.forEach((name,index)=>Object.defineProperty(imports,name,{enumerable:true,get(){evaluated.push(index);return{default:()=>calls.push(index)};}}));
 const api=load('apps/mobile/src/lib/burrow-route-modules.ts',imports);let current=false;
 const jobs=api.burrowRouteModuleJobs(()=>current);assert.equal(jobs.length,routes.length);assert.ok(jobs[0].delayMs<jobs.at(-1).delayMs);
 jobs.forEach(job=>job.run());assert.equal(evaluated.length,0,'revoked scope cannot evaluate a pending job');
 current=true;jobs.forEach(job=>job.run());assert.equal(evaluated.length,routes.length);assert.equal(calls.length,0,'only require/evaluation, no hidden camera/audio/route mount');
 jobs.forEach(job=>job.run());assert.equal(evaluated.length,routes.length,'a later idle warmup cannot reinitialize modules');
});
test('ready game receipts cannot rewind on late polls and unread sessions survive the ordinary cache limit',()=>{
 const disk=new Map();const api=load('apps/mobile/src/lib/burrow-game-room-cache.ts',{
  './session-lifecycle':{sessionUserId:()=> 'me',subscribeSessionIdentity(){}},
  './storage':{storage:{getString:key=>disk.get(key),set:(key,value)=>disk.set(key,value)}},
  '../shared/storage/keys':Object.fromEntries(['kGameProgress','kGameOverview','kGameHistory'].map(key=>[key,{keyFor:x=>key+x}])),
 });
 const scope='me:you:one',done={id:'round',gameId:'game',completedAt:'2026-10-19T10:00:00Z',ownAnswers:Array(6).fill(0),guesses:Array(6).fill(0),partnerOwnCount:6,partnerGuessCount:6,partnerOwnAnswers:Array(6).fill(0),partnerGuesses:Array(6).fill(1),result:{mine:6,partner:0,outcome:'win'}};
 api.cacheGameSession(done,1,scope);api.cacheGameSession({...done,completedAt:null,result:null,guesses:[]},2,scope);
 assert.equal(api.getCachedGameSession('round',scope).result.mine,6);
 const ids=Array.from({length:45},(_,i)=>'unread-'+i);api.retainNotificationGameSessions(ids,scope);
 for(const id of [...ids,'other-1','other-2'])api.cacheGameSession({...done,id},3,scope);
 assert.ok(ids.every(id=>api.getCachedGameSession(id,scope)?.result),'an unread badge must not outlive its prepared session after a thumbnail/lobby cache trim');
});
