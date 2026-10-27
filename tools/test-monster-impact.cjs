const {test}=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./lifecycle-test-utils.cjs');
const {screenHarness,domain,flush}=require('./release-room-test-utils.cjs');

test('every impact cancels and restarts a visible rise/hold/fall pulse plus the complete shake on the UI thread',()=>{
 const cancelled=[],shake={value:9},flash={value:.4};
 const motion=load('apps/mobile/src/lib/monster-impact.ts',{'react-native-reanimated':{
  cancelAnimation:value=>cancelled.push(value),ReduceMotion:{Never:'never'},
  withTiming:(to,config)=>({to,...config}),withSequence:(...steps)=>({steps}),
 }});
 for(let hit=0;hit<20;hit++){
  motion.playMonsterImpact(shake,flash);
  assert.deepEqual(shake.value.steps.map(step=>step.to),[-8,8,-5,4,0]);
  assert.deepEqual(flash.value.steps.slice(1).map(step=>[step.to,step.duration]),[[1,24],[1,36],[0,110]]);
  assert.equal(flash.value.steps[0],'never');
  assert.ok(flash.value.steps.slice(1).every(step=>step.reduceMotion==='never'));
 }
 assert.equal(cancelled.length,40);
 motion.resetMonsterImpact(shake,flash);assert.equal(shake.value,0);assert.equal(flash.value,0);assert.equal(cancelled.length,42);
});

test('all eight monsters restart impact on every valid hit, reset on background/blur, and ignore stale callbacks',async()=>{
 for(const monster of domain.RELEASE_ROOM_MONSTERS){
  const h=screenHarness();await flush();h.press('View '+monster.name);h.press('Start');
  const hit=h.find(n=>n.type==='Swipe').props.onHit;
  hit();h.render();assert.equal(h.impacts.filter(name=>name==='playMonsterImpact').length,1);
  h.background();assert.equal(h.impacts.at(-1),'resetMonsterImpact');hit();h.render();
  assert.equal(h.impacts.filter(name=>name==='playMonsterImpact').length,1,'no hit while backgrounded');
  h.foreground();for(let i=0;i<19;i++){hit();h.render();}
  assert.equal(h.impacts.filter(name=>name==='playMonsterImpact').length,20);
  hit();h.render();assert.equal(h.impacts.filter(name=>name==='playMonsterImpact').length,20,'no extra hit or reward past zero HP');
  h.blur();assert.equal(h.impacts.at(-1),'resetMonsterImpact');
  h.h.unmount();assert.equal(h.impacts.at(-1),'resetMonsterImpact');assert.equal(h.calls.length,0);
 }
});

test('leaving a partial battle blocks a queued old hit callback after blur and unmount',async()=>{
 const h=screenHarness();await flush();h.press('View Overthinking');h.press('Start');
 const hit=h.find(n=>n.type==='Swipe').props.onHit;hit();h.render();
 // Navigation blur cancels the transient effect before the page is removed.
 h.blur();hit();h.render();assert.equal(h.impacts.filter(name=>name==='playMonsterImpact').length,1);
 h.h.unmount();hit();assert.equal(h.impacts.filter(name=>name==='playMonsterImpact').length,1);
});
