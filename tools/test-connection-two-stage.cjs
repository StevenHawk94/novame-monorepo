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

test('writer preserves valid first-pass cards when repairing one missing card', async () => {
  const firstUpdates = emptyUpdates();
  firstUpdates.worth_knowing = {
    hasUpdate: true, clearExisting: true, cards: [missedCard('signal_one')],
  };
  const repairUpdates = emptyUpdates();
  repairUpdates.how_to_show_up = {
    hasUpdate: true, clearExisting: false, cards: [waysCard('signal_two')],
  };
  const ai = connectionAiWithResponses([
    {
      signalResults: [
        { signalId: 'signal_one', outcome: 'matched', familyKey: 'milestone_or_quiet_win', scenarioKey: 'one' },
        { signalId: 'signal_two', outcome: 'custom', familyKey: null, scenarioKey: null },
      ],
      connectionUpdates: firstUpdates,
    },
    {
      signalResults: [{ signalId: 'signal_two', outcome: 'custom', familyKey: null, scenarioKey: null }],
      connectionUpdates: repairUpdates,
    },
  ]);
  const result = await ai.runConnectionWriter({
    reflectId: 'reflect-2',
    journal: 'private input',
    selectedSignals: [
      signal('signal_one', 'missed', 'milestone_or_quiet_win'),
      signal('signal_two', 'ways_in', null),
    ],
    scenarioTemplates: [], currentConnectionBoard: null, readerRecentEvidence: [],
  });
  assert.equal(result.repaired, true);
  assert.equal(result.data.worth_knowing.cards.length, 1);
  assert.equal(result.data.how_to_show_up.cards.length, 1);
  assert.equal(result.data.worth_knowing.clearExisting, false);
});

test('writer prompt enforces deeper value, concrete action, pronouns, and non-template phrasing', () => {
  const ai = connectionAiWithResponses([]);
  assert.match(ai.CONNECTION_WRITER_SYSTEM_PROMPT, /Memories already show the event/i);
  assert.match(ai.CONNECTION_WRITER_SYSTEM_PROMPT, /Templates are guidance, not fill-in-the-blank copy/i);
  assert.match(ai.CONNECTION_WRITER_SYSTEM_PROMPT, /only as they, them, their, or theirs/i);
  assert.match(ai.CONNECTION_WRITER_SYSTEM_PROMPT, /Never begin with or use “It sounds like/i);
  assert.match(ai.CONNECTION_WRITER_SYSTEM_PROMPT, /give one low-pressure action usable now/i);
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
