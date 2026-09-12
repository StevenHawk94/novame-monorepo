/* Offline tests for the database-template Connection pipeline. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function source(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function load(file, imports = {}) {
  const code = ts.transpileModule(source(file), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      allowJs: true,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    console,
    Date,
    require(name) {
      if (Object.hasOwn(imports, name)) return imports[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
  }, { filename: file });
  return module.exports;
}

const evidence = load('apps/api/src/lib/connection-evidence.js');
const card = load('apps/api/src/lib/connection-card.js');
const legacyAi = load('apps/api/src/lib/reflect-ai.js', {
  './ai': { callAI: async () => ({ text: '{}' }), parseAIJson: JSON.parse },
  './item-learning-evidence': { itemLearningHints: () => [], cleanLearningSignals: () => [] },
  './connection-evidence': evidence,
  './connection-card': card,
});

function connectionAiWithResponses(responses) {
  const queue = [...responses];
  return load('apps/api/src/lib/connection-ai.js', {
    './ai': {
      callAI: async () => ({
        text: JSON.stringify(queue.shift() || {}),
        provider: 'test',
        model: 'test',
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
      parseAIJson: JSON.parse,
    },
    './item-learning-evidence': {
      itemLearningHints: () => [],
      cleanLearningSignals: (value) => Array.isArray(value) ? value : [],
    },
    './connection-evidence': evidence,
    './reflect-ai': { cleanConnectionUpdates: legacyAi.cleanConnectionUpdates },
  });
}

function signal(id, section, familyKey) {
  return {
    signalId: id,
    topicKey: `${id}_topic`,
    kind: section === 'ways_in' ? 'support_need' : 'event',
    summary: `Safe compact evidence for ${id}.`,
    continuity: 'one_off',
    sentiment: 'neutral',
    supportMode: section === 'ways_in' ? 'listen' : null,
    confidence: 0.9,
    cardEligible: true,
    assignedSection: section,
    familyKey,
    newValue: 'Adds a useful second layer.',
    whyQualified: 'The reader gains a concrete implication.',
  };
}

function emptyUpdates() {
  return Object.fromEntries(legacyAi.CONNECTION_DIMENSIONS.map((key) => [key, {
    hasUpdate: false,
    clearExisting: false,
    cards: [],
  }]));
}

function missedCard(id) {
  return {
    signalId: id,
    topicKey: `${id}_topic`,
    signalType: 'event',
    assignedSection: 'missed',
    labelKey: 'quiet_win',
    label: 'Quiet Win',
    title: 'The effort finally moved',
    observation: 'They crossed a meaningful threshold after sustained effort.',
    meaning: null,
    takeaway: null,
    confidence: 0.9,
    whyThis: 'The change matters beyond the event itself.',
    expiresAt: null,
  };
}

function waysCard(id) {
  return {
    signalId: id,
    topicKey: `${id}_topic`,
    signalType: 'action',
    assignedSection: 'ways_in',
    labelKey: 'listen',
    label: 'Open Ear',
    title: null,
    observation: 'They need room to decompress before turning the moment into a plan.',
    meaning: null,
    takeaway: 'Offer ten quiet minutes and let them decide whether to talk.',
    confidence: 0.88,
    whyThis: 'The action follows the stated support need.',
    expiresAt: null,
  };
}

test('router performs value/family routing without generating card copy', async () => {
  const routed = signal('signal_one', 'missed', 'milestone_or_quiet_win');
  const ai = connectionAiWithResponses([{
    learningCandidates: [],
    decision: 'update',
    connectionSignals: [routed],
  }]);
  assert.doesNotMatch(ai.CONNECTION_ROUTER_SYSTEM_PROMPT, /Return ONLY valid JSON:[\s\S]*connectionUpdates/);
  const result = await ai.runConnectionRouter({
    reflectId: 'reflect-1', journal: 'private input', connectionEnabled: true,
    familyCatalog: [{
      familyKey: 'milestone_or_quiet_win', section: 'missed',
    }], currentConnectionBoard: null,
  });
  assert.equal(result.data.decision, 'update');
  assert.equal(result.data.eligibleSignals[0].familyKey, 'milestone_or_quiet_win');
});

test('matcher writes custom cards while writer receives only exact matched templates', async () => {
  const customUpdates = emptyUpdates();
  customUpdates.how_to_show_up = {
    hasUpdate: true, clearExisting: false, cards: [waysCard('need_space')],
  };
  const matchedUpdates = emptyUpdates();
  matchedUpdates.worth_knowing = {
    hasUpdate: true, clearExisting: true, cards: [missedCard('career_win')],
  };
  const ai = connectionAiWithResponses([
    {
      signalResults: [
        {
          signalId: 'career_win', outcome: 'matched', familyKey: 'milestone_or_quiet_win',
          scenarioKey: 'quiet_threshold', moduleKey: 'worth_knowing',
        },
        {
          signalId: 'need_space', outcome: 'custom', familyKey: null,
          scenarioKey: null, moduleKey: 'how_to_show_up',
        },
      ],
      connectionUpdates: customUpdates,
    },
    { connectionUpdates: matchedUpdates },
  ]);
  const selectedSignals = [
    signal('career_win', 'missed', 'milestone_or_quiet_win'),
    signal('need_space', 'ways_in', null),
  ];
  const scenarioIndex = [{
    familyKey: 'milestone_or_quiet_win', section: 'missed',
    moduleKey: 'worth_knowing', scenarioKey: 'quiet_threshold',
    scenario: 'A meaningful effort crosses a quiet threshold.',
    requiredEvidence: ['concrete progress'], disqualifiers: [],
  }];
  const matcher = await ai.runConnectionMatcher({
    reflectId: 'reflect-2', journal: 'private input', selectedSignals,
    scenarioIndex, currentConnectionBoard: null, readerRecentEvidence: [],
  });
  assert.equal(matcher.signalResults.length, 2);
  assert.equal(matcher.data.how_to_show_up.cards.length, 1);
  assert.equal(matcher.data.worth_knowing.cards.length, 0);

  const matchedSignal = selectedSignals[0];
  const matchedResult = matcher.signalResults[0];
  const exactTemplate = {
    ...scenarioIndex[0], templateId: 'template-one',
    templateCard: { title: 'Structural reference only' },
  };
  const writer = await ai.runConnectionWriter({
    reflectId: 'reflect-2', journal: 'private input',
    selectedSignals: [matchedSignal], signalResults: [matchedResult],
    generationRequests: [{
      signal: matchedSignal, outcome: 'matched', scenarioKey: 'quiet_threshold',
      scenarioTemplate: exactTemplate,
    }],
    currentConnectionBoard: null, readerRecentEvidence: [],
  });
  const merged = ai.mergeConnectionUpdates([matcher.data, writer.data], 'reflect-2');
  assert.equal(merged.worth_knowing.cards.length, 1);
  assert.equal(merged.how_to_show_up.cards.length, 1);
  assert.equal(merged.worth_knowing.clearExisting, false);
});

test('writer prompt enforces deeper value, concrete action, pronouns, and non-template phrasing', () => {
  const ai = connectionAiWithResponses([]);
  assert.match(ai.CONNECTION_WRITER_SYSTEM_PROMPT, /Memories already show the event/i);
  assert.match(ai.CONNECTION_WRITER_SYSTEM_PROMPT, /structural and tonal reference/i);
  assert.match(ai.CONNECTION_WRITER_SYSTEM_PROMPT, /only as they, them, their, or theirs/i);
  assert.match(ai.CONNECTION_WRITER_SYSTEM_PROMPT, /Never begin with “It sounds like/i);
  assert.match(ai.CONNECTION_WRITER_SYSTEM_PROMPT, /give one low-pressure action usable now/i);
  assert.match(ai.CONNECTION_MATCHER_SYSTEM_PROMPT, /Do not write a card for matched signals/i);
  assert.match(ai.CONNECTION_MATCHER_SYSTEM_PROMPT, /Write one original card/i);
});

test('matcher rejects mismatched scenario keys and normalizes custom card metadata', async () => {
  const custom = waysCard('signal_two');
  custom.assignedSection = 'missed';
  custom.signalType = 'event';
  custom.topicKey = 'model_invented_topic';
  const updates = emptyUpdates();
  updates.worth_knowing = { hasUpdate: true, clearExisting: false, cards: [custom] };
  const ai = connectionAiWithResponses([{
    signalResults: [
      {
        signalId: 'signal_one', outcome: 'matched', familyKey: 'wrong_family',
        scenarioKey: 'wrong_scenario', moduleKey: 'worth_knowing',
      },
      {
        signalId: 'signal_two', outcome: 'custom', familyKey: null,
        scenarioKey: null, moduleKey: 'how_to_show_up',
      },
    ],
    connectionUpdates: updates,
  }]);
  const result = await ai.runConnectionMatcher({
    reflectId: 'reflect-3', journal: 'private input',
    selectedSignals: [
      signal('signal_one', 'missed', 'milestone_or_quiet_win'),
      signal('signal_two', 'ways_in', null),
    ],
    scenarioIndex: [], currentConnectionBoard: null, readerRecentEvidence: [],
  });
  assert.deepEqual(result.signalResults.map((row) => row.signalId), ['signal_two']);
  const normalized = result.data.how_to_show_up.cards[0];
  assert.equal(normalized.assignedSection, 'ways_in');
  assert.equal(normalized.signalType, 'action');
  assert.equal(normalized.topicKey, 'signal_two_topic');
});

test('pipeline migration records recoverable stage status and failure boundary', () => {
  const sql = source('supabase/migrations/20260911000083_connection_pipeline_reliability.sql');
  assert.match(sql, /connection_pipeline_status text not null default 'completed'/i);
  assert.match(sql, /'router_completed',[\s\S]*'partial',[\s\S]*'failed'/i);
  assert.match(sql, /add column if not exists failure_stage text/i);
});

test('job pipeline calls the final writer only for a template match or malformed custom repair', () => {
  const jobs = source('apps/api/src/lib/reflect-analysis-jobs.js');
  assert.match(jobs, /row\.outcome === 'matched' \|\| \(row\.outcome === 'custom' && missingCustom\.has\(row\.signalId\)\)/);
  assert.match(jobs, /readConnectionTemplatesByScenarioKeys\([\s\S]*matchedResults\.map\(\(row\) => row\.scenarioKey\)/);
  assert.match(jobs, /connection_partial_persist/);
  assert.doesNotMatch(jobs, /readConnectionTemplates\(/);
});

test('migration seeds the reviewed v2 library and durable per-kind slots', () => {
  const sql = source('supabase/migrations/20260910000080_connection_templates_and_journal_slots.sql');
  const templateIds = [...sql.matchAll(/"template_id":"([^"]+)"/g)].map((match) => match[1]);
  const familyKeys = new Set([...sql.matchAll(/"family_key":"([^"]+)"/g)].map((match) => match[1]));
  assert.equal(new Set(templateIds).size, 220);
  assert.equal(familyKeys.size, 21);
  assert.match(sql, /primary key \(user_id, local_date, journal_kind\)/i);
  assert.match(sql, /review_status text not null default 'approved'/i);
});

test('Remember Together skips Bunny and Connection while all three entry states are server-backed', () => {
  const settlement = source('apps/api/src/lib/reflect-settlement.js');
  const jobs = source('apps/api/src/lib/reflect-analysis-jobs.js');
  const entry = source('apps/mobile/app/(main)/reflect.tsx');
  assert.match(settlement, /generateBunny:[\s\S]*draft\.journal_kind !== 'remember_together'/);
  assert.match(jobs, /status: journalKind === 'remember_together' \? 'skipped' : 'pending'/);
  assert.match(entry, /fetchJournalEntryStates/);
  assert.match(entry, /disabled=\{unavailable\}/);
});

test('background queue marks Remember Together skipped without claiming AI work', async () => {
  const jobs = load('apps/api/src/lib/reflect-analysis-jobs.js', {
    './ai-usage': { recordAIUsage: async () => {} },
    './connection-ai': {},
    './connection-template-store': {},
    './reflect-draft': { serviceClient: () => null },
    './reflect-analysis-store': {},
  });
  const rows = [];
  const supabase = {
    from(table) {
      assert.equal(table, 'connection_analysis_jobs');
      return {
        async upsert(row) {
          rows.push(row);
          return { error: null };
        },
      };
    },
  };
  const queued = await jobs.enqueueReflectAnalysisJob(supabase, {
    reflectId: 'reflect-shared', userId: 'user-1', localDate: '2026-09-10',
    journalKind: 'remember_together',
  });
  assert.equal(queued, false);
  assert.equal(rows[0].status, 'skipped');
  assert.ok(rows[0].processed_at);
});

test('legacy API no longer invokes the retired one-pass Connection analyzer', () => {
  const route = source('apps/api/src/app/api/reflect/route.js');
  assert.doesNotMatch(route, /runReflectAnalyzer/);
  assert.match(route, /enqueueReflectAnalysisJob/);
  assert.match(route, /processReflectAnalysisJobs/);
});
