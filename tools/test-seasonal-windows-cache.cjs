const {test}=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./lifecycle-test-utils.cjs');
test('restart drops only obsolete window data and preserves new frames, other furniture and confirmed wallet',()=>{
 const rows=new Map(),keys=Object.fromEntries(['kBurrowSnapshot','kBurrowWallet','kBurrowActionKeys'].map(name=>[name,{name}]));
 const cache=load('apps/mobile/src/lib/burrow-cache.ts',{'./storage':{storage:{set:(k,v)=>rows.set(k,v),getString:k=>rows.get(k),remove:k=>rows.delete(k)}},'../shared/storage/keys':keys});
 const old='burrow_art_windows_03',fresh='window_frame_cross_dark_wood',other='table';
 const data={profile:{id:'me'},wallet:{balance:200,version:1},catalog:[
  {stable_id:old,category:'windows',metadata:{artOrdinal:3}},
  {stable_id:fresh,category:'windows',metadata:{windowFrameKey:'Cross_Dark_Wood'}},
  {stable_id:other,category:'tables',metadata:{}}],inventory:[old,fresh,other].map(item_id=>({item_id})),
  loadouts:[old,other].map(item_id=>({item_id})),roomPhotos:[],memoryEntries:[],
  moments:[{actor_id:'me',payload:{snapshot:{itemId:old}}},{actor_id:'me',payload:{itemId:other}}],gifts:[]};
 cache.persistBurrowSnapshot(data);cache.persistBurrowWallet('me',{balance:350,version:2});
 const state=cache.readBurrowSnapshot('me').data;
 assert.deepEqual(Array.from(state.catalog,r=>r.stable_id),[fresh,other]);
 assert.deepEqual(Array.from(state.inventory,r=>r.item_id),[fresh,other]);
 assert.deepEqual(Array.from(state.loadouts,r=>r.item_id),[other]);
 assert.equal(state.moments.length,1);assert.equal(state.moments[0].payload.itemId,other);
 assert.equal(state.wallet.balance,350);assert.equal(state.wallet.version,2);
 assert.equal(cache.readBurrowSnapshot('another'),null);
 cache.persistBurrowSnapshot(state);
 assert.deepEqual(Array.from(cache.readBurrowSnapshot('me').data.catalog,r=>r.stable_id),[fresh,other]);
});
