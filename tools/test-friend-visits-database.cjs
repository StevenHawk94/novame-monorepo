const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const migration=n=>fs.readFileSync(`supabase/migrations/${n}.sql`,'utf8');
async function fixture(){
  const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite'),db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create table profiles(id uuid primary key,display_name text,timezone_name text);
    create table pairings(user_id uuid primary key,partner_user_id uuid,created_at timestamptz default now());
    create table burrow_pair_versions(user_id uuid primary key,version uuid default gen_random_uuid());
    create table content_revisions(id text primary key,status text);create table app_config(key text primary key,value text);
    insert into content_revisions values('test','published');insert into app_config values('app_major_update_content_revision','test'),('adventure_friends_v2_enabled','true');
    create table friend_definitions(stable_id text primary key,name text,status text default 'active',revision_id text default 'test',metadata jsonb default '{"adventureV2":true}');
    create table adventures(id uuid primary key default gen_random_uuid(),user_id uuid,status text);
    create table adventure_dialogues_v2(id text primary key,friend_id text references friend_definitions(stable_id),phase text,seq int,weight numeric default 1,content jsonb,status text default 'active');
    create table adventure_dialogue_completions(user_id uuid,dialogue_id text,adventure_id uuid,primary key(user_id,dialogue_id));
    create table catalog_items(stable_id text primary key,status text default 'active',revision_id text default 'test',metadata jsonb,tags text[],asset jsonb);
    create table user_inventory(owner_id uuid,item_id text);
    create table adventure_encounter_plans(id bigint generated always as identity primary key,user_id uuid,friend_id text,dialogue_id text,gift_id text,adventure_id uuid,status text default 'reserved',snapshot jsonb);
    create table user_friend_discoveries(user_id uuid references profiles(id),friend_id text references friend_definitions(stable_id),source_adventure_id uuid,first_seen_at timestamptz default '2020-01-01Z',interaction_completed_at timestamptz,unique(user_id,friend_id));
    create table wallets(user_id uuid primary key,carrot_balance int default 0,version bigint default 0,updated_at timestamptz default now());
    create table currency_ledger(user_id uuid,requested_delta int,delta int,balance_after int,reason text,reference_type text,reference_id text,idempotency_key text,created_at timestamptz default now(),unique(user_id,idempotency_key));
    create function lock_burrow_pair(id uuid) returns uuid language sql as $$select a.partner_user_id from pairings a join pairings b on a.partner_user_id=b.user_id and b.partner_user_id=a.user_id where a.user_id=id$$;
    create function burrow_pair_version_v1(a uuid,b uuid) returns text language sql as $$select md5(string_agg(user_id::text||':'||version::text,',' order by user_id)) from burrow_pair_versions where user_id in(a,b) having count(*)=2$$;
    create function broadcast_burrow_change() returns trigger language plpgsql as $$begin return new;end$$;
    create function burrow_bootstrap_v1(id uuid) returns jsonb language sql as $$select ensure_friend_visit_v1(id)$$;` .replace('create function burrow_bootstrap_v1(id uuid) returns jsonb language sql as $$select ensure_friend_visit_v1(id)$$;',
      ()=> 'create function ensure_friend_visit_v1(p_user_id uuid) returns jsonb language sql as $$select \'{}\'::jsonb$$;create function burrow_bootstrap_v1(id uuid) returns jsonb language sql as $$select ensure_friend_visit_v1(id)$$;'));
  const wallet=migration('20260920000139_burrow_coin_purchases');
  await db.exec(wallet.slice(wallet.indexOf('create or replace function public.change_carrot_balance_v1'),wallet.indexOf('revoke all on function public.change_carrot_balance_v1')));
  const adventure=migration('20261010000215_adventure_encounter_runtime');
  await db.exec(adventure.slice(adventure.indexOf('create function public.prepare_adventure_encounters_v2'),adventure.indexOf('create function public.start_adventure_v2')));
  const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333';
  await db.query("insert into profiles values($1,'Alex','UTC'),($2,'Sam','Pacific/Auckland'),($3,'Other','UTC')",[A,B,C]);
  await db.query('insert into burrow_pair_versions(user_id) values($1),($2),($3)',[A,B,C]);
  await db.query('insert into pairings(user_id,partner_user_id) values($1,$2),($2,$1)',[A,B]);
  const docs=fs.readdirSync('apps/api/src/data/friend-visits').map(n=>JSON.parse(fs.readFileSync('apps/api/src/data/friend-visits/'+n)));
  for(const doc of docs)await db.query('insert into friend_definitions(stable_id,name) values($1,$2)',[doc.friendId,doc.name]);
  await db.exec(migration('20261014000235_friend_visit_couple_runtime'));
  await db.exec(migration('20261014000236_friend_visit_workbook_content'));
  await db.exec(migration('20261018000244_friend_visit_prepared_dialogue'));
  const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
  const rpc=async(name,args=[])=>(await q(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args))[0].result;
  const version=await rpc('burrow_pair_version_v1',[A,B]);
  const add=async(id='MM-V16',date='2030-01-07')=>{
    return (await q(`insert into friend_visit_instances_v2(pair_low,pair_high,pair_version,visit_date,friend_id,question_id,kind,content_snapshot,waiting_line)
      select $1,$2,$3,$5,friend_id,id,kind,content,'Waiting for {partner}' from friend_visit_questions_v2 where id=$4 returning id`,[A,B,version,id,date]))[0].id;
  };
  return {db,q,rpc,A,B,C,docs,version,add};
}
test('workbook coins, every matrix, permissions and redacted views',async()=>{
 const h=await fixture();try{
  assert.equal((await h.q('select count(*)::int n from friend_visit_questions_v2'))[0].n,300);
  let replies=0;for(const doc of h.docs)for(const q of doc.questions){
    if(q.type!=='Trivia')for(const a of q.choices)for(const b of q.choices)assert.ok(q.coupleReplies[a.id+':'+b.id]?.length);
    replies+=Object.keys(q.coupleReplies).length;
    assert.equal(q.coinsIfCorrect,10);assert.equal(q.coinsIfWrong,q.type==='Trivia'?5:10);
  }assert.equal(replies,775);
  const id=await h.add(),view=await h.rpc('friend_visit_view_v2',[h.A,id]);
  assert.equal(view.myCompleted,false);assert.ok(!JSON.stringify(view).includes('choices'));assert.ok(!JSON.stringify(view).includes('correctOption'));
  assert.equal(await h.rpc('friend_visit_view_v2',[h.C,id]),null);
  const start=await h.rpc('begin_friend_visit_v2',[h.A,id,h.version]);
  assert.ok(!JSON.stringify(start).includes('reply'));assert.ok(!JSON.stringify(start).includes('coinsIf'));
  assert.equal((await h.rpc('begin_friend_visit_v2',[h.A,id,'bad'])).error,'pair_changed');
  assert.equal((await h.rpc('respond_friend_visit_v2',[h.C,id,start.sessionId,h.version,'A'])).error,'pair_changed');
  assert.equal((await h.rpc('respond_friend_visit_v1',[h.A,id,{choiceId:'A'}])).error,'client_upgrade_required');
  const tables=['friend_visit_questions_v2','friend_visit_instances_v2','friend_visit_answers_v2','friend_visit_sessions_v2'];
  for(const t of tables)assert.equal((await h.q("select has_table_privilege('authenticated',$1,'SELECT') ok",[t]))[0].ok,false);
  assert.equal((await h.q("select has_function_privilege('service_role','schedule_friend_visit_v2(uuid,date)','EXECUTE') ok"))[0].ok,false);
 }finally{await h.db.close();}
});
test('prepared branches contain only authorized feedback/rewards; warmup is idempotent and cannot award or complete',async()=>{
 const h=await fixture();try{
  const id=await h.add('MM-V01'),p=await h.rpc('prepare_friend_visit_v3',[h.A,id,h.version]);
  assert.equal(p.mode,'independent');assert.equal(p.friendId,'adventure_friend_mm');
  assert.equal(p.choices.find(c=>c.id==='A').reward,10);assert.equal(p.choices.find(c=>c.id==='B').reward,5);
  assert.ok(p.choices.every(c=>c.feedback.length));assert.ok(!JSON.stringify(p).includes('coupleReplies'));
  assert.equal((await h.rpc('prepare_friend_visit_v3',[h.A,id,h.version])).sessionId,p.sessionId);
  assert.equal((await h.q('select count(*)::int n from friend_visit_answers_v2'))[0].n,0);
  assert.equal((await h.q('select count(*)::int n from friend_visit_sessions_v2'))[0].n,0);
  assert.equal((await h.q('select count(*)::int n from wallets'))[0].n,0);
  assert.equal((await h.q("select has_function_privilege('authenticated','prepare_friend_visit_v3(uuid,uuid,text)','EXECUTE') ok"))[0].ok,false);
  const wrong=await h.rpc('respond_friend_visit_v3',[h.A,id,p.sessionId,h.version,'B']);
  assert.equal(wrong.reward,5);assert.deepEqual(wrong.feedback,p.choices.find(c=>c.id==='B').feedback);
  const replay=await h.rpc('respond_friend_visit_v3',[h.A,id,p.sessionId,h.version,'B']);assert.equal(replay.applied,false);assert.equal(replay.reward,0);
  assert.equal((await h.rpc('respond_friend_visit_v3',[h.A,id,p.sessionId,h.version,'A'])).error,'idempotency_conflict');
  assert.equal((await h.q('select count(*)::int n from currency_ledger'))[0].n,1);
 }finally{await h.db.close();}
});
test('both open independently; later followup warmup never invalidates the frozen independent token',async()=>{
 const h=await fixture();try{
  const id=await h.add('AR-V16'),a=await h.rpc('prepare_friend_visit_v3',[h.A,id,h.version]);
  const b=await h.rpc('prepare_friend_visit_v3',[h.B,id,h.version]);
  assert.equal(b.mode,'independent');
  await h.rpc('respond_friend_visit_v3',[h.A,id,a.sessionId,h.version,'A']);
  assert.equal((await h.rpc('friend_visit_view_v2',[h.B,id])).partnerCompleted,true);
  const after=await h.rpc('prepare_friend_visit_v3',[h.B,id,h.version]);assert.equal(after.mode,'followup');assert.notEqual(after.sessionId,b.sessionId);
  assert.notEqual(after.question,b.question);
  await h.q("update profiles set display_name='Renamed after opening' where id=$1",[h.A]);
  const response=await h.rpc('respond_friend_visit_v3',[h.B,id,b.sessionId,h.version,'B']);
  assert.equal(response.reward,10);assert.deepEqual(response.feedback,b.choices.find(c=>c.id==='B').feedback);
  assert.equal((await h.q('select sum(carrot_balance)::int n from wallets'))[0].n,20);
 }finally{await h.db.close();}
});
test('followup outcomes match settlement; prepared tokens retain pair, owner, expiry and choice validation',async()=>{
 const h=await fixture();try{
  const id=await h.add('AR-V16'),a=await h.rpc('prepare_friend_visit_v3',[h.A,id,h.version]);
  await h.rpc('respond_friend_visit_v3',[h.A,id,a.sessionId,h.version,'A']);
  const b=await h.rpc('prepare_friend_visit_v3',[h.B,id,h.version]);
  await h.q("update profiles set display_name='New name' where id=$1",[h.A]);
  assert.equal((await h.rpc('respond_friend_visit_v3',[h.B,id,a.sessionId,h.version,'B'])).error,'visit_session_changed');
  assert.equal((await h.rpc('respond_friend_visit_v3',[h.B,id,b.sessionId,h.version,'invalid'])).error,'invalid_response');
  const response=await h.rpc('respond_friend_visit_v3',[h.B,id,b.sessionId,h.version,'B']);
  assert.deepEqual(response.feedback,b.choices.find(c=>c.id==='B').feedback);assert.match(response.feedback[0],/Alex guessed/);
  const expired=await h.add('MM-V02','2030-01-11'),p=await h.rpc('prepare_friend_visit_v3',[h.A,expired,h.version]);
  await h.q("update friend_visit_instances_v2 set expires_at=now()-interval '1 second' where id=$1",[expired]);
  assert.equal((await h.rpc('respond_friend_visit_v3',[h.A,expired,p.sessionId,h.version,'A'])).error,'visit_expired');
  await h.q('update burrow_pair_versions set version=gen_random_uuid() where user_id=$1',[h.A]);
  assert.equal((await h.rpc('respond_friend_visit_v3',[h.A,id,a.sessionId,h.version,'A'])).error,'pair_changed');
 }finally{await h.db.close();}
});
test('new friends cannot visit on first local calendar day; repeat encounters never restart the cooldown',async()=>{
 const h=await fixture();try{
  await h.q("insert into friend_visit_schedule_v2 values($1,$2,$3,'America/Los_Angeles')",[h.A,h.B,h.version]);
  await h.q("insert into user_friend_discoveries(user_id,friend_id,source_adventure_id,first_seen_at,interaction_completed_at) values($1,'adventure_friend_mm',gen_random_uuid(),'2030-01-08T00:30Z','2030-01-08T00:30Z')",[h.A]);
  assert.equal(await h.rpc('schedule_friend_visit_v2',[h.A,'2030-01-07']),null,'UTC Jan 8 is still the first local day');
  await h.q("update user_friend_discoveries set interaction_completed_at='2030-01-08T12:00Z'");
  assert.ok(await h.rpc('schedule_friend_visit_v2',[h.B,'2030-01-08']),'next local day eligible despite repeat today');
 }finally{await h.db.close();}
});
test('sequential Guess uses self question + ordered feedback; each participant rewarded/unlocked once; first only waits',async()=>{
 const h=await fixture();try{
  const id=await h.add('AR-V16');
  const a=await h.rpc('begin_friend_visit_v2',[h.A,id,h.version]);assert.match(a.question,/your partner a surprise/);
  assert.equal((await h.q('select count(*)::int n from user_friend_discoveries'))[0].n,0);
  const result=await h.rpc('respond_friend_visit_v2',[h.A,id,a.sessionId,h.version,'A']);assert.equal(result.reward,10);
  const wait=await h.rpc('friend_visit_view_v2',[h.A,id]);assert.equal(wait.waitingCopy,'Waiting for Sam');
  assert.ok(!JSON.stringify(wait).includes('feedback'));assert.ok(!JSON.stringify(wait).includes('choice'));
  const v=(await h.q('select * from friend_visit_instances_v2 where id=$1',[id]))[0];assert.equal(Date.parse(v.expires_at)-Date.parse(v.first_completed_at),86400000);
  const b=await h.rpc('begin_friend_visit_v2',[h.B,id,h.version]);assert.match(b.question,/threw you a surprise/);
  const second=await h.rpc('respond_friend_visit_v2',[h.B,id,b.sessionId,h.version,'B']);
  assert.match(second.feedback[0],/Alex guessed/);assert.equal(second.reward,10);
  assert.equal(await h.rpc('friend_visit_view_v2',[h.A,id]),null);assert.equal(await h.rpc('friend_visit_view_v2',[h.B,id]),null);
  assert.equal((await h.q('select count(*)::int n from user_friend_discoveries where interaction_completed_at is not null and source_visit_id is not null'))[0].n,2);
  assert.equal((await h.rpc('respond_friend_visit_v2',[h.B,id,b.sessionId,h.version,'B'])).applied,false);
  assert.equal((await h.rpc('respond_friend_visit_v2',[h.B,id,b.sessionId,h.version,'A'])).error,'idempotency_conflict');
  assert.equal((await h.q('select sum(carrot_balance)::int n from wallets'))[0].n,20);
  assert.equal((await h.q('select count(*)::int n from user_inventory'))[0].n,0);
 }finally{await h.db.close();}
});
test('concurrent initiators keep own replies; Trivia never reveals/computes partner picks; invalid/session/expiry/re-pair reject writes',async()=>{
 const h=await fixture();try{
  const id=await h.add();const a=await h.rpc('begin_friend_visit_v2',[h.A,id,h.version]),b=await h.rpc('begin_friend_visit_v2',[h.B,id,h.version]);
  assert.equal(a.question,b.question);
  await h.rpc('respond_friend_visit_v2',[h.A,id,a.sessionId,h.version,'A']);
  const rb=await h.rpc('respond_friend_visit_v2',[h.B,id,b.sessionId,h.version,'B']);assert.match(rb.feedback[0],/Efficient/);assert.ok(!rb.feedback.join(' ').includes('Alex'));
  const trivia=await h.add('MM-V01','2030-01-09');const ta=await h.rpc('begin_friend_visit_v2',[h.A,trivia,h.version]);
  assert.equal((await h.rpc('respond_friend_visit_v2',[h.A,trivia,ta.sessionId,h.version,'forged'])).error,'invalid_response');
  const stale=await h.rpc('begin_friend_visit_v2',[h.A,trivia,h.version]);
  assert.equal((await h.rpc('respond_friend_visit_v2',[h.A,trivia,ta.sessionId,h.version,'A'])).error,'visit_session_changed');
  assert.equal((await h.rpc('respond_friend_visit_v2',[h.A,trivia,stale.sessionId,h.version,'A'])).reward,10);
  const tb=await h.rpc('begin_friend_visit_v2',[h.B,trivia,h.version]);
  const wrong=await h.rpc('respond_friend_visit_v2',[h.B,trivia,tb.sessionId,h.version,'B']);assert.equal(wrong.reward,5);assert.ok(!JSON.stringify(wrong).includes('partnerPick'));
  const expired=await h.add('MM-V02','2030-01-11');const ea=await h.rpc('begin_friend_visit_v2',[h.A,expired,h.version]);
  await h.rpc('respond_friend_visit_v2',[h.A,expired,ea.sessionId,h.version,'A']);
  await h.q("update friend_visit_instances_v2 set expires_at=now()-interval '1 second' where id=$1",[expired]);
  assert.equal((await h.rpc('begin_friend_visit_v2',[h.B,expired,h.version])).error,'visit_expired');
  assert.equal((await h.rpc('respond_friend_visit_v2',[h.A,expired,ea.sessionId,h.version,'A'])).applied,false);
  await h.q('update burrow_pair_versions set version=gen_random_uuid() where user_id=$1',[h.A]);
  assert.equal(await h.rpc('friend_visit_view_v2',[h.A,expired]),null);
  assert.equal((await h.rpc('respond_friend_visit_v2',[h.A,expired,ea.sessionId,h.version,'A'])).error,'pair_changed');
 }finally{await h.db.close();}
});
test('four friends cover every day: weekly <=2, never adjacent, categories rotate without reuse, pending stays; exhaust stops',async()=>{
 const h=await fixture();try{
  for(const code of ['MM','JN','PK','TW'])await h.q('insert into user_friend_discoveries(user_id,friend_id,source_adventure_id,interaction_completed_at) values($1,$2,gen_random_uuid(),now())',[h.A,`adventure_friend_${code.toLowerCase()}`]);
  const first=await h.rpc('schedule_friend_visit_v2',[h.A,'2030-01-07']);assert.ok(first);
  assert.equal(await h.rpc('schedule_friend_visit_v2',[h.B,'2030-01-20']),first,'unanswered never expires or replaced');
  await h.q('update friend_visit_instances_v2 set ended_at=now() where id=$1',[first]);
  assert.equal(await h.rpc('schedule_friend_visit_v2',[h.B,'2030-01-07']),null,'no second new visitor that day');
  for(let day=1;day<100;day++){
    const date=new Date(Date.UTC(2030,0,7+day)).toISOString().slice(0,10);
    const id=await h.rpc('schedule_friend_visit_v2',[h.A,date]);
    if(day<7)assert.ok(id,'four available friends fill each day');
    if(id)await h.q('update friend_visit_instances_v2 set ended_at=now() where id=$1',[id]);
  }
  const visits=await h.q('select * from friend_visit_instances_v2 order by visit_date');assert.equal(visits.length,80);
  const weeks=new Map(),last=new Map();let previous;
  for(const v of visits){
    if(previous)assert.ok(previous.friend_id!==v.friend_id||Date.parse(v.visit_date)-Date.parse(previous.visit_date)>86400000);
    const d=new Date(v.visit_date);d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));const key=d.toISOString().slice(0,10)+v.friend_id;
    weeks.set(key,(weeks.get(key)||0)+1);assert.ok(weeks.get(key)<=2);
    const before=last.get(v.friend_id);if(before&&before.n<15)assert.equal(v.kind,{Trivia:'Preference',Preference:'Guess',Guess:'Trivia'}[before.kind]);
    last.set(v.friend_id,{n:(before?.n||0)+1,kind:v.kind});previous=v;
  }
  assert.equal(new Set(visits.map(v=>v.question_id)).size,80);
  assert.equal(await h.rpc('schedule_friend_visit_v2',[h.A,'2031-01-01']),null);
 }finally{await h.db.close();}
});
test('room unlock skips real Stranger selection and repairs reserved/bound plans without touching gift',async()=>{
 const h=await fixture();try{
  const id=await h.add(),s=await h.rpc('begin_friend_visit_v2',[h.B,id,h.version]);
  for(const seq of [1,2,3])await h.q("insert into adventure_dialogues_v2(id,friend_id,phase,seq,content) values($1,'adventure_friend_mm','Intro',$2,$3)",["MM-0"+seq,seq,{id:"MM-0"+seq}]);
  await h.q("insert into catalog_items(stable_id,metadata,tags,asset) values('gift','{\"friendId\":\"adventure_friend_mm\"}',array['adventure_v2_gift'],'{}')");
  await h.q("insert into adventure_encounter_plans(user_id,friend_id,dialogue_id,gift_id,snapshot) values($1,'adventure_friend_mm','MM-01','gift','{\"dialogue\":{\"id\":\"MM-01\"},\"giftSnapshot\":{\"stable_id\":\"gift\"}}')",[h.B]);
  await h.rpc('respond_friend_visit_v2',[h.B,id,s.sessionId,h.version,'A']);
  const plan=(await h.q('select * from adventure_encounter_plans where user_id=$1',[h.B]))[0];assert.equal(plan.dialogue_id,'MM-02');assert.equal(plan.gift_id,'gift');assert.equal(plan.snapshot.giftSnapshot.stable_id,'gift');
  await h.q('delete from adventure_encounter_plans where user_id=$1',[h.B]);
  await h.rpc('prepare_adventure_encounters_v2',[h.B]);
  assert.equal((await h.q('select dialogue_id from adventure_encounter_plans where user_id=$1 order by id limit 1',[h.B]))[0].dialogue_id,'MM-02');
  assert.equal((await h.q('select count(*)::int n from adventure_dialogue_completions'))[0].n,0,'no fake Adventure completion or gift award');
  const journey=(await h.q("insert into adventures(user_id,status) values($1,'in_progress') returning id",[h.B]))[0].id;
  await h.q("update adventure_encounter_plans set dialogue_id='MM-01',adventure_id=$2,status='bound' where user_id=$1",[h.B,journey]);
  await h.rpc('skip_visit_stranger_plans_v1',[h.B]);
  const bound=(await h.q('select * from adventure_encounter_plans where user_id=$1',[h.B]))[0];
  assert.equal(bound.dialogue_id,'MM-02');assert.equal(bound.gift_id,'gift');assert.equal(bound.adventure_id,journey);
 }finally{await h.db.close();}
});
