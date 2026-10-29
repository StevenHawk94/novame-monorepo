const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load,hooks,deferred,flush}=require('./lifecycle-test-utils.cjs');
const {presentationImports,model:motionModel}=require('./motion-test-utils.cjs');
const model=load('apps/mobile/src/lib/daily-plus-bonus.ts',{'./burrow-motion':motionModel});
const jsx=(type,props)=>({type,props});
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?t.type==='Modal'&&!t.props.visible?[]:[t,...nodes(t.props?.children)]:[];
const bonus=()=>({eligible:true,claimed:false,amount:50,localDate:'2026-10-12',key:'plus-login:2026-10-12'});
function harness(){
 const h=hooks(),request=deferred(),calls=[],p=presentationImports(h);
 const props={bonus:bonus(),localDate:'2026-10-12',balance:9,enabled:true,anchor:{x:260,y:63,width:90,height:40},
  onClaim:day=>{calls.push(day);return request.promise;},onRefresh:()=>calls.push('refresh')};
 const {DailyPlusBonusPresentation}=load('apps/mobile/src/components/burrow/daily-plus-bonus.tsx',{
  ...p,react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},
  'react-native':{Modal:'Modal',View:'View',Text:'Text',Pressable:'Button',ScrollView:'Scroll',StyleSheet:{create:x=>x,absoluteFillObject:{}},useWindowDimensions:()=>({width:390,height:844})},
  './coin-ui':{CoinIcon:'Coin'},'./coin-reward-banner':{CoinWalletPortal:'WalletPortal'},
  '@/lib/app-major-update-api':{},'@/lib/burrow-store':{},'@/lib/coin-reward-store':{setNextCoinRewardOrigin:p=>calls.push(p),coinRewardDefinitelyRejected:e=>['session_changed','day_changed','plus_required','intent_not_saved'].includes(e.message)},
  '@/lib/daily-plus-bonus':model,'@/lib/modal-coordinator':{useActiveModalSlot(){},ownsModalSlot:()=>true,requestModalSlot(){},releaseModalSlot(){}},
  '@/lib/overlay-presence':{registerOverlay:()=>()=>{}},'@/lib/session-lifecycle':{},
 },p.motion.time.globals);
 const render=()=>nodes(h.render(()=>DailyPlusBonusPresentation(props)));
 const tap=()=>render().find(n=>n.type==='Button'&&n.props.disabled===false).props.onPress();
 return{h,request,calls,props,render,tap,time:p.motion.time};
}
test('eligibility remains authoritative, date-scoped and fail-closed',()=>{
 assert.equal(model.dailyPlusBonusAvailable(bonus(),'2026-10-12'),true);
 for(const b of [undefined,{...bonus(),eligible:false},{...bonus(),claimed:true},{...bonus(),amount:0},{...bonus(),key:'bad'},{...bonus(),localDate:'2026-10-11'}])assert.equal(model.dailyPlusBonusAvailable(b,'2026-10-12'),false);
});
test('only ready Home and a real wallet anchor may open the daily popup',()=>{
 for(const patch of [{enabled:false},{anchor:null},{bonus:undefined},{bonus:{...bonus(),claimed:true}}]){const x=harness();Object.assign(x.props,patch);assert.equal(x.render().length,0);x.h.unmount();}
 const x=harness();assert.ok(x.render().some(n=>n.type==='WalletPortal'));x.h.unmount();
});
test('daily bonus offers only Claim, with no Later action even after a retryable rejection',async()=>{
 const x=harness();
 const check=()=>{const list=x.render(),buttons=list.filter(n=>n.type==='Button');
  assert.equal(buttons.length,1);assert.equal(buttons[0].props.disabled,false);
  assert.ok(list.some(n=>n.props?.children==='Claim'));
  assert.equal(list.some(n=>/later/i.test(String(n.props?.children??''))||/later/i.test(n.props?.accessibilityLabel??'')),false);
 };
 check();x.tap();x.request.reject(Error('intent_not_saved'));await flush();check();
 assert.ok(x.render().some(n=>n.props?.accessibilityRole==='alert'),'failure handling stays intact');x.h.unmount();
});
test('tap keeps popup and its shared wallet portal until coin presentation completes, guards double taps and never awaits a receipt',()=>{
 const x=harness(),tap=x.render().find(n=>n.type==='Button').props.onPress;tap();tap();
 assert.equal(x.calls.filter(c=>typeof c==='string').length,1);
 assert.ok(x.render().some(n=>n.type==='WalletPortal'),'the native modal retains the SAME shared wallet during the flight');
 assert.equal(x.render().find(n=>n.type==='Button').props.disabled,true);
 assert.ok(x.render().some(n=>n.props?.children==='Claimed!'));
 x.props.bonus={...bonus(),claimed:true};assert.ok(x.render().some(n=>n.type==='WalletPortal'),'a fast authoritative claimed update must not remove the presentation');
 const flight=motionModel.coinArrivalTiming(0).flightEnd;
 x.time.advance(flight);assert.ok(x.render().some(n=>n.type==='WalletPortal'),'keep the existing balance hold/fade timing after the particles land');
 x.time.advance(motionModel.BURROW_MOTION.coinHold);x.render();
 x.time.advance(motionModel.BURROW_MOTION.coinFade-1);assert.ok(x.render().length>0,'do not remove the popup before its fade completes');
 x.time.advance(1);assert.equal(x.render().length,0);x.h.unmount();assert.equal(x.time.timers.size,0);
});
test('ambiguous timeout does not reopen or rewind an already completed celebration',async()=>{
 const x=harness();x.tap();x.request.reject(Error('network'));await flush();
 assert.ok(x.render().some(n=>n.type==='WalletPortal'));assert.equal(x.render().some(n=>n.props?.accessibilityRole==='alert'),false);
 x.time.advance(2700);x.render();x.time.advance(300);assert.equal(x.render().length,0);x.h.unmount();
});
test('a synchronous local persistence failure keeps Claim visible and retryable instead of hiding an unsaved grant',()=>{
 const x=harness();x.props.onClaim=()=>{throw Error('disk_full');};x.tap();
 assert.ok(x.render().some(n=>n.props?.accessibilityRole==='alert'));assert.equal(x.render().find(n=>n.type==='Button').props.disabled,false);x.h.unmount();
});
test('definitive rejection restores a retry; account changes cannot show old failures',async()=>{
 for(const code of ['day_changed','plus_required','intent_not_saved']){const x=harness();x.tap();x.request.reject(Error(code));await flush();assert.ok(x.render().some(n=>n.props?.accessibilityRole==='alert'));x.h.unmount();}
 const x=harness();x.tap();x.request.reject(Error('session_changed'));await flush();assert.equal(x.render().length,0);x.h.unmount();
});
test('background/blur consumes the celebration and never replays it on return; unmount cancels timers',()=>{
 const x=harness();x.tap();x.props.enabled=false;x.render();x.render();x.props.enabled=true;assert.equal(x.render().length,0);x.h.unmount();assert.equal(x.time.timers.size,0);
});
test('background/blur during popup fade cannot reopen its native modal on return',()=>{
 const x=harness();x.tap();x.time.advance(motionModel.coinArrivalTiming(0).flightEnd+motionModel.BURROW_MOTION.coinHold);x.render();
 x.props.enabled=false;x.render();x.render();x.props.enabled=true;assert.equal(x.render().length,0);x.h.unmount();assert.equal(x.time.timers.size,0);
});
test('daily popup has no separate wallet, counter, flight tree or balance synchronization',()=>{
 const source=fs.readFileSync('apps/mobile/src/components/burrow/daily-plus-bonus.tsx','utf8');
 assert.match(source,/<CoinWalletPortal/);assert.match(source,/claimDailyPlusBonus\(day,props.bonus\?\.amount/);
 assert.doesNotMatch(source,/AnimatedCoinBalance|BonusCoinFlight|syncCoinWallet|Claiming/);
});
