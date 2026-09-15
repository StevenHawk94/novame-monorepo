const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function insertRows(sql, table, endMarker) {
  const start = sql.indexOf(`insert into public.${table}`);
  assert.ok(start >= 0, `${table} seed is present`);
  const end = sql.indexOf(endMarker, start);
  assert.ok(end > start, `${table} seed terminates`);
  return (sql.slice(start, end).match(/^\('[A-Z][A-Z0-9-]*'/gm) || []).length;
}

test('Bunny Court migration contains the reviewed workbook inventory', () => {
  const sql = read('supabase/migrations/20260915000088_bunny_court.sql');
  assert.equal(insertRows(sql, 'court_case_definitions', 'on conflict (case_id)'), 36);
  assert.equal(insertRows(sql, 'court_questions', 'on conflict (case_id, question_number)'), 132);
  assert.equal(insertRows(sql, 'court_verdict_templates', 'on conflict (case_id, outcome_key)'), 108);
  assert.match(sql, /content_snapshot jsonb not null/);
  assert.match(sql, /court_one_open_case_per_pair/);
  assert.match(sql, /status in \('awaiting_initiator','awaiting_partner','processing','ready'\)/);
  assert.match(sql, /perform realtime\.send\([\s\S]*'court_changed'/);
});

test('Bunny Court v2 migration contains the complete replacement workbook', () => {
  const sql = read('supabase/migrations/20260915000089_bunny_court_content_v2.sql');
  assert.equal(insertRows(sql, 'court_case_definitions', 'on conflict (case_id)'), 36);
  assert.equal(insertRows(sql, 'court_questions', 'on conflict (case_id, question_number)'), 132);
  assert.equal(insertRows(sql, 'court_verdict_templates', 'on conflict (case_id, outcome_key)'), 108);
  assert.equal(insertRows(sql, 'court_free_rule_branches', 'on conflict (case_id, outcome_key)'), 81);
  assert.match(sql, /content_version = 2/);
  assert.match(sql, /THE ACT-CHILL FRAUD TRIAL/);
  assert.match(sql, /Your fake chill will be noted/);
  assert.match(sql, /revoke all on public\.court_free_rule_branches from public, anon, authenticated/);
});

test('v2 deterministic engine follows the reviewed Free Rule Engine branches', async () => {
  const modulePath = path.join(root, 'apps/api/src/lib/bunny-court-rules-v2.mjs');
  const { fixedLaunchOutcomeV2 } = await import(pathToFileURL(modulePath).href);
  const run = (caseId, dimensions, first, second) => fixedLaunchOutcomeV2(
    { case_id: caseId },
    dimensions.map((analysis_dimension, index) => ({ analysis_dimension, question_number: index + 1 })),
    Object.fromEntries(dimensions.map((dimension, index) => [index + 1, first[dimension]])),
    Object.fromEntries(dimensions.map((dimension, index) => [index + 1, second[dimension]])),
  );

  const cases = [
    ['LOVE-04', ['initiation_channels', 'desired_channel'], { initiation_channels: ['text'], desired_channel: 'balanced' }, { initiation_channels: ['plan'], desired_channel: 'plans' }, 'balanced'],
    ['CLOSE-02', ['comfort_pick', 'plan_pick', 'support_pick', 'current_phrase'], { comfort_pick: 'a', plan_pick: 'b', support_pick: 'c', current_phrase: 'd' }, { comfort_pick: 'a', plan_pick: 'b', support_pick: 'c', current_phrase: 'x' }, 'high'],
    ['CLOSE-06', ['food_pick', 'free_hour', 'message_pick', 'treat_pick'], { food_pick: 'a', free_hour: 'b', message_pick: 'c', treat_pick: 'd' }, { food_pick: 'a', free_hour: 'b', message_pick: 'x', treat_pick: 'y' }, 'good'],
    ['LIFE-01', ['craving', 'effort', 'budget'], { craving: 'comfort', effort: 'pickup', budget: 'low' }, { craving: 'comfort', effort: 'delivery', budget: 'low' }, 'clear'],
    ['LIFE-02', ['need', 'structure', 'must_have'], { need: 'rest', structure: 'none', must_have: 'alone_time' }, { need: 'fun', structure: 'light', must_have: 'movement' }, 'rest_adventure'],
    ['LIFE-03', ['energy_window', 'format', 'duration'], { energy_window: 'evening', format: 'voice', duration: '10' }, { energy_window: 'evening', format: 'video', duration: '60' }, 'energy_gap'],
    ['LIFE-04', ['priority', 'pace'], { priority: 'rest', pace: 'open' }, { priority: 'rest', pace: 'balanced' }, 'pace_gap'],
    ['LIFE-05', ['mood', 'attention', 'fairness'], { mood: 'cozy', attention: 'background', fairness: 'shared' }, { mood: 'cozy', attention: 'light', fairness: 'shared' }, 'attention_gap'],
    ['LIFE-06', ['capacity', 'history'], { capacity: 'none', history: 'shared' }, { capacity: 'low', history: 'shared' }, 'low_capacity'],
    ['MIDDLE-01', ['comfort_window', 'reassurance_signal', 'commitment'], { comfort_window: 'hours', reassurance_signal: 'status', commitment: 'signal' }, { comfort_window: 'end_of_day', reassurance_signal: 'status', commitment: 'context' }, 'aligned'],
    ['MIDDLE-02', ['conflict_pace', 'pause_risk', 'pause_length', 'return_signal'], { conflict_pace: 'short_pause', pause_risk: ['cold_tone'], pause_length: 'hours', return_signal: 'set_time' }, { conflict_pace: 'overnight', pause_risk: ['none'], pause_length: 'overnight', return_signal: 'next_day' }, 'too_hot'],
    ['MIDDLE-03', ['first_need', 'avoid', 'phrase'], { first_need: 'advice', avoid: [], phrase: 'clarify' }, { first_need: 'listening', avoid: ['advice'], phrase: 'validation' }, 'fixer_listener'],
    ['MIDDLE-04', ['space_meaning', 'duration', 'reassurance'], { space_meaning: 'quiet', duration: 'hours', reassurance: 'relationship_ok' }, { space_meaning: 'processing', duration: 'day', reassurance: 'return_time' }, 'unclear'],
    ['MIDDLE-05', ['quality_type', 'ritual', 'capacity'], { quality_type: 'focused_talk', ritual: 'call', capacity: '10m' }, { quality_type: 'quiet_company', ritual: 'call', capacity: '30m' }, 'aligned'],
    ['MIDDLE-06', ['battery', 'contact_level', 'compromise'], { battery: 'low', contact_level: 'quiet_company', compromise: 'brief' }, { battery: 'medium', contact_level: 'one_on_one', compromise: 'timed' }, 'aligned'],
    ['LOVE-F01', ['give_style', 'receive_style'], { give_style: 'detail', receive_style: 'time' }, { give_style: 'time', receive_style: 'detail' }, 'double_match'],
    ['LOVE-F02', ['sent_signal', 'wanted_signal'], { sent_signal: 'quiet', wanted_signal: 'photo' }, { sent_signal: 'photo', wanted_signal: 'plan_contact' }, 'same_frequency'],
    ['LOVE-F03', ['date_energy', 'budget', 'planning_capacity'], { date_energy: 'full_date', budget: 'medium', planning_capacity: 'simple_plan' }, { date_energy: 'surprise', budget: 'high', planning_capacity: 'none' }, 'proper_date'],
    ['CLOSE-F01', ['first_need', 'reply_load'], { first_need: 'space', reply_load: 'later' }, { first_need: 'listen', reply_load: 'conversation' }, 'soft_mode'],
    ['CLOSE-F02', ['current_lift', 'energy_drain', 'followup'], { current_lift: 'a', energy_drain: 'b', followup: 'c' }, { current_lift: 'a', energy_drain: 'x', followup: 'y' }, 'signal_found'],
    ['CLOSE-F03', ['available_signal', 'wanted_signal'], { available_signal: 'reaction', wanted_signal: 'text' }, { available_signal: 'text', wanted_signal: 'reaction' }, 'quiet_sync'],
    ['LIFE-F01', ['battery', 'channel'], { battery: 'zero', channel: 'text' }, { battery: 'high', channel: 'call' }, 'solo_reset'],
    ['LIFE-F02', ['duration', 'habitat'], { duration: '10', habitat: 'nearby' }, { duration: '60', habitat: 'nearby' }, 'remote_microdate'],
    ['LIFE-F03', ['hated_chore', 'tolerated_chores', 'recent_load'], { hated_chore: 'dishes', tolerated_chores: ['laundry'], recent_load: 'shared' }, { hated_chore: 'laundry', tolerated_chores: [], recent_load: 'shared' }, 'clean_swap'],
    ['MIDDLE-F01', ['frequency', 'channel', 'busy_signal'], { frequency: 'daily', channel: 'text', busy_signal: 'status' }, { frequency: 'organic', channel: 'text', busy_signal: 'status' }, 'light_bridge'],
    ['MIDDLE-F02', ['sting_trigger', 'repair'], { sting_trigger: 'tone', repair: 'warmth' }, { sting_trigger: 'tone', repair: 'warmth' }, 'shared_protocol'],
    ['MIDDLE-F03', ['trigger', 'boundary'], { trigger: 'none', boundary: 'responsive' }, { trigger: 'ignored', boundary: 'ask_first' }, 'awareness_only'],
  ];
  for (const [caseId, dimensions, first, second, expected] of cases) {
    assert.equal(run(caseId, dimensions, first, second), expected, caseId);
  }
});

test('private testimony is server-only and AI has no provider fallback', () => {
  const service = read('apps/api/src/lib/bunny-court.js');
  const sessionRoute = read('apps/api/src/app/api/court/[sessionId]/route.js');
  const view = service.slice(service.indexOf('export async function sessionView'));
  assert.doesNotMatch(view, /select\([^)]*answers/);
  assert.match(service, /skipDeepSeek: true/);
  assert.match(service, /ilike\('status', '%Launch'\)/);
  assert.match(service, /feature: 'bunny_court'/);
  assert.match(service, /promptVersion: 'court-v2'/);
  assert.match(service, /content_version \|\| 1\) >= 2/);
  assert.match(service, /'ai_failure_template'/);
  assert.match(sessionRoute, /after\(\(\) => processCourtVerdictJob/);
  assert.doesNotMatch(sessionRoute, /await processCourtVerdictJob/);
  assert.match(service, /EXPIRABLE_STATUSES = \['awaiting_initiator', 'awaiting_partner', 'processing'\]/);
  assert.doesNotMatch(service, /EXPIRABLE_STATUSES = \[[^\]]*ready/);
  for (const caseId of [
    'LOVE-04', 'CLOSE-02', 'CLOSE-06', 'LIFE-01', 'LIFE-02', 'LIFE-03', 'LIFE-04', 'LIFE-05', 'LIFE-06',
    'MIDDLE-01', 'MIDDLE-02', 'MIDDLE-03', 'MIDDLE-04', 'MIDDLE-05', 'MIDDLE-06',
    'LOVE-F01', 'LOVE-F02', 'LOVE-F03', 'CLOSE-F01', 'CLOSE-F02', 'CLOSE-F03',
    'LIFE-F01', 'LIFE-F02', 'LIFE-F03', 'MIDDLE-F01', 'MIDDLE-F02', 'MIDDLE-F03',
  ]) assert.match(service, new RegExp(`case '${caseId}'`), `${caseId} has reviewed deterministic branching`);

  const migration = read('supabase/migrations/20260915000088_bunny_court.sql');
  assert.match(migration, /revoke all on public\.court_case_definitions[\s\S]*from public, anon, authenticated/);
});

test('Focus runtime and reward paths are replaced by Thump', () => {
  const home = read('apps/mobile/app/(main)/(tabs)/index.tsx');
  const layout = read('apps/mobile/app/(main)/_layout.tsx');
  const queue = read('apps/mobile/src/lib/download-queue.ts');
  const xp = read('packages/engine/src/xp.ts');
  assert.match(home, />Thump</);
  assert.match(home, /\/\(main\)\/thump/);
  assert.match(layout, /name="thump"/);
  assert.doesNotMatch(queue, /focus-voice|syncAllFocus/);
  assert.doesNotMatch(xp, /\| 'focus'|focus:\s*\{/);
  assert.equal(fs.existsSync(path.join(root, 'apps/mobile/app/(main)/focus.tsx')), false);
  assert.equal(fs.existsSync(path.join(root, 'apps/mobile/src/lib/focus-voice.ts')), false);
});
