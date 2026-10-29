const {test}=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./lifecycle-test-utils.cjs');
const domain=load('packages/domain/src/plushie-touch.ts');
const recorder=load('apps/mobile/src/lib/plushie-touch-recorder.ts',{'@novame/domain':domain});
const warp=load('apps/mobile/src/lib/burrow-toy-warp.ts');
const toy=load('apps/mobile/src/lib/squishy-toy-motion.ts',{'./burrow-toy-warp':warp});
const play=load('apps/mobile/src/lib/plushie-touch-motion.ts',{'@novame/domain':domain,'./squishy-toy-motion':toy});
const geometry={baseX:256,baseY:512,headWidth:202,scale:.7,bounds:[106,13,406,512]};
test('Touch Note transport authority is separate from economic identity and history Plus, with strict old-server fallback',()=>{
 assert.equal(domain.touchSendAllowed(null),false);
 assert.equal(domain.touchSendAllowed({sameDomain:true,hasPlus:false}),true);
 assert.equal(domain.touchSendAllowed({sameDomain:false,hasPlus:false}),false);
 assert.equal(domain.touchSendAllowed({sameDomain:false,sendAllowed:true,hasPlus:false}),true);
 assert.equal(domain.touchSendAllowed({sameDomain:true,sendAllowed:false,hasPlus:true}),false);
 assert.equal(domain.touchSendAllowed({sameDomain:false,sendAllowed:'true',hasPlus:false}),false);
 assert.equal(domain.touchSendHasPlus({sameDomain:false,hasPlus:false,sendHasPlus:true}),true);
 assert.equal(domain.touchSendHasPlus({sameDomain:true,hasPlus:true,sendHasPlus:false}),false);
 assert.equal(domain.touchSendHasPlus({sameDomain:true,hasPlus:true}),true);
});
test('existing v2 GET forwards the separate transport/allowance fields without rewriting economic identity',async()=>{
 const meta={version:2,sameDomain:false,sendAllowed:true,sendHasPlus:false,hasPlus:false,remaining:1,items:[]};
 const calls=[],route=load('apps/api/src/app/api/vnext/plushie-touch/route.js',{
  'next/server':{NextResponse:{json:(body,options)=>({body,...options})}},
  '@/lib/app-major-update':{authenticatedUserId:async()=> 'actor',appMajorUpdateServiceClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return{data:meta};}}),majorUpdateEnabled:async()=>true},
  '@/lib/security-boundary':{securityRateLimit:async()=>{},securityFailure:e=>{throw e;}},'@novame/domain':domain,
 },{URL});
 const response=await route.GET({url:'https://isolated.invalid/api/vnext/plushie-touch?pair='+'a'.repeat(32)+'&v=2'});
 assert.equal(response.body,meta);assert.equal(calls[0].name,'plushie_touch_state_v2');assert.equal(calls[0].args.p_user,'actor');
 assert.equal(response.body.sameDomain,false);assert.equal(response.body.hasPlus,false);
});
test('v2 first down counts once, half-second holds continue without moves; release adds nothing; two fingers share one clock',()=>{
 const r=recorder.createTouchRecorder(null,2);r.input([0,0,9,500,500]);assert.equal(r.touches,1);
 r.advance(499);assert.equal(r.touches,1);r.advance(500);assert.equal(r.touches,2);
 r.input([550,0,10,500,500]);r.input([600,1,10,700,500]);r.advance(1000);assert.equal(r.touches,3);
 r.input([1100,2,9,600,500]);r.advance(1500);assert.equal(r.touches,4);r.input([1501,2,10,700,500]);assert.equal(r.touches,4);
 r.input([2000,4,0,0,0]);assert.equal(r.touches,5);const c=r.finishElapsed(60000);assert.ok(domain.validateTouchClip(c));assert.equal(c.touches,5);assert.equal(c.version,2);
});
test('v2 checkpoint closes only its disk copy; killed restore preserves held-count history and excludes background time',()=>{
 const r=recorder.createTouchRecorder(null,2);r.input([0,0,9,500,500]);const checkpoint=r.checkpoint(1750);
 assert.equal(checkpoint.touches,4);assert.ok(recorder.validTouchCheckpoint(checkpoint));r.advance(2500);assert.equal(r.touches,6);
 const restored=recorder.createTouchRecorder(JSON.parse(JSON.stringify(checkpoint)),2);restored.advance(50000);assert.equal(restored.touches,4);
 restored.input([2000,0,12,500,500]);restored.input([2500,2,12,500,500]);assert.equal(restored.touches,6);
 assert.equal(restored.finishElapsed(59999),null);assert.ok(domain.validateTouchClip(restored.finishElapsed(60000)));
});
test('v2 continuous hold completes with 120, cap stays valid and event/byte budgets remain bounded',()=>{
 const hold=recorder.createTouchRecorder(null,2);hold.input([0,0,42,500,500]);const c=hold.finishElapsed(60000);assert.equal(c.touches,120);assert.ok(domain.validateTouchClip(c));
 const r=recorder.createTouchRecorder(null,2);for(let i=0;i<2000;i++)r.input([i*20,4,0,0,0]);const max=r.finishElapsed(60000);assert.equal(max.touches,999);assert.ok(domain.validateTouchClip(max));
 assert.equal(domain.validateTouchClip({version:2,durationMs:60000,touches:2,events:[[0,4,0,0,0],[60000,5,0,0,0]]}),false);
});
test('paused playback freezes cursor, count, elapsed and haptics; Continue rebases time, Replay starts zero',()=>{
 const clip={version:2,durationMs:60000,touches:5,events:[[0,0,0,500,500],[1999,2,0,500,500],[3000,4,0,0,0]]};assert.ok(domain.validateTouchClip(clip));
 const s=play.createTouchPlayback('full'),m=toy.createToyMotion(geometry);play.advanceTouchPlayback(s,m,clip,1000,0,false);play.advanceTouchPlayback(s,m,clip,2000,16,false);
 assert.equal(s.count,3);play.pauseTouchPlayback(s,true);const frozen=JSON.stringify(s);
 const p=play.advanceTouchPlayback(s,m,clip,90000,88000,false);assert.equal(JSON.stringify(s),frozen);assert.equal(p.pulse,false);
 play.pauseTouchPlayback(s,false);play.advanceTouchPlayback(s,m,clip,100000,0,false);assert.equal(s.elapsed,1000);
 play.advanceTouchPlayback(s,m,clip,101000,16,false);assert.equal(s.elapsed,2000);assert.equal(s.count,4);
 play.advanceTouchPlayback(s,m,clip,159000,16,false);assert.equal(s.done,true);assert.equal(s.count,5);
 const fresh=play.createTouchPlayback('full');assert.equal(fresh.elapsed,0);assert.equal(fresh.count,0);assert.equal(fresh.cursor,0);
});
test('Detailed auto falls to Standard only, never Light; unknown/critical memory and Reduce Motion choose Standard',async()=>{
 const runtime=load('apps/mobile/src/lib/touch-note-runtime.ts',{'expo':{requireOptionalNativeModule:()=>null},'react-native':{Platform:{OS:'ios',isPad:false}},'./storage':{storage:{getString(){},set(){}}},'../shared/storage/keys':{kTouchVibrationVerified:{name:'verified'}},'./interaction-preferences':{getInteractionPreferences:()=>({haptics:true})},'./haptics':{haptics:{touchPulse:async()=>true}}});
 const good={availableBytes:200*1024*1024,lowMemory:false};assert.equal(runtime.touchInitialQuality(good),'full');
 for(const c of [null,{...good,availableBytes:10},{...good,lowMemory:true},{...good,availableBytes:NaN}])assert.equal(runtime.touchInitialQuality(c),'standard');
 assert.equal(runtime.touchInitialQuality(good,true),'standard');assert.equal(await runtime.touchCapabilities(),null);
 const s=play.createTouchPlayback('full'),m=toy.createToyMotion(geometry),clip={version:2,durationMs:60000,touches:1,events:[[0,4,0,0,0]]};
 for(let t=0;t<10000;t+=100)play.advanceTouchPlayback(s,m,clip,t,100,true);assert.equal(s.quality,'standard');assert.equal(s.elapsed,9900);
});
