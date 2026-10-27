// Approved release stages; never sends a real gift, modifies a wallet or signs
// in as a user. Backups contain schema definitions and aggregate counts only.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
const [mode,dir]=process.argv.slice(2);assert.ok(dir?.startsWith('/private/tmp/burrow-surprise261-release.'));
assert.equal(fs.readFileSync('supabase/.temp/project-ref','utf8').trim(),'qleeohkhbrdvznbwgqad');
const version='20261022000261',source=fs.readFileSync('supabase/migrations/'+version+'_surprise_paid_delivery.sql','utf8');
const hash=createHash('md5').update(source).digest('hex');
const changed=new Set(['complete_burrow_surprise_v1','burrow_surprise_send_status_v1','burrow_reward_wallet_state_v1','collect_surprise_garbage_v1']);
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const json=(name,data)=>fs.writeFileSync(dir+'/'+name+'.json',JSON.stringify(data,null,2)+'\n',{mode:0o600});
function query(sql){const file=dir+'/query.sql';fs.writeFileSync(file,sql,{mode:0o600});const r=JSON.parse(execFileSync('/opt/homebrew/bin/supabase',['db','query','--linked','--output','json','--file',file],{encoding:'utf8',timeout:120000,maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']}));return Array.isArray(r)?r:r.rows;}
const tables=['wallets','currency_ledger','burrow_surprises','moment_events','user_inventory','adventures','daily_quest_assignments','quest_progress_vnext'];
const digests=tables.map(t=>`select '${t}'::text name,count(*) n,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),'')) digest from public.${t} t`).join(' union all ');
// Exclude additive NULL columns when comparing pre-existing Surprise rows.
const comparable=digests.replaceAll('to_jsonb(t)::text',"(to_jsonb(t)-'paid_at'-'refunded_at')::text");
function state(){return query(`select jsonb_build_object('migrations',(select jsonb_object_agg(version,md5(statements[1])) from supabase_migrations.schema_migrations where version in('20261022000260','${version}')),
 'functions',(select jsonb_object_agg(oid::text,jsonb_build_object('name',proname,'definition',pg_get_functiondef(oid),'grants',proacl)) from pg_proc where pronamespace='public'::regnamespace and prokind='f'),
 'columns',(select jsonb_agg(column_name) from information_schema.columns where table_schema='public' and table_name='burrow_surprises'),
 'prepaidCount',(select count(*) from burrow_surprises s where to_jsonb(s)->>'paid_at' is not null),
 'serviceOnly',(select bool_and(case when to_regprocedure(fn) is null then null else not has_function_privilege(r,fn,'execute') end) from (values('anon'),('authenticated')) roles(r) cross join
  (values('public.pay_burrow_surprise_v1(uuid,uuid,text,uuid,text,integer,text,integer)'),('public.cancel_paid_burrow_surprise_v1(uuid,uuid)'),('public.recover_paid_burrow_surprises_v1()')) funcs(fn)
  where to_regprocedure(fn) is not null)) state;`)[0].state;}
function unchanged(before,after){for(const [oid,fn] of Object.entries(before.functions)){const next=after.functions[oid];assert.ok(next,'Removed function '+fn.name);assert.deepEqual(next.grants,fn.grants,'Changed grants '+fn.name);if(!changed.has(fn.name))assert.equal(next.definition,fn.definition,'Unrelated function changed '+fn.name);}}
if(mode==='inspect'){
 const before=state();assert.ok(before.migrations['20261022000260']);assert.ok(!before.migrations[version]);json('before',before);
 fs.writeFileSync(dir+'/original-functions.sql',Object.values(before.functions).filter(f=>changed.has(f.name)).map(f=>f.definition+';').join('\n'),{mode:0o600});
 console.log(JSON.stringify({preflight:true,existingFunctions:Object.keys(before.functions).length,existingPaidOrders:before.prepaidCount}));
}else if(mode==='apply'){
 const before=JSON.parse(fs.readFileSync(dir+'/before.json'));const current=state();unchanged(before,current);assert.ok(!current.migrations[version]);
 const sql=`begin isolation level repeatable read;set local lock_timeout='5s';set local statement_timeout='60s';
 create temporary table release261_before on commit drop as ${comparable};
 ${source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'')}
 create temporary table release261_after on commit drop as ${comparable};
 do $guard$ begin if exists(select * from release261_before except select * from release261_after) or exists(select * from release261_after except select * from release261_before)
 then raise exception 'Protected user data changed';end if;end $guard$;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','surprise_paid_delivery',array[${quote(source)}]);commit;`;
 query(sql);const after=state();unchanged(before,after);assert.equal(after.migrations[version],hash);assert.equal(after.serviceOnly,true);assert.equal(after.prepaidCount,before.prepaidCount);
 assert.ok(after.columns.includes('paid_at')&&after.columns.includes('refunded_at'));json('verified',after);
 console.log(JSON.stringify({migration:261,registered:true,userRowsUnchanged:true,existingFunctionGrantsUnchanged:true,unrelatedFunctionDefinitionsUnchanged:true,serviceOnly:true,prepaidOrdersCreated:0}));
}else if(mode==='verify'){
 const before=JSON.parse(fs.readFileSync(dir+'/before.json')),after=state();unchanged(before,after);assert.equal(after.migrations[version],hash);assert.equal(after.serviceOnly,true);
 json('final',after);console.log(JSON.stringify({migration:261,sourceHashVerified:true,serviceOnly:true}));
}else throw Error('Use inspect/apply/verify');
