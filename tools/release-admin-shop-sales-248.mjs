// Apply only the additive, read-only reporting migration; never db push.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
assert.equal(fs.readFileSync(path.join(root, 'supabase/.temp/project-ref'), 'utf8').trim(), 'qleeohkhbrdvznbwgqad');
const version = '20261019000248', name = 'admin_shop_sales';
const source = fs.readFileSync(path.join(root, `supabase/migrations/${version}_${name}.sql`), 'utf8');
const hash = createHash('md5').update(source).digest('hex');
const body = source.replace(/^begin;\s*$/m, '').replace(/^commit;\s*$/m, '');
assert.doesNotMatch(source, /\b(?:insert|update|delete|truncate|drop)\b/i);
assert.ok(!source.includes('$migration248$'));
function query(sql) {
  const result = JSON.parse(execFileSync('supabase', ['db', 'query', '--linked', '--output', 'json', sql],
    { cwd: root, encoding: 'utf8', timeout: 90000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
  return Array.isArray(result) ? result : result.rows;
}
const before = query(`select version, md5(statements[1]) hash from supabase_migrations.schema_migrations where version in ('20261018000247','${version}')`);
assert.ok(before.some(row => row.version === '20261018000247'), 'Migration 247 must already be installed');
const existing = before.find(row => row.version === version);
let applied = false;
if (!existing && !process.argv.includes('--apply')) {
  console.log(JSON.stringify({ migration: 248, applied: false, readyToApply: true, sourceHash: hash }));
  process.exit(0);
}
if (existing) assert.equal(existing.hash, hash, 'Registered migration must match source');
else if (process.argv.includes('--apply')) {
  query(`begin; set local lock_timeout='5s'; set local statement_timeout='60s';
    select pg_advisory_xact_lock(hashtextextended('novame:admin-shop-sales-248',0));
    do $guard248$ begin
      if exists(select 1 from supabase_migrations.schema_migrations where version='${version}') then
        raise exception 'Migration already registered'; end if;
    end $guard248$;
    ${body}
    insert into supabase_migrations.schema_migrations(version,name,statements)
      values('${version}','${name}',array[$migration248$${source}$migration248$]);
    commit; select true as applied;`);
  applied = true;
}
const report = query(`select jsonb_build_object(
  'sourceHash',(select md5(statements[1]) from supabase_migrations.schema_migrations where version='${version}'),
  'anonCanExecute',has_function_privilege('anon','public.admin_shop_sales_v1(timestamptz,timestamptz,text)','execute'),
  'authenticatedCanExecute',has_function_privilege('authenticated','public.admin_shop_sales_v1(timestamptz,timestamptz,text)','execute'),
  'serviceCanExecute',has_function_privilege('service_role','public.admin_shop_sales_v1(timestamptz,timestamptz,text)','execute'),
  'securityInvoker',not (select prosecdef from pg_proc where oid='public.admin_shop_sales_v1(timestamptz,timestamptz,text)'::regprocedure),
  'reportRows',jsonb_array_length(public.admin_shop_sales_v1()->'rows')) as verification;`)[0].verification;
assert.equal(report.sourceHash, hash); assert.equal(report.anonCanExecute, false);
assert.equal(report.authenticatedCanExecute, false); assert.equal(report.serviceCanExecute, true); assert.equal(report.securityInvoker, true);
console.log(JSON.stringify({ migration: 248, appliedThisRun: applied, ...report, verifiedAt: new Date().toISOString() }));
