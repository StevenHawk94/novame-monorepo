const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, hooks, flush, deferred } = require('./lifecycle-test-utils.cjs');

const root = path.resolve(__dirname, '..');
const questions = load('apps/mobile/src/lib/couple-journal-questions.ts');

test('Couple Journal seeds fifty distinct prompts and isolates one answer per author and pairing generation', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261001000151_couple_journal.sql'), 'utf8');
  const seeds = [...sql.matchAll(/\('cj_(\d{2})',(\d+),'([^']+)'\)/g)];
  assert.equal(seeds.length, 50);
  assert.deepEqual(seeds.map(match => Number(match[2])), Array.from({ length: 50 }, (_, index) => index + 1));
  assert.equal(new Set(seeds.map(match => match[3])).size, 50);
  assert.match(sql, /unique\(pair_low,pair_high,pair_version,local_date\)/);
  assert.match(sql, /unique\(page_id,author_id\)/);
  assert.match(sql, /p\.local_date<least\(v_today,coalesce\(p_before_date,v_today\)\)/);
  assert.match(sql, /exists\(select 1 from public\.couple_journal_answers/);
  assert.match(sql, /p_expected_updated_at is distinct from v_answer\.updated_at/);
});

test('solo journal pages remain private and map icons resolve to bundled files', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261001000152_couple_journal_solo.sql'), 'utf8');
  assert.match(sql, /check \(pair_low <= pair_high\)/);
  assert.match(sql, /v_low:=p_user_id; v_high:=p_user_id; v_version:='solo'/);
  assert.match(sql, /'private',p\.pair_low=p\.pair_high/);
  assert.match(sql, /p\.pair_low=p_user_id and p\.pair_high=p_user_id and p\.pair_version='solo'/);
  const source = fs.readFileSync(path.join(root, 'apps/mobile/src/lib/burrow-ui-assets.ts'), 'utf8');
  for (const [, asset] of source.matchAll(/require\('\.\.\/\.\.\/assets\/burrow-webp\/burrow page icons\/([^']+)'\)/g)) {
    assert.ok(fs.existsSync(path.join(root, 'apps/mobile/assets/burrow-webp/burrow page icons', asset)), asset);
  }
});

test('cached page is immediate on the same day and invalid at pair or date change', () => {
  const journal = load('apps/mobile/src/lib/couple-journal.ts', {
    './couple-journal-questions': questions,
    './storage': { storage: { getString() {}, set() {} } },
    '../shared/storage/keys': { kBurrowJournal: { keyFor: value => value } },
    './api': { apiClient: {} },
    './async-lifecycle': { withDeadline: value => value },
    './session-lifecycle': { sessionUserId: () => 'pair-one', sessionEpoch: () => 0, subscribeSessionIdentity: () => () => {} },
  });
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const today = `${values.year}-${values.month}-${values.day}`;
  const example = { todayDate: today, timezone: 'UTC', today: { id: 'page', answers:[] }, history: [] };
  journal.cacheCoupleJournal('pair-one', example);
  assert.equal(journal.cachedCoupleJournal('pair-one'), example);
  assert.equal(journal.cachedCoupleJournal('pair-two'), null);
  journal.cacheCoupleJournal('pair-one', { ...example, todayDate: '2026-01-01' });
  assert.equal(journal.cachedCoupleJournal('pair-one'), null);
});


test('bundled questions match all fifty server seeds, including cycle wrap and negative dates', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261001000151_couple_journal.sql'), 'utf8');
  const seeds = [...sql.matchAll(/\('cj_(\d{2})',(\d+),'([^']+)'\)/g)];
  assert.equal(questions.COUPLE_JOURNAL_QUESTIONS.length, 50);
  for (const [index, match] of seeds.entries()) {
    const date = new Date(Date.UTC(2026, 9, 1 + index)).toISOString().slice(0, 10);
    const question = questions.coupleJournalQuestion(date);
    assert.equal(question.id, `cj_${match[1]}`);
    assert.equal(question.question, match[3]);
  }
  assert.equal(questions.coupleJournalQuestion('2026-09-30').id, 'cj_50');
  assert.equal(questions.coupleJournalQuestion('2026-11-20').id, 'cj_01');
  const boundary = Date.parse('2026-10-01T00:30:00Z');
  assert.equal(questions.coupleJournalDate('America/Los_Angeles', boundary), '2026-09-30');
  assert.equal(questions.coupleJournalDate('Asia/Shanghai', boundary), '2026-10-01');
});

function journalHarness() {
  const disk = new Map(), calls = [], read = deferred();
  let identity = 'me', epoch = 0, identityListener;
  const storage = { getString: key => disk.get(key), set: (key, value) => disk.set(key, value) };
  const session = { sessionUserId: () => identity, sessionEpoch: () => epoch,
    subscribeSessionIdentity: fn => { identityListener = fn; return () => {}; } };
  const date = questions.coupleJournalDate('UTC');
  const today = { id: 'real-page', date, private: true, pageNumber: 1,
    questionId: questions.coupleJournalQuestion(date).id, question: questions.coupleJournalQuestion(date).question, answers: [] };
  const snapshot = { success: true, today, history: [], hasMore: false, nextBefore: null,
    todayDate: date, timezone: 'UTC', pairVersion: 'solo' };
  const apiClient = {
    get: url => { calls.push({ method: 'GET', url }); return read.promise; },
    post: async (url, body) => { calls.push({ method: 'POST', url, body }); return { success: true,
      page: { ...today, answers: [{ id: 'answer', authorId: 'me', body: body.body, createdAt: 'now', updatedAt: 'now' }] } }; },
  };
  const imports = { './storage': { storage }, './api': { apiClient }, './session-lifecycle': session,
    './couple-journal-questions': questions, './async-lifecycle': { withDeadline: value => Promise.resolve(value) },
    '../shared/storage/keys': { kBurrowJournal: { keyFor: scope => `journal:${scope}` } } };
  const journal = load('apps/mobile/src/lib/couple-journal.ts', imports);
  return { journal, disk, storage, session, calls, read, snapshot, apiClient, imports,
    switchUser(user) { identity = user; epoch++; identityListener(); } };
}

test('cold entry and rollover use local questions; only own answers survive restart and pairing is isolated', () => {
  const j = journalHarness();
  const cold = j.journal.localCoupleJournal('me:solo');
  assert.equal(cold.today.id, questions.localJournalPageId(cold.todayDate));
  assert.equal(cold.today.question, j.snapshot.today.question);
  assert.equal(cold.today.private, true);
  const own = { id: 'a', authorId: 'me', body: 'My answer' };
  const partner = { id: 'b', authorId: 'partner', body: 'Private partner answer' };
  j.journal.cacheCoupleJournal('me:solo', { ...j.snapshot, today: { ...j.snapshot.today, answers: [own, partner] } });
  const restarted = load('apps/mobile/src/lib/couple-journal.ts', j.imports);
  assert.equal(restarted.localCoupleJournal('me:solo').today.answers.length, 1);
  assert.equal(restarted.localCoupleJournal('me:solo').today.answers[0].body, own.body);
  const yesterday = new Date(Date.parse(`${j.snapshot.todayDate}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  restarted.cacheCoupleJournal('me:solo', { ...j.snapshot, todayDate: yesterday,
    today: { ...j.snapshot.today, date: yesterday, pageNumber: 4, answers: [own] } });
  const rolled = restarted.localCoupleJournal('me:solo');
  assert.equal(rolled.today.answers.length, 0);
  assert.equal(rolled.today.pageNumber, 5);
  assert.equal(rolled.history[0].date, yesterday);
  assert.equal(rolled.history[0].answers[0].body, own.body);
  assert.equal(restarted.localCoupleJournal('me:new-pair'), null, 'unknown shared topic is not guessed or borrowed from an old pairing');
  assert.equal(restarted.localCoupleJournal('other:solo'), null);
  assert.equal(j.calls.length, 0, 'local rendering never requests the API');
});

test('concurrent reads coalesce and old-user requests cannot cross a session change', async () => {
  const j = journalHarness();
  const first = j.journal.fetchCoupleJournal(undefined, 'me:solo');
  assert.equal(j.journal.fetchCoupleJournal(undefined, 'me:solo'), first);
  assert.equal(j.calls.length, 1);
  j.switchUser('other');
  j.read.resolve(j.snapshot);
  await assert.rejects(first, /session_changed/);
});
test('v2 unfinished page stays current across local dates; confirmed completion archives immediately',()=>{
 const j=journalHarness(),scope='me:one';const page={...j.snapshot.today,date:'2026-01-01',protocol:2};
 const v2={...j.snapshot,protocol:2,todayDate:'2026-01-01',today:page};j.journal.cacheCoupleJournal(scope,v2);
 assert.equal(j.journal.localCoupleJournal(scope).today.id,page.id);assert.ok(j.journal.cachedCoupleJournal(scope));
 j.journal.cacheCoupleJournal(scope,{...v2,today:{...page,completedAt:new Date().toISOString(),nextAvailableAt:'2099-01-01T00:00:00Z'}});
 assert.equal(j.journal.cachedCoupleJournal(scope).history[0].id,page.id);
});
test('a late snapshot cannot erase or rewind an acknowledged own answer',()=>{
 const j=journalHarness(),scope='me:solo',answer={id:'own',authorId:'me',body:'Latest words',createdAt:'2026-10-24T00:00:00Z',updatedAt:'2026-10-24T12:00:00Z'};
 j.journal.cacheCoupleJournal(scope,{...j.snapshot,today:{...j.snapshot.today,answers:[answer]}});
 j.journal.cacheCoupleJournal(scope,j.snapshot);
 assert.equal(j.journal.cachedCoupleJournal(scope).today.answers[0].body,answer.body);
 j.journal.cacheCoupleJournal(scope,{...j.snapshot,today:{...j.snapshot.today,answers:[{...answer,body:'Old',updatedAt:'2026-10-24T01:00:00Z'}]}});
 assert.equal(j.journal.cachedCoupleJournal(scope).today.answers[0].body,answer.body);
});
test('Journal v2 API and read receipts bind actor and validate stable cursors',async()=>{
 const calls=[];const route=load('apps/api/src/app/api/vnext/couple-journal/route.js',{
  'next/server':{NextResponse:{json:(body,init={})=>({body,status:init.status??200})}},
  '@/lib/app-major-update':{authenticatedUserId:async()=> 'authenticated',majorUpdateEnabled:async()=>true,commandStatus:e=>e?400:200,
   appMajorUpdateServiceClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return{data:{page:{}},error:null};}})},
 },{URL});
 const id='11111111-1111-4111-8111-111111111111';
 assert.equal((await route.GET({url:'https://local/api?v=2&before=2026-10-24'})).status,400);
 await route.GET({url:'https://local/api?v=2&before='+id});assert.equal(calls[0].name,'couple_journal_snapshot_v2');assert.equal(calls[0].args.p_user_id,'authenticated');
 await route.PATCH({text:async()=>JSON.stringify({pageId:id,answerAt:'2026-10-24T12:00:00Z',userId:'attacker'})});
 assert.equal(calls[1].name,'read_couple_journal_v2');assert.equal(calls[1].args.p_user_id,'authenticated');
 assert.equal((await route.PATCH({text:async()=>JSON.stringify({pageId:id,answerAt:'invalid'})})).status,400);
});








test('Journal API binds reads and writes to the authenticated user', async () => {
  const calls = [];
  const db = { rpc: async (name, args) => {
    calls.push({ name, args });
    return { data: name === 'couple_journal_snapshot_v1' ? {
      today: { id: 'page' }, history: [], pairVersion: 'pair',
    } : { page: { id: 'page' } }, error: null };
  } };
  const route = load('apps/api/src/app/api/vnext/couple-journal/route.js', {
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    '@/lib/app-major-update': {
      appMajorUpdateServiceClient: () => db, authenticatedUserId: async () => 'authenticated-person',
      commandStatus: code => code ? 409 : 200, majorUpdateEnabled: async () => true,
    },
  }, { URL });
  const read = await route.GET({ url: 'https://example.test/api/vnext/couple-journal' });
  assert.equal(read.status, 200);
  assert.equal(calls[0].name, 'couple_journal_snapshot_v1');
  assert.equal(calls[0].args.p_user_id, 'authenticated-person');
  const write = await route.POST({ text: async () => JSON.stringify({
    pageId: '11111111-1111-4111-8111-111111111111',
    body: 'A little shared memory.',
    expectedUpdatedAt: null,
    idempotencyKey: '22222222-2222-4222-8222-222222222222',
    authorId: 'someone-else',
  }) });
  assert.equal(write.status, 200, JSON.stringify(write));
  assert.equal(calls[1].name, 'save_couple_journal_answer_v1');
  assert.equal(calls[1].args.p_user_id, 'authenticated-person');
  assert.equal(Object.hasOwn(calls[1].args, 'authorId'), false);
});
