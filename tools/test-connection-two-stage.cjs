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
    Buffer,
    process,
    fetch: global.fetch,
    AbortController,
    setTimeout,
    clearTimeout,
    require(name) {
      if (Object.hasOwn(imports, name)) return imports[name];
      if (name.startsWith('node:')) return require(name);
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

function connectionAiWithResponses(responses, { cachedContent = null } = {}) {
  const queue = [...responses];
  const calls = [];
  const loaded = load('apps/api/src/lib/connection-ai.js', {
    './ai': {
      callAI: async (options) => {
        calls.push(options);
        const response = queue.shift() || {};
        return {
          text: typeof response === 'string' ? response : JSON.stringify(response),
          provider: 'test',
          model: 'test',
          usage: { inputTokens: 1, outputTokens: 1 },
          finishReason: response?.__finishReason || 'STOP',
        };
      },
      parseAIJson: JSON.parse,
    },
    './item-learning-evidence': {
      itemLearningHints: () => [],
      cleanLearningSignals: (value) => Array.isArray(value) ? value : [],
    },
    './connection-evidence': evidence,
    './reflect-ai': { cleanConnectionUpdates: legacyAi.cleanConnectionUpdates },
    './connection-context-cache': {
      getConnectionContextCache: async () => cachedContent,
      invalidateConnectionContextCache: async () => {},
    },
  });
  loaded.__calls = calls;
  return loaded;
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

test('router performs value/family routing in one bounded first-stage call', async () => {
  const routed = signal('signal_one', 'missed', 'milestone_or_quiet_win');
  const ai = connectionAiWithResponses([{
    learningCandidates: [],
    decision: 'update',
    connectionSignals: [routed],
  }]);
  const result = await ai.runConnectionRouter({
    reflectId: 'reflect-1', journal: 'private input', connectionEnabled: true,
    familyCatalog: [{
      familyKey: 'milestone_or_quiet_win', section: 'missed',
    }], currentConnectionBoard: null,
  });
  assert.equal(result.data.decision, 'update');
  assert.equal(result.data.eligibleSignals[0].familyKey, 'milestone_or_quiet_win');
  assert.equal(ai.__calls.length, 1);
  const request = JSON.parse(ai.__calls[0].userText);
  assert.equal(request.operation, 'ROUTE');
  assert.equal(ai.__calls[0].generationConfig.thinkingConfig.thinkingBudget, 192);
  assert.equal(ai.__calls[0].generationConfig.maxOutputTokens, 2048);
});

test('second stage matches scenarios and writes matched and custom cards in one call', async () => {
  const updates = emptyUpdates();
  updates.how_to_show_up = {
    hasUpdate: true, clearExisting: false, cards: [waysCard('need_space')],
  };
  updates.worth_knowing = {
    hasUpdate: true, clearExisting: true, cards: [missedCard('career_win')],
  };
  const ai = connectionAiWithResponses([{
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
    connectionUpdates: updates,
  }]);
  const selectedSignals = [
    signal('career_win', 'missed', 'milestone_or_quiet_win'),
    signal('need_space', 'ways_in', null),
  ];
  const scenarioIndex = [{
    familyKey: 'milestone_or_quiet_win', section: 'missed',
    moduleKey: 'worth_knowing', scenarioKey: 'quiet_threshold',
    scenario: 'A meaningful effort crosses a quiet threshold.',
    requiredEvidence: ['concrete progress'], disqualifiers: [],
    templateId: 'template-one', templateCard: { title: 'Structural reference only' },
  }];
  const generated = await ai.runConnectionMatchWriter({
    reflectId: 'reflect-2', selectedSignals,
    scenarioIndex, currentConnectionBoard: null,
  });
  assert.equal(generated.signalResults.length, 2);
  assert.equal(generated.data.worth_knowing.cards.length, 1);
  assert.equal(generated.data.how_to_show_up.cards.length, 1);
  assert.equal(generated.data.worth_knowing.clearExisting, false);
  assert.equal(ai.__calls.length, 1);
  const request = JSON.parse(ai.__calls[0].userText);
  assert.equal(request.operation, 'MATCH_AND_WRITE');
  assert.equal(request.journal, undefined);
  assert.equal(ai.__calls[0].generationConfig.thinkingConfig.thinkingBudget, 768);
  assert.equal(ai.__calls[0].generationConfig.maxOutputTokens, 4096);
});

test('shared cached prompt enforces both operation contracts and writing quality', () => {
  const ai = connectionAiWithResponses([]);
  const prompt = ai.CONNECTION_COMMON_SYSTEM_PROMPT;
  assert.match(prompt, /OPERATION ROUTE/);
  assert.match(prompt, /OPERATION MATCH_AND_WRITE/);
  assert.match(prompt, /Every matched or custom result must include exactly one complete card/i);
  assert.match(prompt, /only as they, them, their, or theirs/i);
  assert.match(prompt, /Never begin with “It sounds like/i);
  assert.match(prompt, /give one low-pressure action usable now/i);
  assert.match(prompt, /days 1–5/i);
  assert.match(prompt, /days 6–10/i);
  // Gemini explicit caching requires at least 2,048 input tokens. The cache
  // API remains the runtime authority; this guard catches accidental prompt
  // shrinkage well before the known-safe current prompt size.
  assert.ok(prompt.length > 9000);
});

test('combined second stage rejects mismatched scenarios and normalizes custom card metadata', async () => {
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
  const result = await ai.runConnectionMatchWriter({
    reflectId: 'reflect-3',
    selectedSignals: [
      signal('signal_one', 'missed', 'milestone_or_quiet_win'),
      signal('signal_two', 'ways_in', null),
    ],
    scenarioIndex: [], currentConnectionBoard: null,
  });
  assert.deepEqual(result.signalResults.map((row) => row.signalId), ['signal_two']);
  const normalized = result.data.how_to_show_up.cards[0];
  assert.equal(normalized.assignedSection, 'ways_in');
  assert.equal(normalized.signalType, 'action');
  assert.equal(normalized.topicKey, 'signal_two_topic');
});

test('second stage retries MAX_TOKENS once with 6144 and reuses explicit cache', async () => {
  const updates = emptyUpdates();
  updates.worth_knowing = {
    hasUpdate: true, clearExisting: false, cards: [missedCard('career_win')],
  };
  const ai = connectionAiWithResponses([
    { __finishReason: 'MAX_TOKENS' },
    {
      signalResults: [{
        signalId: 'career_win', outcome: 'custom', familyKey: null,
        scenarioKey: null, moduleKey: 'worth_knowing',
      }],
      connectionUpdates: updates,
    },
  ], { cachedContent: 'cachedContents/global-connection' });
  const result = await ai.runConnectionMatchWriter({
    reflectId: 'reflect-retry',
    selectedSignals: [signal('career_win', 'missed', null)],
    scenarioIndex: [], currentConnectionBoard: null,
  });
  assert.equal(result.results.length, 2);
  assert.equal(ai.__calls[0].generationConfig.maxOutputTokens, 4096);
  assert.equal(ai.__calls[1].generationConfig.maxOutputTokens, 6144);
  assert.equal(ai.__calls[0].cachedContent, 'cachedContents/global-connection');
  assert.equal(ai.__calls[1].cachedContent, 'cachedContents/global-connection');
});

test('pipeline migration records recoverable stage status and failure boundary', () => {
  const sql = source('supabase/migrations/20260911000083_connection_pipeline_reliability.sql');
  assert.match(sql, /connection_pipeline_status text not null default 'completed'/i);
  assert.match(sql, /'router_completed',[\s\S]*'partial',[\s\S]*'failed'/i);
  assert.match(sql, /add column if not exists failure_stage text/i);
});

test('job pipeline has two AI stages and preserves partial-retry boundaries', () => {
  const jobs = source('apps/api/src/lib/reflect-analysis-jobs.js');
  assert.match(jobs, /runConnectionRouter/);
  assert.match(jobs, /runConnectionMatchWriter/);
  assert.doesNotMatch(jobs, /runConnectionMatcher/);
  assert.doesNotMatch(jobs, /runConnectionWriter/);
  assert.doesNotMatch(jobs, /readConnectionTemplatesByScenarioKeys/);
  assert.match(jobs, /connection_partial_persist/);
  assert.match(jobs, /pendingSignals = eligibleSignals\.filter/);
  assert.match(jobs, /stage_one_result/);
});

test('explicit cache registry is global, private, leased, and seven-day renewable', () => {
  const sql = source('supabase/migrations/20260912000084_ai_context_cache_registry.sql');
  const cache = source('apps/api/src/lib/connection-context-cache.js');
  assert.match(sql, /create table if not exists public\.ai_context_caches/i);
  assert.match(sql, /revoke all on table public\.ai_context_caches from public, anon, authenticated/i);
  assert.match(sql, /security definer/i);
  assert.match(sql, /refresh_lease_until = v_now \+ interval '60 seconds'/i);
  assert.match(cache, /7 \* 24 \* 60 \* 60/);
  assert.match(cache, /24 \* 60 \* 60 \* 1000/);
  assert.match(cache, /5 \* 60 \* 1000/);
  assert.match(cache, /claim_ai_context_cache/);
  assert.match(cache, /systemInstruction/);
  assert.match(cache, /ttl: `\$\{CACHE_TTL_SECONDS\}s`/);
});

test('evidence window keeps latest plus days 1–5 and compressed days 6–10 only', () => {
  const now = Date.now();
  const row = (id, daysAgo, continuity = 'one_off') => ({
    reflect_id: `reflect-${id}`,
    created_at: new Date(now - daysAgo * 86400000).toISOString(),
    connection_signals: [{
      ...signal(id, 'world', 'current_role_or_pattern'),
      kind: continuity === 'ongoing' ? 'pattern' : 'event',
      continuity,
    }],
  });
  const compact = evidence.compactConnectionEvidence([
    row('latest', 0), row('recent', 4), row('background', 8, 'ongoing'), row('expired', 11, 'ongoing'),
  ], { nowMs: now });
  assert.deepEqual(
    JSON.parse(JSON.stringify(compact.map((entry) => [entry.signalId, entry.recencyTier]))),
    [['latest', 'recent_5d'], ['recent', 'recent_5d'], ['background', 'background_6_10d']],
  );
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
