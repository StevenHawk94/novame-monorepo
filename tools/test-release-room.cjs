const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {domain,layout,screenHarness,status,flush,ReleaseRoomError}=require('./release-room-test-utils.cjs');
const {deferred}=require('./lifecycle-test-utils.cjs');
test('all 400 workbook groups are complete, unique and keep each bubble bound to four distinct replies',()=>{
 let count=0;
 for(const m of domain.RELEASE_ROOM_MONSTERS){
  const rows=domain.RELEASE_ROOM_DIALOGUES[m.id];assert.equal(rows.length,50);count+=rows.length;
  assert.equal(new Set(rows.map(r=>r.monster)).size,50);
  rows.forEach((r,i)=>{assert.equal(r.id,'r'+String(i+1).padStart(2,'0'));assert.equal(r.replies.length,4);assert.equal(new Set(r.replies).size,4);assert.ok(r.replies.every(x=>x.trim()));});
  assert.equal(domain.releaseDialogue(m.id,0),rows[0]);assert.equal(domain.releaseDialogue(m.id,49),rows[49]);assert.equal(domain.releaseDialogue(m.id,50),rows[0]);
  assert.equal(domain.releaseDialogue(m.id,501),rows[1]);assert.equal(domain.RELEASE_VICTORY_COPY[m.id].length,5);
  for(let n=0;n<151;n++)assert.equal(domain.releaseDialogue(m.id,n),rows[n%50]);
  assert.equal(domain.releaseVictoryCopy(m.id,1),domain.releaseVictoryCopy(m.id,6));
 }
 assert.equal(count,400);
});
test('SE and large viewports reserve all four complete buttons without intersecting the shrunken monster or bubble',()=>{
 for(const [width,height,top,bottom]of [[320,568,20,0],[375,667,20,0],[390,844,47,34],[430,932,59,34],[360,740,24,24]])for(const font of [1,1.2,1.3]){
  const l=layout.releaseRoomLayout(width,height,top,bottom,font);
  assert.ok(l.buttonHeight>=60*font);assert.ok(l.panelHeight>=24+36+4*l.buttonHeight+4*l.optionGap);
  assert.equal(l.arenaHeight+l.instructionHeight,l.usable);assert.equal(l.finalArenaHeight+l.panelHeight,l.usable);
  assert.ok(l.finalBubbleTop>=0);
  assert.ok(Math.abs(l.finalBodyTop-l.finalBubbleTop-l.bubbleHeight-layout.RELEASE_DIALOGUE_TAIL_HEIGHT-16)<1e-8,'tail-to-body gap must stay fixed');
  assert.ok(l.finalBodyTop+l.finalBodyHeight<=l.finalArenaHeight,JSON.stringify({width,height,font,l}));
  assert.ok(Math.abs(l.finalBubbleTop-(l.finalArenaHeight-l.finalBodyTop-l.finalBodyHeight))<1e-8,'dialogue and body are centred as one group');
 }
});
test('last tame timestamps use the viewer timezone and never invent a last time for a zero count',()=>{
 assert.equal(layout.releaseLastTamed(null,'UTC'),'No history');
 assert.match(layout.releaseLastTamed('2026-10-14T01:00:00Z','America/Los_Angeles',Date.parse('2026-10-14T02:00:00Z')),/^Today, 6:00 PM$/);
});
async function fight(h){await flush();h.press('View Overthinking');h.press('Start');await flush();h.render();const hit=h.find(n=>n.type==='Swipe').props.onHit;for(let i=0;i<25;i++)hit();h.render();}
test('room shows eight correctly named monsters, top-anchored proportional background, and current-couple statistics',async()=>{
 const snap=status();snap.monsters.find(m=>m.id==='overthinking').tamedCount=7;snap.monsters.find(m=>m.id==='overthinking').partnerTamedCount=10;
 const h=screenHarness({status:snap});await flush();
 assert.equal(h.all().filter(n=>/^View /.test(n.props?.accessibilityLabel??'')).length,8);
 assert.ok(h.all().some(n=>n.props?.children==='Release Room'));
 const bg=h.find(n=>n.type==='Image'&&n.props.source===100);assert.equal(bg.props.style.top,0);assert.equal(bg.props.style.height,375*1870/841);
 h.press('View Overthinking');assert.ok(h.all().some(n=>n.props?.children==='Alex'));assert.ok(h.all().some(n=>n.props?.children==='Morgan'));
 assert.ok(h.all().some(n=>n.props?.children===7));assert.ok(h.all().some(n=>n.props?.children===10));h.h.unmount();
});
test('rapid swipes stop at 20, correct next dialogue appears, double reply cannot submit twice',async()=>{
 const h=screenHarness();await fight(h);
 assert.equal(h.find(n=>n.type==='Swipe').props.enabled,false);
 const row=domain.releaseDialogue('overthinking',0);assert.ok(h.all().some(n=>n.props?.children===row.monster));
 for(let i=0;i<4;i++)assert.ok(h.all().some(n=>n.props?.accessibilityLabel===`Reply ${i+1}: ${row.replies[i]}`));
 const reply=h.find(n=>n.props?.accessibilityLabel===`Reply 1: ${row.replies[0]}`).props.onPress;
 reply();reply();assert.equal(h.calls.filter(x=>typeof x==='object').length,1);assert.equal(h.calls[0].dialogueId,'r01');assert.equal(h.calls[0].choice,0);
 h.h.unmount();
});
for(const order of ['heart-first','receipt-first'])test(`Victory follows the heart, never waits for a network receipt (${order})`,async()=>{
 const h=screenHarness();await fight(h);h.find(n=>/^Reply 1:/.test(n.props?.accessibilityLabel??'')).props.onPress();
 const finish=h.find(n=>n.type==='Lottie').props.onAnimationFinish;
 if(order==='heart-first')finish(false);else {h.complete();await flush();}
 h.render();h.render();assert.equal(h.all().some(n=>n.props?.children==='Victory'),order==='heart-first');assert.equal(h.rewards.length,order==='heart-first'?1:0);
 if(order==='heart-first'){h.complete();await flush();}else finish(false);
 h.render();h.render();assert.ok(h.all().some(n=>n.props?.children==='Victory'));
 assert.equal(h.all().filter(n=>n.type==='Confetti').length,1);assert.deepEqual(h.rewards,['release-ui:fixed-key']);
 h.blur();h.focus();h.render();assert.equal(h.rewards.length,1);h.press('Done');assert.ok(h.all().some(n=>n.props?.children==='Release Room'));h.h.unmount();
});
test('an ambiguous network failure keeps optimistic Victory and allows Done without a saving overlay',async()=>{
 const calls=[];
 const h=screenHarness({submit:async attempt=>{calls.push(attempt);throw Error('network');}});
 await fight(h);h.find(x=>/^Reply 3:/.test(x.props?.accessibilityLabel??'')).props.onPress();h.find(x=>x.type==='Lottie').props.onAnimationFinish(false);
 await flush();h.render();assert.equal(h.all().some(x=>x.props?.children==='Victory'),true);assert.deepEqual(h.rewards,['release-ui:fixed-key']);
 assert.equal(h.all().some(x=>x.type==='ActivityIndicator'||/Saving your progress|Retry saving/.test(String(x.props?.children??''))),false);
 h.press('Done');assert.equal(calls.length,1);assert.equal(h.all().some(x=>x.props?.accessibilityRole==='summary'),true);h.h.unmount();
});
test('local durable-write failure never celebrates or submits; the reply remains available for retry',async()=>{
 const h=screenHarness({storageFail:true});await fight(h);h.find(x=>/^Reply 1:/.test(x.props?.accessibilityLabel??'')).props.onPress();h.render();
 assert.equal(h.calls.length,0);assert.equal(h.rewards.length,0);assert.equal(h.all().some(x=>x.props?.children==='Victory'),false);
 assert.ok(h.all().some(x=>/couldn’t be saved on this device/.test(String(x.props?.children??''))));assert.equal(h.find(x=>/^Reply 1:/.test(x.props?.accessibilityLabel??'')).props.disabled,false);h.h.unmount();
});
test('definitive quota rejection corrects the optimistic state; a late receipt never reopens a finished flow',async()=>{
 const rejected=screenHarness({submit:async()=>{throw new ReleaseRoomError('daily_limit_reached',status({tamesToday:1}));}});
 await fight(rejected);rejected.find(n=>/^Reply 1:/.test(n.props?.accessibilityLabel??'')).props.onPress();await flush();rejected.render();
 assert.equal(rejected.all().some(n=>n.props?.accessibilityRole==='summary'),true);assert.equal(rejected.rewards.length,0);rejected.h.unmount();
 const h=screenHarness();await fight(h);h.find(n=>/^Reply 1:/.test(n.props?.accessibilityLabel??'')).props.onPress();h.find(n=>n.type==='Lottie').props.onAnimationFinish(false);h.render();h.press('Done');
 h.complete();await flush();h.render();assert.equal(h.all().some(n=>n.props?.children==='Victory'),false);assert.equal(h.rewards.length,1);assert.equal(h.paths.length,0);h.h.unmount();
});
for(const paid of [false,true])test(`${paid?'Plus':'Free'} daily exhaustion is separate from unlimited content cycles`,async()=>{
 const h=screenHarness({status:status({hasPlus:paid,dailyLimit:paid?2:1,tamesToday:paid?2:1})});await flush();
 assert.ok(h.all().some(x=>x.props?.accessibilityRole==='summary'));assert.equal(h.all().some(x=>x.type==='Swipe'),false);
 assert.equal(h.all().some(x=>x.props?.accessibilityLabel==='Start'),false);
 assert.equal(h.calls.length,0);assert.equal(h.all().some(x=>x.props?.accessibilityLabel==='Try Plus'),!paid);
 if(!paid){h.press('Try Plus');assert.deepEqual(h.paths,['/(main)/(modals)/subscription-paywall']);}h.h.unmount();
});
test('Plus can select the same monster for a second run, and group 50 wraps to group 1 without a lifetime lock',async()=>{
 const snap=status({hasPlus:true,dailyLimit:2,tamesToday:1});snap.monsters.find(x=>x.id==='overthinking').tamedCount=50;
 const h=screenHarness({status:snap});await fight(h);assert.ok(h.all().some(x=>x.props?.children===domain.releaseDialogue('overthinking',0).monster));h.h.unmount();
});
test('a missing heart finish callback cannot fake a successful victory, even after background time',async()=>{
 const h=screenHarness();await fight(h);h.find(x=>/^Reply 1:/.test(x.props?.accessibilityLabel??'')).props.onPress();h.complete();await flush();
 h.background();h.time.advance(10000);h.render();assert.equal(h.rewards.length,0);
 h.foreground();h.time.advance(3503);h.render();h.render();assert.equal(h.rewards.length,0);
 h.find(n=>n.type==='Lottie').props.onAnimationFinish(false);h.render();h.render();assert.equal(h.rewards.length,1);h.h.unmount();
});
test('confirmed Start is immediate; late background statistics cannot change the battle after blur/unmount',async()=>{
 for(const event of ['blur','unmount']){
  const gate=deferred(),h=screenHarness({read:(n,snapshot)=>n===1?snapshot:gate.promise});await flush();h.press('View Overthinking');h.press('Start');
  if(event==='blur')h.blur();else h.h.unmount();gate.resolve(status());await flush();
  if(event==='blur'){assert.equal(h.find(x=>x.type==='Swipe').props.enabled,false);h.h.unmount();}
  assert.equal(h.calls.length,0);
 }
});
test('retired battle link mounts only the current Release Room',()=>{
 const source=fs.readFileSync('apps/mobile/app/(main)/tame-enemy.tsx','utf8');
 assert.match(source, /return <ReleaseRoomScreen\s*\/>/); assert.doesNotMatch(source, /LegacyTameEnemyScreen|useMajorUpdateEnabled/);
});
test('unpaired prep keeps two equal cards, shared self avatar and explicit unknown partner with no history',async()=>{
 const h=screenHarness({solo:true});await flush();h.press('View Overthinking');
 assert.ok(h.all().some(n=>n.props?.children==='Not paired yet'));assert.ok(h.all().some(n=>n.props?.children==='?'));
 assert.equal(h.all().filter(n=>n.props?.children==='No history').length,2);
 const image=h.find(n=>n.type==='UserAvatar');assert.equal(image.props.name,'Alex');assert.equal(image.props.avatarUrl,null);
 const prep=h.find(n=>n.type==='ScrollView'&&n.props.contentContainerStyle?.some?.(style=>style?.paddingTop===54));assert.ok(prep);
 h.h.unmount();
});
test('confirmed cached exhaustion is shown immediately before any HTTP result or Start tap',()=>{
 for(const paid of [false,true]){
  const cached=status({hasPlus:paid,dailyLimit:paid?2:1,tamesToday:paid?2:1});
  const h=screenHarness({cached,read:()=>new Promise(()=>{})});
  assert.ok(h.all().some(n=>n.props?.accessibilityRole==='summary'));
  assert.equal(h.all().some(n=>n.props?.accessibilityLabel==='View Overthinking'),false);assert.equal(h.calls.length,0);h.h.unmount();
 }
});
test('expired quota plus a failed new-day read exposes Retry instead of trapping the room in loading',async()=>{
 let offline=true;
 const h=screenHarness({cached:status({localDate:'2026-10-13',tamesToday:1}),read:(_n,snapshot)=>offline?Promise.reject(Error('offline')):snapshot});
 await flush();h.render();
 assert.ok(h.all().some(n=>n.props?.accessibilityRole==='alert'));
 assert.equal(h.all().some(n=>n.props?.accessibilityLabel==='View Overthinking'),false);
 offline=false;h.press('Retry progress');await flush();h.render();
 assert.ok(h.all().some(n=>n.props?.accessibilityLabel==='View Overthinking'));h.h.unmount();
});
test('both battle panels cover the bottom safe area; the initial monster is exactly 20 percent smaller',async()=>{
 const h=screenHarness({width:390,height:844,top:47,bottom:34});await fight(h);
 const panel=h.find(n=>n.type==='View'&&n.props.style?.some?.(s=>s?.height===layout.releaseRoomLayout(390,844,47,34).panelHeight+34));assert.ok(panel);
 const root=h.render();assert.equal(root.props.style[1].paddingBottom,0);
 const l=layout.releaseRoomLayout(390,844,47,34);assert.equal(l.battleSize,Math.min(390*.78,l.arenaHeight-116,340)*.8);
 assert.ok(l.hpTop>=l.monsterTop+l.battleSize);assert.ok(l.hpTop+30<=l.arenaHeight);
 h.h.unmount();
});
test('heart ends before popup/confetti; coins require completed popup motion, not merely layout',async()=>{
 const h=screenHarness({manualLayout:true,manualMotion:true});await fight(h);h.find(n=>/^Reply 1:/.test(n.props?.accessibilityLabel??'')).props.onPress();
 assert.equal(h.find(n=>n.type==='Lottie').props.speed,1);
 h.complete();await flush();h.find(n=>n.type==='Lottie').props.onAnimationFinish(false);h.render();h.render();
 assert.equal(h.rewards.length,0);assert.equal(h.all().filter(n=>n.type==='Confetti').length,1);
 h.find(n=>n.props?.accessibilityLabel==='Victory dialog').props.onLayout();h.render();h.render();assert.equal(h.rewards.length,0);
 assert.equal(h.animations.at(-1).config.duration,280);h.finishPopup();h.render();assert.equal(h.rewards.length,1);
 h.blur();h.focus();h.render();assert.equal(h.rewards.length,1);h.h.unmount();
});
test('focused prep refreshes partner count and last-tamed time without leaving the room',async()=>{
 const h=screenHarness();await flush();h.press('View Overthinking');await flush();h.render();
 const updated=status({serverNow:'2026-10-14T12:01:00Z'});
 Object.assign(updated.monsters.find(m=>m.id==='overthinking'),{partnerTamedCount:17,partnerLastTamedAt:'2026-10-14T12:01:00Z'});
 h.setStatus(updated);h.time.advance(5000);await flush();h.render();
 assert.ok(h.all().some(n=>n.props?.children===17));
 assert.ok(h.all().some(n=>typeof n.props?.children==='string'&&n.props.children.includes('12:01 PM')));h.h.unmount();
});
test('background and blur pause statistics reads; foreground and refocus immediately revalidate',async()=>{
 const h=screenHarness();await flush();h.press('View Overthinking');await flush();h.render();
 h.background();const paused=h.fetchCount();h.time.advance(60000);await flush();assert.equal(h.fetchCount(),paused);
 const updated=status({serverNow:'2026-10-14T12:02:00Z'});updated.monsters.find(m=>m.id==='overthinking').partnerTamedCount=19;h.setStatus(updated);
 h.foreground();await flush();h.render();assert.equal(h.fetchCount(),paused+1);assert.ok(h.all().some(n=>n.props?.children===19));
 h.blur();const blurred=h.fetchCount();h.time.advance(60000);await flush();assert.equal(h.fetchCount(),blurred);
 h.focus();await flush();h.render();assert.equal(h.fetchCount(),blurred+1);h.h.unmount();
});
test('slow prep polling never overlaps itself; cleanup cancels reads and rejects late responses',async()=>{
 const gate=deferred();let slow=false;const signals=[];
 const h=screenHarness({read:(_n,snapshot,signal)=>{signals.push(signal);return slow?gate.promise:snapshot;}});
 await flush();h.press('View Overthinking');await flush();h.render();slow=true;
 const before=h.fetchCount();h.time.advance(5000);await flush();assert.equal(h.fetchCount(),before+1);
 h.time.advance(60000);await flush();assert.equal(h.fetchCount(),before+1);
 h.background();assert.equal(signals.at(-1).aborted,true);
 const stale=status({serverNow:'2026-10-14T12:03:00Z'});stale.monsters.find(m=>m.id==='overthinking').partnerTamedCount=23;
 gate.resolve(stale);await flush();h.render();assert.equal(h.all().some(n=>n.props?.children===23),false);h.h.unmount();
 const after=h.fetchCount();h.time.advance(60000);await flush();assert.equal(h.fetchCount(),after);
});
test('statistics refresh failure preserves known counts and the next poll recovers',async()=>{
 let offline=false;const snap=status();snap.monsters.find(m=>m.id==='overthinking').partnerTamedCount=31;
 const h=screenHarness({status:snap,read:(_n,snapshot)=>offline?Promise.reject(Error('offline')):snapshot});
 await flush();h.press('View Overthinking');await flush();h.render();offline=true;
 h.time.advance(5000);await flush();h.render();assert.ok(h.all().some(n=>n.props?.children===31));
 assert.equal(h.all().some(n=>n.props?.accessibilityRole==='alert'),false);
 offline=false;const recovered=status({serverNow:'2026-10-14T12:04:00Z'});recovered.monsters.find(m=>m.id==='overthinking').partnerTamedCount=32;h.setStatus(recovered);
 h.time.advance(5000);await flush();h.render();assert.ok(h.all().some(n=>n.props?.children===32));assert.equal(h.calls.length,0);h.h.unmount();
});
test('background refresh cannot change active dialogue, consume quota or interfere with settlement',async()=>{
 const h=screenHarness();await fight(h);const before=h.fetchCount(),row=domain.releaseDialogue('overthinking',0);
 const updated=status({serverNow:'2026-10-14T12:05:00Z'});updated.monsters.find(m=>m.id==='overthinking').tamedCount=49;h.setStatus(updated);
 h.background();h.foreground();h.time.advance(60000);await flush();h.render();assert.equal(h.fetchCount(),before);
 assert.ok(h.all().some(n=>n.props?.children===row.monster));
 h.find(n=>/^Reply 1:/.test(n.props?.accessibilityLabel??'')).props.onPress();h.complete();await flush();h.render();
 assert.equal(h.rewards.length,0);h.find(n=>n.type==='Lottie').props.onAnimationFinish(false);h.render();h.render();
 assert.deepEqual(h.rewards,['release-ui:fixed-key']);assert.equal(h.calls.filter(x=>typeof x==='object').length,1);h.h.unmount();
});
test('Start cancels an older poll; late polling cannot override the fresh battle or group 50',async()=>{
 const gate=deferred(),signals=[];let mode='normal';
 const fresh=status({serverNow:'2026-10-14T12:06:00Z'});fresh.monsters.find(m=>m.id==='overthinking').tamedCount=49;
 const h=screenHarness({status:fresh,read:(_n,snapshot,signal)=>{signals.push(signal);return mode==='slow'?gate.promise:snapshot;}});
 await flush();h.press('View Overthinking');await flush();h.render();mode='slow';
 h.time.advance(5000);await flush();const oldSignal=signals.at(-1);assert.equal(oldSignal.aborted,false);
 mode='normal';h.setStatus(fresh);
 h.press('Start');assert.equal(oldSignal.aborted,true);await flush();h.render();
 gate.resolve(status());await flush();h.render();
 const hit=h.find(n=>n.type==='Swipe').props.onHit;for(let i=0;i<20;i++)hit();h.render();
 assert.ok(h.all().some(n=>n.props?.children===domain.releaseDialogue('overthinking',49).monster));h.h.unmount();
});
test('cancelled heart callbacks and elapsed time cannot release coins; a real finish needs no receipt',async()=>{
 const h=screenHarness();await fight(h);h.find(n=>/^Reply 1:/.test(n.props?.accessibilityLabel??'')).props.onPress();
 h.find(n=>n.type==='Lottie').props.onLayout({nativeEvent:{layout:{width:300,height:300}}});h.render();
 h.find(n=>n.type==='Lottie').props.onAnimationFinish(true);h.time.advance(3502);h.render();h.render();assert.equal(h.rewards.length,0);
 h.time.advance(1);h.render();h.render();assert.equal(h.rewards.length,0);
 h.find(n=>n.type==='Lottie').props.onAnimationFinish(false);h.render();h.render();assert.equal(h.rewards.length,1);
 h.complete();await flush();h.render();h.render();assert.equal(h.rewards.length,1);h.h.unmount();
});
test('hidden screens cannot execute a captured Start; late reads do not launch a battle after returning',async()=>{
 for(const mode of ['blur','background']){
  const gate=deferred();let delay=false;
  const h=screenHarness({read:(_n,snapshot)=>delay?gate.promise:snapshot});
  await flush();h.press('View Overthinking');await flush();h.render();delay=true;
  const start=h.find(n=>n.props?.accessibilityLabel==='Start').props.onPress;
  if(mode==='blur')h.blur();else h.background();
  start();if(mode==='blur')h.focus();else h.foreground();
  gate.resolve(status());await flush();h.render();
  assert.equal(h.all().some(n=>n.type==='Swipe'),false);assert.equal(h.calls.length,0);h.h.unmount();
 }
});
