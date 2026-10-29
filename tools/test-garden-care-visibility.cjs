const{test}=require('node:test'),assert=require('node:assert/strict'),{load}=require('./lifecycle-test-utils.cjs');
test('care metadata invalidates Home and Partner Room, without invalidating unrelated retained pages',()=>{
 const {retainedPageChanged}=load('apps/mobile/src/lib/retained-page-model.ts');
 const before={profile:{id:'me'},partner:{id:'partner'},pairVersion:'pair',roomCare:{version:2}},after={...before,roomCare:{...before.roomCare,updated:true}};
 for(const page of ['home','partner_room'])assert.equal(retainedPageChanged(before,after,page),true);
 for(const page of ['shop','game','surprise','plushie'])assert.equal(retainedPageChanged(before,after,page),false);
});
test('both new helper actions appear in Moments with correct actor/recipient and existing icon categories',()=>{
 const {momentKind,momentDescription}=load('apps/mobile/src/lib/burrow-moments-model.ts');
 const row=need=>({event_type:'room_need_refilled',payload:{need},actor_id:'me',target_id:'partner'});
 assert.equal(momentKind(row('leaf')),'feed');assert.equal(momentKind(row('fertilizer')),'water');
 assert.equal(momentDescription(row('leaf'),'me','Alex'),"You fed Alex's bunny some greens");
 assert.equal(momentDescription(row('fertilizer'),'me','Alex'),"You fertilized Alex's flower");
 assert.equal(momentDescription(row('leaf'),'partner','Sam'),'Sam fed your bunny some greens');
 assert.equal(momentDescription(row('fertilizer'),'partner','Sam'),'Sam fertilized your flower');
});
