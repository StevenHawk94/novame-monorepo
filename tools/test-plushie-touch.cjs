const {test}=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./lifecycle-test-utils.cjs');
const contract=load('packages/domain/src/plushie-touch.ts');
const warp=load('apps/mobile/src/lib/burrow-toy-warp.ts');
const motion=load('apps/mobile/src/lib/squishy-toy-motion.ts',{'./burrow-toy-warp':warp});
const playback=load('apps/mobile/src/lib/plushie-touch-motion.ts',{'./squishy-toy-motion':motion,'@novame/domain':contract});
const geometry={baseX:256,baseY:512,headWidth:202,scale:.7,bounds:[106,13,406,512]};
const dense=()=>({version:1,durationMs:60000,touches:999,events:Array.from({length:999},(_,i)=>[Math.floor(i*60000/999),i%2?4:5,0,0,0])});
test('wire format preserves timing, bounded coordinates, real action counts; malformed/reordered/fake counts rejected',()=>{
 const c={version:1,durationMs:60000,touches:2,events:[[0,0,0,500,500],[34,1,0,600,700],[200,2,0,600,700],[300,4,0,0,0]]};
 assert.equal(contract.validateTouchClip(c),true);
 for(const patch of [{durationMs:59999},{touches:999},{events:[[1,4,0,0,0]]},{events:[[0,2,0,0,0]]},
  {events:[[0,0,0,500,500]]},{events:[[0,0,0,1001,500],[1,2,0,0,0]]},{events:[[0,4,0,0,0],[60001,4,0,0,0]]}])assert.equal(contract.validateTouchClip({...c,...patch}),false);
});
for(const quality of ['full','standard','light'])test(`${quality}: full minute, same timeline/count, pooled motion and haptic rate limit; no reward integration`,()=>{
 const c=dense();assert.ok(contract.validateTouchClip(c));const state=playback.createTouchPlayback(quality),m=motion.createToyMotion(geometry);let pulses=0,last=-1000,finished=0;
 for(let t=0;t<=60000;t+=10){const r=playback.advanceTouchPlayback(state,m,c,t,10,false);if(r.pulse){assert.ok(t-last>=140);last=t;pulses++;}if(r.finished)finished++;if(m.active)motion.advanceToyMotion(m,10);}
 assert.equal(state.count,999);assert.equal(state.done,true);assert.equal(finished,1);assert.ok(pulses<430);assert.equal(m.touches.length,0);
 assert.equal(playback.advanceTouchPlayback(state,m,c,61000,1000).pulse,false);assert.ok(m.rubs.length<=4&&m.pulls.length<=4&&m.particles.length===12);
});
test('adaptive degradation preserves monotonic cursor/count/time and never replays old haptics after a stall',()=>{
 const c=dense(),s=playback.createTouchPlayback('full'),m=motion.createToyMotion(geometry);
 let prev=0;for(let t=0;t<=6000;t+=60){const r=playback.advanceTouchPlayback(s,m,c,t,60,true);assert.ok(s.count>=prev);prev=s.count;}
 assert.equal(s.quality,'standard');assert.equal(s.at,0);const count=s.count,cursor=s.cursor;
 const late=playback.advanceTouchPlayback(s,m,c,20000,14000,true);assert.ok(s.cursor>cursor);assert.ok(s.count>=count);assert.equal(late.pulse,false);
 assert.equal(s.at,0);assert.equal(s.quality,'standard');assert.equal(m.touches.length,0);
});
test('very low FPS also degrades instead of waiting forever for twenty samples inside a 1.5 second window',()=>{
 const s=playback.createTouchPlayback('full'),m=motion.createToyMotion(geometry);for(let t=0;t<=7000;t+=1000)playback.advanceTouchPlayback(s,m,dense(),t,1000,true);
 assert.equal(s.quality,'standard');assert.equal(s.at,0);assert.ok(s.count>0);
});
test('shared realtime transport has one owner; scoped touch subscribers cannot tear it down or notify another account',()=>{
 const fs=require('node:fs'),signals=load('apps/mobile/src/lib/plushie-touch-signals.ts');let a=0,b=0;
 const off=signals.subscribePlushieTouchSignal('A',()=>a++);signals.subscribePlushieTouchSignal('A',()=>{throw Error();});signals.subscribePlushieTouchSignal('B',()=>b++);
 signals.notifyPlushieTouchSignal('A');assert.equal(a,1);assert.equal(b,0);off();signals.notifyPlushieTouchSignal('A');assert.equal(a,1);
 const gate=fs.readFileSync('apps/mobile/src/components/burrow/plushie-touch-sync-gate.tsx','utf8');assert.doesNotMatch(gate,/supabase|\.channel\(|removeChannel/);
 const owner=fs.readFileSync('apps/mobile/src/components/burrow/burrow-sync-gate.tsx','utf8');assert.match(owner,/event:'plushie_touch_changed'\},\(\)=>notifyPlushieTouchSignal\(session.userId\)/);
});
test('all gesture types retain approximate coordinates on full only, cancel is not a counted touch',()=>{
 const c={version:1,durationMs:60000,touches:2,events:[[0,0,0,500,500],[40,1,0,750,500],[80,2,0,750,500],[100,0,1,300,300],[120,3,1,300,300],[200,5,0,0,0]]};
 assert.ok(contract.validateTouchClip(c));for(const q of ['full','standard','light']){const s=playback.createTouchPlayback(q),m=motion.createToyMotion(geometry);
  for(let t=0;t<=60000;t+=20)playback.advanceTouchPlayback(s,m,c,t,20,false);assert.equal(s.count,2);assert.equal(s.done,true);}
});
test('a long pull vibrates at first contact, not several seconds later at release; counter still commits on completed touch',()=>{
 const c={version:1,durationMs:60000,touches:1,events:[[0,0,0,500,500],[1000,1,0,800,500],[4000,2,0,800,500]]};
 for(const q of ['full','standard','light']){const s=playback.createTouchPlayback(q),m=motion.createToyMotion(geometry);
  const first=playback.advanceTouchPlayback(s,m,c,100,16,false);assert.equal(first.pulse,true);assert.equal(first.count,0);
  const end=playback.advanceTouchPlayback(s,m,c,4100,16,false);assert.equal(end.pulse,false);assert.equal(end.count,1);}
});
test('wire schema rejects added content/NaN and uses the same jsonb whitespace byte budget as SQL',()=>{
 assert.equal(contract.validateTouchClip({...dense(),secret:'private'}),false);
 assert.equal(contract.validateTouchClip({...dense(),touches:NaN}),false);
 const events=[[0,0,0,500,500],...Array.from({length:8189},(_,i)=>[i+1,1,0,2000,-1000]),[59999,2,0,2000,-1000]];
 const c={version:1,durationMs:60000,touches:1,events};
 assert.equal(contract.validateTouchClip(c),JSON.stringify(c).replace(/[:,]/g,'$& ').length<=262144);
});
test('simultaneous held fingers and button at the 999 cap cannot invalidate a full recording',()=>{
 const {createTouchRecorder}=load('apps/mobile/src/lib/plushie-touch-recorder.ts',{'@novame/domain':contract});const r=createTouchRecorder();
 for(let i=0;i<998;i++)r.input([i,4,0,0,0]);r.input([1000,0,4,500,500]);r.input([1001,0,5,600,500]);r.input([1002,5,0,0,0]);
 r.input([1003,2,4,500,500]);r.input([1004,2,5,600,500]);const c=r.finish(60000);assert.equal(c.touches,999);assert.ok(contract.validateTouchClip(c));
});
test('recorder requires full 60 seconds; movement sampling does not inflate counts, cancelled touches do not count',()=>{
 const {createTouchRecorder}=load('apps/mobile/src/lib/plushie-touch-recorder.ts',{'@novame/domain':contract});
 const r=createTouchRecorder();assert.equal(r.finish(60000),null);
 r.input([1000,0,10,500,500]);r.input([1005,1,10,510,510]);r.input([1040,1,10,550,550]);r.input([1100,2,10,550,550]);
 r.input([1200,0,11,200,200]);r.input([1300,3,11,200,200]);assert.equal(r.finish(60999),null);
 const c=r.finish(61000);assert.equal(c.touches,1);assert.equal(contract.validateTouchClip(c),true);assert.equal(c.events[0][0],0);
});
test('held fingers are cancelled at 60 seconds; explicitly revoked session cannot be sent',()=>{
 const {createTouchRecorder}=load('apps/mobile/src/lib/plushie-touch-recorder.ts',{'@novame/domain':contract});
 const r=createTouchRecorder();r.input([100,4,0,0,0]);r.input([200,0,12,300,400]);
 const c=r.finish(60100);assert.equal(c.touches,1);assert.equal(c.events.at(-1)[1],3);assert.equal(contract.validateTouchClip(c),true);
 const a=createTouchRecorder();a.input([0,4,0,0,0]);a.interrupt();assert.equal(a.finish(60000),null);
});
test('foreground interruptions pause rather than discard; remount restores elapsed/count/closed pointers on the same logical timeline',()=>{
 const {createTouchRecorder,validTouchCheckpoint}=load('apps/mobile/src/lib/plushie-touch-recorder.ts',{'@novame/domain':contract});
 const a=createTouchRecorder();a.input([0,4,0,0,0]);a.input([100,0,12,300,400]);a.pause(19000);
 const disk=JSON.parse(JSON.stringify(a.checkpoint(19000)));assert.equal(validTouchCheckpoint(disk),true);assert.equal(disk.events.at(-1)[1],3);
 const b=createTouchRecorder(disk);b.input([20000,0,98,600,700]);b.input([20100,2,98,600,700]);
 assert.equal(b.finishElapsed(59999),null);const final=b.finishElapsed(60000);
 assert.equal(final.touches,2);assert.equal(final.events[0][0],0);assert.equal(final.events.at(-1)[0],20100);assert.ok(contract.validateTouchClip(final));
});
test('checkpoint does not cancel the live held touch; kill recovery does not count a cancelled/unfinished touch',()=>{
 const {createTouchRecorder,validTouchCheckpoint}=load('apps/mobile/src/lib/plushie-touch-recorder.ts',{'@novame/domain':contract});
 const a=createTouchRecorder();a.input([0,0,12,300,400]);const disk=a.checkpoint(1000);assert.ok(validTouchCheckpoint(disk));
 a.input([2000,2,12,500,500]);assert.equal(a.finishElapsed(60000).touches,1);
 const b=createTouchRecorder(disk);b.input([1200,4,0,0,0]);assert.equal(b.finishElapsed(60000).touches,1);
 assert.equal(createTouchRecorder(disk).finishElapsed(60000),null);
 for(const value of [null,{}, {...disk,events:[null]}, {...disk,elapsedMs:NaN},{...disk,touches:5},{...disk,events:[[0,2,0,0,0]]}])assert.equal(validTouchCheckpoint(value),false);
});
test('completed checkpoint survives restart before completion draft write; fake short clip cannot be sent',()=>{
 const {createTouchRecorder}=load('apps/mobile/src/lib/plushie-touch-recorder.ts',{'@novame/domain':contract});
 const a=createTouchRecorder();a.input([0,5,0,0,0]);const disk=a.checkpoint(60000),b=createTouchRecorder(disk);
 assert.ok(contract.validateTouchClip(b.finishElapsed(60000)));assert.equal(contract.validateTouchClip({...disk,durationMs:60000}),false);
 assert.deepEqual(JSON.stringify(b.finishElapsed(60000)),JSON.stringify(a.finishElapsed(60000)));
});
test('cancelled gesture flood is bounded without discarding the completed minute or overflowing bytes',()=>{
 const {createTouchRecorder}=load('apps/mobile/src/lib/plushie-touch-recorder.ts',{'@novame/domain':contract}),r=createTouchRecorder();r.input([0,4,0,0,0]);
 for(let i=1;i<12000;i++){r.input([i*2,0,10,1000,1000]);r.input([i*2+1,3,10,2000,-1000]);}
 const c=r.finishElapsed(60000);assert.ok(contract.validateTouchClip(c));assert.equal(c.touches,1);assert.ok(c.events.length<8192);assert.equal(r.interrupted,false);
});
