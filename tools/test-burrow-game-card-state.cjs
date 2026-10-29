const {test}=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./lifecycle-test-utils.cjs');
const {gameCardState}=load('apps/mobile/src/lib/burrow-game-card-state.ts');
const game={id:'morning',price:210},base={availableIds:[],sessions:[]};
const round={id:'first',gameId:'morning',createdAt:'2026-10-13T10:00:00Z',completedAt:null,ownCount:0,guessCount:0,partnerOwnCount:0,partnerGuessCount:0};
test('price, Plus gate and shared permanent unlock have mutually exclusive card states',()=>{
 assert.equal(gameCardState(game,base,false).kind,'locked');assert.equal(gameCardState(game,base,false).price,210);
 const plus={...game,plus_only:true};assert.equal(gameCardState(plus,base,false).kind,'plus');
 assert.equal(gameCardState(plus,{...base,availableIds:['morning']},false).kind,'unlocked','permanent unlock survives Plus expiry');
 assert.equal(gameCardState(plus,base,true).kind,'locked');
 const state=gameCardState(plus,{...base,availableIds:['morning']},true);
 assert.equal(state.kind,'unlocked');assert.equal(state.mineFinished,false);assert.equal(state.partnerFinished,false);
});
test('each orange check means both own answers and guesses are finished, not merely an opened game',()=>{
 for(const [ownCount,guessCount,partnerOwnCount,partnerGuessCount,mine,partner] of [[0,0,0,0,false,false],[6,0,6,6,false,true],[6,6,0,0,true,false],[6,6,6,6,true,true]]){
  const state=gameCardState(game,{...base,availableIds:['morning'],sessions:[{...round,ownCount,guessCount,partnerOwnCount,partnerGuessCount}]},false);
  assert.equal(state.mineFinished,mine);assert.equal(state.partnerFinished,partner);
 }
});
test('zero-price offers show playable completion checks before a receipt, without weakening Plus or repricing gates',()=>{
 const free={...game,price:0};
 const initial=gameCardState(free,base,false);
 assert.equal(initial.kind,'unlocked');assert.equal(initial.round,null);
 assert.equal(initial.mineFinished,false);assert.equal(initial.partnerFinished,false);
 for(const [ownCount,guessCount,partnerOwnCount,partnerGuessCount,mine,partner] of [[6,0,0,0,false,false],[6,6,0,0,true,false],[0,0,6,6,false,true],[6,6,6,6,true,true]]){
  const state=gameCardState(free,{...base,sessions:[{...round,ownCount,guessCount,partnerOwnCount,partnerGuessCount}]},false);
  assert.equal(state.kind,'unlocked');assert.equal(state.mineFinished,mine);assert.equal(state.partnerFinished,partner);
 }
 assert.equal(gameCardState({...free,plus_only:true},base,false).kind,'plus');
 assert.equal(gameCardState({...free,plus_only:true},base,true).kind,'unlocked');
 assert.equal(gameCardState({...free,price:300},base,false).kind,'locked');
 assert.equal(gameCardState({...free,price:300},{...base,availableIds:[game.id]},false).kind,'unlocked');
});
test('latest completed result wins over a replay; unsorted sessions and another game never change the target',()=>{
 const completed={...round,completedAt:'2026-10-13T11:00:00Z'},latest={...completed,id:'latest',createdAt:'2026-10-13T11:00:00Z'};
 const replay={...round,id:'replay',createdAt:'2026-10-13T12:00:00Z'};
 const state=gameCardState(game,{...base,availableIds:['morning'],sessions:[replay,completed,{...latest,gameId:'other'},latest]},true);
 assert.equal(state.round.id,'latest');assert.equal(state.mineFinished,true);assert.equal(state.partnerFinished,true);
 const active=gameCardState(game,{...base,availableIds:['morning'],sessions:[round,replay]},false);
 assert.equal(active.round.id,'replay');
});
