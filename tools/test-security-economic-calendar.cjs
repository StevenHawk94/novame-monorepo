const {test}=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./lifecycle-test-utils.cjs');
test('economic calendar projection preserves new-client display timezone, keeps legacy daily anchor compatible',async()=>{
 const {projectEconomicCalendar:project}=await import('../apps/api/src/lib/economic-calendar-contract.mjs');
 const value={economicTimezone:'Asia/Shanghai',localDate:'2026-10-25',profile:{id:'me',timezone_name:'America/Los_Angeles'},attention:{journal:{ready:true}}};
 const modern=project(value,new Request('https://test',{headers:{'X-Burrow-Economy':'1'}}));
 assert.equal(modern,value);assert.equal(modern.profile.timezone_name,'America/Los_Angeles');
 const legacy=project(value,new Request('https://test'));assert.equal(legacy.profile.timezone_name,'Asia/Shanghai');
 assert.equal(value.profile.timezone_name,'America/Los_Angeles');assert.equal(legacy.attention,value.attention);
 assert.throws(()=>project({profile:{}},new Request('https://test')),/economic_calendar_unavailable/);
});
test('server daily date uses only fixed economic RPC and fails closed, never mutable profile or device date',async()=>{
 const {resolveUserLocalDate:read}=load('apps/api/src/lib/user-local-date.js');let calls=0;
 const db={from(){throw Error('must not read profile')},rpc:async(name,args)=>{
  assert.equal(name,'economic_calendar_v1');assert.equal(args.p_user,'me');calls++;
  return {data:{timezone:'Asia/Shanghai',localDate:'2030-01-01'}};
 }};
 assert.equal(await read(db,'me'),'2030-01-01');assert.equal(calls,1);
 await assert.rejects(read({rpc:async()=>({error:Error('offline')})},'me'),/offline/);
 await assert.rejects(read({rpc:async()=>({data:null})},'me'),/economic_calendar_unavailable/);
});
test('local Affection/Adventure decisions use economic clock without reading the server on tap',()=>{
 const {adventureFinishedToday,freeAffectionUsedToday}=load('apps/mobile/src/lib/burrow-daily-entry.ts',{
  './burrow-local-day':load('apps/mobile/src/lib/burrow-local-day.ts'),
 });
 const data={profile:{timezone_name:'America/Los_Angeles'},economicTimezone:'Asia/Shanghai',localDate:'2026-10-25',
  dailyAdventureUsed:true,hasPlus:true,affectionUsage:{localDate:'2026-10-25',used:6}};
 const now=Date.parse('2026-10-25T01:00:00Z');
 assert.equal(adventureFinishedToday(data,now),true);assert.equal(freeAffectionUsedToday(data,now),true);
});
