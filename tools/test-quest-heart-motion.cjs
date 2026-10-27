const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {execFileSync}=require('node:child_process');
const {load,hooks,flush}=require('./lifecycle-test-utils.cjs');
const {motionHarness}=require('./motion-test-utils.cjs');
const {screenHarness,domain}=require('./release-room-test-utils.cjs');
const jsx=(type,props,key)=>({type,props,key});
const nativeHeartLayout={nativeEvent:{layout:{width:300,height:300}}};
function barHarness(){
 const h=hooks(),motion=motionHarness(h);
 const {QuestProgress}=load('apps/mobile/src/components/burrow/quest-progress.tsx',{
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},
  'react-native':{View:'View',StyleSheet:{create:x=>x}},'react-native-reanimated':motion.reanimated,
 });
 return{...motion,h,render:(progress,target)=>h.render(()=>QuestProgress({progress,target}))};
}
test('special progress starts at cached ratio, then animates backwards on the native clock without relayout',()=>{
 const b=barHarness();let tree=b.render(10,10);
 assert.equal(b.timings.length,0,'first visit never replays earned progress');
 assert.equal(tree.props.children.props.style[1].transform[0].scaleX,1);
 tree=b.render(10,20);
 assert.equal(b.timings.length,1);assert.equal(b.timings[0].value,.5);
 assert.equal(b.timings[0].config.duration,600);assert.equal(b.timings[0].config.reduceMotion,'system');
 assert.equal(tree.props.children.props.style[1].transform[0].scaleX,1,'keeps the old full bar at animation start');
 assert.equal(tree.props.children.props.style[0].width,'100%');
 assert.equal(tree.props.children.props.style[0].transformOrigin,'left center');
 b.time.advance(599);assert.equal(b.values[0].value,1);b.time.advance(1);
 assert.equal(b.render(10,20).props.children.props.style[1].transform[0].scaleX,.5);
 b.render(10,20);assert.equal(b.timings.length,1,'a server acknowledgement cannot restart the same transition');
 b.h.unmount();assert.equal(b.time.timers.size,0);
});
test('progress smoothly reconciles rollback, overflow, rapid changes and cancels on detach',()=>{
 const b=barHarness();b.render(10,10);b.render(10,20);b.time.advance(100);b.render(10,10);
 assert.equal(b.timings.at(-1).value,1);b.time.advance(600);assert.equal(b.values[0].value,1);
 b.render(7,8);assert.equal(b.timings.at(-1).value,.875);
 b.render(7,6);assert.equal(b.timings.at(-1).value,1,'overflow remains capped');
 b.render(-1,10);assert.equal(b.timings.at(-1).value,0);
 b.h.unmount();assert.equal(b.time.timers.size,0);
 const fresh=barHarness();assert.equal(fresh.render(1,4).props.children.props.style[1].transform[0].scaleX,.25);fresh.h.unmount();
});
test('supplied dotLottie stays local, complete and at its original frame rate without JS failure deadlines',()=>{
 const file='apps/mobile/assets/animations/exploding heart (1).lottie';
 const manifest=JSON.parse(execFileSync('unzip',['-p',file,'manifest.json'],{encoding:'utf8'}));
 const id=manifest.animations[0].id;
 const animation=JSON.parse(execFileSync('unzip',['-p',file,`animations/${id}.json`],{encoding:'utf8'}));
 const config=load('apps/mobile/src/lib/tame-heart-animation.ts',{'../../assets/animations/exploding heart (1).lottie':123,'../../assets/animations/exploding-heart.json':animation});
 assert.equal(config.TAME_HEART_SOURCE,123);assert.equal(config.TAME_HEART_SPEED,1);
 assert.ok(Math.abs((animation.op-animation.ip)/animation.fr*1000-config.TAME_HEART_DURATION_MS)<1);
 assert.equal(config.TAME_HEART_FALLBACK_MS,undefined);assert.equal(config.TAME_HEART_LOAD_FALLBACK_MS,undefined);
 assert.ok(!animation.assets.some(asset=>asset.p),'does not depend on a missing remote bitmap');
 const metro=fs.readFileSync('apps/mobile/metro.config.js','utf8');assert.match(metro,/assetExts.push\('lottie'\)/);
});
async function ready(){const h=screenHarness({manualHeart:true});await flush();h.press('View Overthinking');await flush();h.press('Start');
 const hit=h.find(n=>n.type==='Swipe').props.onHit;for(let i=0;i<20;i++)hit();h.render();return h;}
test('heart mounts at original speed, uses callback-owning autoplay and pauses/resumes without speed changes',async()=>{
 const h=await ready();assert.equal(h.find(n=>n.type==='Lottie'),undefined,'no hidden autoplay or zero-speed prewarm');
 h.find(n=>/^Reply 1:/.test(n.props?.accessibilityLabel??'')).props.onPress();let heart=h.find(n=>n.type==='Lottie');
 assert.equal(heart.props.source,321);assert.equal(heart.props.renderMode,'AUTOMATIC');assert.equal(heart.props.autoPlay,true);
 assert.equal(heart.props.hardwareAccelerationAndroid,true);assert.equal(heart.props.cacheComposition,true);
 assert.equal(heart.props.speed,1);assert.equal(heart.props.onAnimationLoaded,undefined,'dropped loaded event must not freeze the player');
 assert.equal(h.all().some(n=>n.props?.children==='Victory'),false);
 heart.props.onLayout(nativeHeartLayout);h.render();assert.equal(h.find(n=>n.type==='Lottie').props.speed,1);
 assert.equal(h.heartCommands.filter(c=>c[0]==='play').length,0,'async source playback is owned by native autoplay, not an early JS command');
 h.time.advance(1000);
 h.background();assert.equal(h.find(n=>n.type==='Lottie').props.speed,1);assert.ok(h.heartCommands.some(c=>c[0]==='pause'));
 h.time.advance(10000);h.find(n=>n.type==='Lottie').props.onAnimationFinish(true);h.render();assert.equal(h.rewards.length,0,'pause cancellation cannot open a popup');h.foreground();
 assert.equal(h.find(n=>n.type==='Lottie').props.speed,1);assert.ok(h.heartCommands.some(c=>c[0]==='resume'));
 h.time.advance(2003);
 h.find(n=>n.type==='Lottie').props.onAnimationFinish(false);h.render();h.render();
 assert.equal(h.all().some(n=>n.props?.children==='Victory'),true);assert.equal(h.rewards.length,1);h.h.unmount();
});
test('slow layout or delayed finish delivery cannot report false failure, replay, substitute JSON or release coins',async()=>{
 const h=await ready();h.find(n=>/^Reply 1:/.test(n.props?.accessibilityLabel??'')).props.onPress();h.render();
 h.time.advance(20000);h.render();assert.equal(h.rewards.length,0);
 h.find(n=>n.type==='Lottie').props.onLayout(nativeHeartLayout);h.render();
 h.time.advance(20000);h.render();h.render();assert.equal(h.rewards.length,0);
 assert.equal(h.find(n=>n.type==='Lottie').props.source,321);
 assert.equal(h.all().some(n=>n.props?.accessibilityLabel==='Replay heart animation'),false);
 h.find(n=>n.type==='Lottie').props.onAnimationFinish(false);h.render();h.render();assert.equal(h.rewards.length,1);h.h.unmount();
});
test('dotLottie failure plays the identical local fallback fully, never immediately settles',async()=>{
 const h=await ready();h.find(n=>/^Reply 1:/.test(n.props?.accessibilityLabel??'')).props.onPress();let heart=h.find(n=>n.type==='Lottie');
 const stale=heart.props.onAnimationFinish;heart.props.onAnimationFailure('failed');h.render();
 assert.equal(h.all().some(n=>n.props?.children==='Victory'),false);
 stale(false);h.render();assert.equal(h.rewards.length,0);
 heart=h.find(n=>n.type==='Lottie');assert.equal(typeof heart.props.source,'object');heart.props.onLayout(nativeHeartLayout);h.render();
 h.time.advance(3003);stale(false);h.render();assert.equal(h.rewards.length,0,'a previous native player cannot complete its replacement');
 h.find(n=>n.type==='Lottie').props.onAnimationFinish(false);h.render();h.render();
 assert.equal(h.all().some(n=>n.props?.children==='Victory'),true);
 assert.equal(h.all().some(n=>String(n.props?.children).includes('Saving your progress')),false);h.h.unmount();
});
test('even fallback failure offers replay without submitting twice or skipping the heart',async()=>{
 const h=await ready();h.find(n=>/^Reply 1:/.test(n.props?.accessibilityLabel??'')).props.onPress();h.render();
 h.find(n=>n.type==='Lottie').props.onAnimationFailure('dotLottie failed');h.render();
 h.find(n=>n.type==='Lottie').props.onAnimationFailure('fallback failed');h.render();h.time.advance(20000);h.render();
 assert.equal(h.rewards.length,0);assert.equal(h.all().some(n=>n.props?.children==='Victory'),false);
 h.press('Replay heart animation');const heart=h.find(n=>n.type==='Lottie');assert.equal(heart.props.source,321);
 heart.props.onLayout(nativeHeartLayout);h.render();h.time.advance(3003);h.find(n=>n.type==='Lottie').props.onAnimationFinish(false);h.render();h.render();
 assert.equal(h.rewards.length,1);assert.equal(h.calls.filter(c=>c?.idempotencyKey).length,1);h.h.unmount();
});
test('a genuine native finish is authoritative even when JS observed less than the composition duration',async()=>{
 const h=await ready();h.find(n=>/^Reply 1:/.test(n.props?.accessibilityLabel??'')).props.onPress();h.render();
 h.find(n=>n.type==='Lottie').props.onLayout(nativeHeartLayout);h.render();h.time.advance(2800);
 assert.equal(h.rewards.length,0);assert.equal(h.find(n=>n.type==='Lottie').props.source,321);
 h.find(n=>n.type==='Lottie').props.onAnimationFinish(false);h.render();h.render();assert.equal(h.rewards.length,1);h.h.unmount();
});
test('native speed starts at 1 before source setup, never routes startup through iOS unbound setSpeed play',async()=>{
 const source=fs.readFileSync('apps/mobile/node_modules/lottie-react-native/ios/LottieReactNative/ContainerView.swift','utf8');
 const fabric=fs.readFileSync('apps/mobile/node_modules/lottie-react-native/ios/Fabric/LottieAnimationViewComponentView.mm','utf8');
 assert.match(source,/private var speed: CGFloat = 0\.0/);
 assert.ok(fabric.indexOf('[_view setSpeed:')<fabric.indexOf('[_view setSourceDotLottieURI:'));
 const h=await ready();h.find(n=>/^Reply 1:/.test(n.props?.accessibilityLabel??'')).props.onPress();
 const heart=h.find(n=>n.type==='Lottie');assert.equal(heart.props.speed,1);assert.equal(heart.props.autoPlay,true);
 heart.props.onLayout(nativeHeartLayout);h.render();assert.equal(h.find(n=>n.type==='Lottie').props.speed,1);
 heart.props.onAnimationFinish(true);h.render();assert.equal(h.rewards.length,0);
 h.time.advance(3003);h.find(n=>n.type==='Lottie').props.onAnimationFinish(false);h.render();h.render();assert.equal(h.rewards.length,1);
 heart.props.onAnimationFinish(false);h.render();assert.equal(h.rewards.length,1,'late duplicate completion cannot settle again');h.h.unmount();
});
test('a genuine finish queued just before backgrounding is retained until visible, not lost or replayed',async()=>{
 const h=await ready();h.find(n=>/^Reply 1:/.test(n.props?.accessibilityLabel??'')).props.onPress();
 const heart=h.find(n=>n.type==='Lottie');heart.props.onLayout(nativeHeartLayout);h.render();
 h.time.advance(3003);h.background();heart.props.onAnimationFinish(false);h.render();assert.equal(h.rewards.length,0);
 assert.equal(h.all().some(n=>n.props?.children==='Victory'),false);
 const resumes=h.heartCommands.filter(c=>c[0]==='resume').length;
 h.foreground();h.render();h.render();assert.equal(h.all().some(n=>n.props?.children==='Victory'),true);assert.equal(h.rewards.length,1);
 assert.equal(h.heartCommands.filter(c=>c[0]==='resume').length,resumes,'a completed heart must not replay on resume');
 heart.props.onAnimationFailure('late native failure');h.render();assert.equal(h.all().some(n=>n.props?.accessibilityLabel==='Replay heart animation'),false);
 assert.equal(h.calls.filter(c=>c?.idempotencyKey).length,1);h.h.unmount();
});
test('heart canvas is anchored to the normalized monster centre on every viewport, never to the arena or speech bubble',()=>{
 const {layout}=require('./release-room-test-utils.cjs');
 for(const [w,h,top,bottom]of[[320,568,20,0],[375,667,20,0],[390,844,47,34],[430,932,59,34]])for(const font of[1,1.3]){
  const l=layout.releaseRoomLayout(w,h,top,bottom,font),frame=l.heartFrame;
  assert.equal(frame.left+frame.width/2,w/2);
  assert.ok(Math.abs(frame.top+frame.height/2-(l.finalBodyTop+l.finalBodyHeight/2))<1e-8);
  assert.ok(Math.abs(frame.top+frame.height/2-(l.finalMonsterTop+l.finalSize/2))<1e-8);
  assert.equal(frame.width,frame.height);assert.equal(frame.width,Math.min(w,l.finalArenaHeight));
 }
});
for(const [index,monster]of domain.RELEASE_ROOM_MONSTERS.entries())test(`${monster.name}: full heart → popup/confetti → completed popup → exactly one reward`,async()=>{
 const h=screenHarness({manualHeart:true,manualLayout:true,manualMotion:true});await flush();h.press('View '+monster.name);await flush();h.press('Start');
 const hit=h.find(n=>n.type==='Swipe').props.onHit;for(let i=0;i<20;i++)hit();h.render();
 h.find(n=>n.props?.accessibilityLabel?.startsWith(`Reply ${index%4+1}:`)).props.onPress();
 const heart=h.find(n=>n.type==='Lottie');assert.equal(heart.props.source,321);assert.equal(heart.props.speed,1);
 heart.props.onLayout(nativeHeartLayout);h.render();h.time.advance(3003);
 assert.equal(h.all().filter(n=>n.type==='Confetti').length,0);assert.equal(h.rewards.length,0);
 heart.props.onAnimationFinish(false);h.render();h.render();
 assert.equal(h.all().filter(n=>n.type==='Confetti').length,1);assert.equal(h.rewards.length,0);
 h.find(n=>n.props?.accessibilityLabel==='Victory dialog').props.onLayout();h.render();assert.equal(h.rewards.length,0);
 h.finishPopup();h.finishPopup();heart.props.onAnimationFinish(false);h.render();
 assert.equal(h.rewards.length,1);assert.equal(h.calls.filter(c=>c?.idempotencyKey).length,1);h.h.unmount();
});
