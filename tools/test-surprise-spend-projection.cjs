const {test}=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./lifecycle-test-utils.cjs');
const {CoinRewardLedger}=load('apps/mobile/src/lib/coin-reward-ledger.ts');
const state=(balance,version,spends=[])=>({wallet:{balance,version},credits:[],spends,timezone:'UTC',localDate:'2026-10-22',serverNow:'2026-10-22T00:00:00Z'});
test('Send projects the debit immediately without mutating the confirmed wallet; duplicate taps hold once',()=>{
 const l=new CoinRewardLedger();l.sync(state(1000,1));l.projectSpend('send',300);l.projectSpend('send',300);
 assert.equal(l.balance,700);assert.equal(l.wallet.balance,1000);assert.equal(l.pendingSpends.size,1);
});
test('bootstrap arriving before the pay receipt includes the debit exactly once; stale reads cannot regress it',()=>{
 const l=new CoinRewardLedger();l.sync(state(1000,1));l.projectSpend('send',300);l.sync(state(700,2,['send']));
 assert.equal(l.balance,700);l.sync(state(1000,1));assert.equal(l.balance,700);l.settleSpend('send',{balance:700,version:2});assert.equal(l.balance,700);
});
test('overlapping sends, positive rewards, receipt versions and rejection settle independently',()=>{
 const l=new CoinRewardLedger();l.sync(state(1000,1));l.projectSpend('one',300);l.projectSpend('two',300);l.begin('reward','reward',10);assert.equal(l.balance,410);
 l.sync(state(700,2,['one']));assert.equal(l.balance,410);l.rejectSpend('two');assert.equal(l.balance,710);
 l.sync({...state(710,3,['one']),credits:[{key:'reward',amount:10}]});assert.equal(l.balance,710);
});
test('restart can restore a durable hold before the wallet hydrates; an unknown result never restores spendable money',()=>{
 const l=new CoinRewardLedger();l.projectSpend('send',300);assert.equal(l.balance,null);l.sync(state(1000,1));assert.equal(l.balance,700);
 l.settleSpend('send');assert.equal(l.balance,700);l.sync(state(700,2,['send']));assert.equal(l.balance,700);
});
test('legacy receipt can confirm a hold without spend metadata; negative authoritative balances remain visible',()=>{
 const l=new CoinRewardLedger();l.sync(state(1000,1));l.projectSpend('send',300);l.syncLegacy({balance:700,version:2},10);assert.equal(l.balance,700);assert.equal(l.wallet.balance,1000);
 l.settleSpend('send',{balance:700,version:2});l.syncLegacy({balance:700,version:2},11);assert.equal(l.balance,700);
 l.sync(state(-100,3));assert.equal(l.balance,-100);
});
