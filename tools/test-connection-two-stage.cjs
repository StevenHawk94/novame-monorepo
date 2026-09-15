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

function load(file, imports = {}, globals = {}) {
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
    process: globals.process || process,
    fetch: globals.fetch || global.fetch,
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
const templateMatcher = load('apps/api/src/lib/connection-template-matcher.js', {
  './reflect-ai': { cleanConnectionUpdates: legacyAi.cleanConnectionUpdates },
});

function connectionAiWithResponses(responses, {
  cachedContent = null,
  models = {
    defaultGemini: 'gemini-2.5-flash',
    connectionRouter: 'gemini-2.5-flash',
    connectionWriter: 'gemini-2.5-flash',
    fallback: 'deepseek-chat',
  },
} = {}) {
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
      getAIModelConfig: () => models,
    },
    './item-learning-evidence': {
      itemLearningHints: () => [],
      cleanLearningSignals: (value) => Array.isArray(value) ? value : [],
    },
    './connection-evidence': evidence,
    './reflect-ai': { cleanConnectionUpdates: legacyAi.cleanConnectionUpdates },
    './connection-template-matcher': templateMatcher,
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
    summary: `Meaningful effort crossed a quiet threshold for ${id}.`,
    semanticCue: 'meaningful effort quiet threshold',
    continuity: 'one_off',
    sentiment: 'neutral',
    supportMode: section === 'ways_in' ? 'listen' : null,
    evidenceStrength: 'moderate',
    evidenceCount: 1,
    temporalState: section === 'missed' ? 'completed_progress' : 'current',
    persistence: 'single_supported_moment',
    topicDomain: 'work_admin',
    emotionFamily: 'neutral_mixed',
    supportOpenness: section === 'ways_in' ? 'explicit' : 'not_applicable',
    responsePreference: section === 'ways_in' ? 'listening_or_words' : 'not_applicable',
    boundary: 'none',
    timing: 'informational',
    emotionalWeight: 'ordinary',
    toneMode: 'warm_clear',
    toneEvidence: 'warm_default',
    mutuality: section === 'between' ? 'two_sided_independent' : 'not_applicable',
    depthRecommendation: 'L2',
    slotValues: {
      anchorPhrase: null, timingPhrase: null, durationPhrase: null,
      supportCue: null, sharedAnchor: null, contextCue: null,
    },
    confidence: 0.9,
    decision: 'publish',
    cardEligible: true,
    assignedSection: section,
    familyKey,
    newValue: 'Adds a useful second layer.',
    whyQualified: 'The reader gains a concrete implication.',
  };
}

function scenario(overrides = {}) {
  return {
    familyKey: 'milestone_or_quiet_win', section: 'missed',
    moduleKey: 'worth_knowing', scenarioKey: 'quiet_threshold',
    scenario: 'A meaningful effort crosses a quiet threshold.',
    signalType: 'concrete_development', temporalState: 'completed_progress',
    persistence: 'single_supported_moment', topicDomain: 'work_admin',
    emotionFamily: 'neutral_mixed', supportMode: 'none',
    supportOpenness: 'not_applicable', responsePreference: 'not_applicable',
    boundary: 'none', timing: 'informational', mutuality: 'not_applicable',
    emotionalWeight: 'ordinary', depthRange: 'L2-L3',
    searchAliases: 'quiet threshold|meaningful effort',
    retrievalText: 'meaningful effort crossed a quiet threshold after sustained progress',
    ...overrides,
  };
}

function variant(overrides = {}) {
  return {
    templateVariantId: 'quiet_threshold__lower_warm_clear',
    scenarioKey: 'quiet_threshold', section: 'missed',
    variantKey: 'lower-warm_clear', depthBand: 'lower', toneMode: 'warm_clear',
    playfulEligible: true,
    templateCard: {
      label: 'Quiet Win', title: 'The effort finally moved',
      observation: 'They crossed a meaningful threshold after sustained effort.',
      meaning: null, takeaway: null,
    },
    ...overrides,
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
  assert.equal(request.journal, 'private input');
  assert.equal(request.families.length, 1);
  assert.equal(ai.__calls[0].geminiModel, 'gemini-2.5-flash');
  assert.equal(ai.__calls[0].generationConfig.thinkingConfig.thinkingBudget, 512);
  assert.equal(ai.__calls[0].generationConfig.maxOutputTokens, 1024);
  assert.equal(ai.__calls[0].generationConfig.responseMimeType, 'application/json');
  assert.equal(ai.__calls[0].generationConfig.responseSchema.properties.signals.maxItems, 3);
});

test('shared Gemini client sends structured-output fields with system instruction', async () => {
  const calls = [];
  const shared = load('apps/api/src/lib/ai.js', {}, {
    process: { env: { GEMINI_API_KEY: 'test-gemini-key' } },
    fetch: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return {
        ok: true,
        json: async () => ({
          candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"ok":true}' }] } }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 },
        }),
      };
    },
  });
  const schema = { type: 'OBJECT', required: ['ok'], properties: { ok: { type: 'BOOLEAN' } } };
  const result = await shared.callAI({
    systemInstruction: 'Return a result.', userText: 'Check.', skipDeepSeek: true,
    geminiModel: 'gemini-2.5-flash-lite',
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
  });
  assert.equal(result.provider, 'gemini');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(calls[0].body.generationConfig.responseSchema, schema);
  assert.equal(calls[0].body.system_instruction.parts[0].text, 'Return a result.');
});

test('shared Gemini client reads the default model from server configuration', async () => {
  const calls = [];
  const shared = load('apps/api/src/lib/ai.js', {}, {
    process: {
      env: {
        GEMINI_API_KEY: 'test-gemini-key',
        AI_MODEL_DEFAULT: 'gemini-configured-default',
      },
    },
    fetch: async (url) => {
      calls.push(url);
      return {
        ok: true,
        json: async () => ({
          candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"ok":true}' }] } }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 },
        }),
      };
    },
  });
  const result = await shared.callAI({
    systemInstruction: 'Return JSON.', userText: 'Check.', skipDeepSeek: true,
  });
  assert.equal(result.model, 'gemini-configured-default');
  assert.match(calls[0], /models\/gemini-configured-default:generateContent/);
});

test('DeepSeek fallback records the failed Gemini attempt for diagnosis', async () => {
  let call = 0;
  let fallbackBody = null;
  const shared = load('apps/api/src/lib/ai.js', {}, {
    process: {
      env: {
        GEMINI_API_KEY: 'test-gemini-key',
        DEEPSEEK_API_KEY: 'test-deepseek-key',
        AI_MODEL_FALLBACK: 'deepseek-configured-fallback',
      },
    },
    fetch: async (_url, options) => {
      call += 1;
      if (call === 1) throw new Error('synthetic Gemini outage');
      fallbackBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"decision":"no_update"}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        }),
      };
    },
  });
  const result = await shared.callAI({
    systemInstruction: 'Return JSON.', userText: 'Check.', geminiModel: 'gemini-2.5-flash-lite',
    generationConfig: { responseMimeType: 'application/json' },
  });
  assert.equal(result.provider, 'deepseek');
  assert.equal(result.model, 'deepseek-configured-fallback');
  assert.equal(fallbackBody.model, 'deepseek-configured-fallback');
  assert.equal(result.providerAttempts.length, 1);
  assert.equal(result.providerAttempts[0].model, 'gemini-2.5-flash-lite');
  assert.match(result.providerAttempts[0].error, /synthetic Gemini outage/);
});

test('Connection router and unmatched fallback use independently configured Gemini models', async () => {
  const models = {
    defaultGemini: 'gemini-default',
    connectionRouter: 'gemini-router',
    connectionWriter: 'gemini-writer',
    fallback: 'deepseek-fallback',
  };
  const routed = {
    ...signal('signal_model', 'missed', 'milestone_or_quiet_win'),
    evidenceStrength: 'strong',
  };
  const router = connectionAiWithResponses([{
    decision: 'update', connectionSignals: [routed],
  }], { models });
  await router.runConnectionRouter({
    reflectId: 'reflect-model-router', journal: 'A concrete meaningful milestone happened today.',
    connectionEnabled: true,
    familyCatalog: [{ familyKey: 'milestone_or_quiet_win', section: 'missed' }],
    currentConnectionBoard: null,
  });
  assert.equal(router.__calls[0].geminiModel, 'gemini-router');

  const writer = connectionAiWithResponses([{
    results: [{
      signalId: 'signal_model', outcome: 'custom', scenarioKey: null,
      card: missedCard('signal_model'),
    }],
  }], { models });
  await writer.runConnectionMatchWriter({
    reflectId: 'reflect-model-writer',
    selectedSignals: [routed],
    scenarioIndex: [], templateVariants: [],
    currentConnectionBoard: null,
  });
  assert.equal(writer.__calls[0].geminiModel, 'gemini-writer');
});

test('reviewed templates render directly and only unmatched signals spend one fallback call', async () => {
  const ai = connectionAiWithResponses([{
    results: [
      {
        signalId: 'unmapped_moment', outcome: 'custom', scenarioKey: null,
        card: missedCard('unmapped_moment'),
      },
    ],
  }]);
  const selectedSignals = [
    signal('career_win', 'missed', 'milestone_or_quiet_win'),
    { ...signal('unmapped_moment', 'missed', null), evidenceStrength: 'strong' },
  ];
  const generated = await ai.runConnectionMatchWriter({
    reflectId: 'reflect-2', selectedSignals,
    scenarioIndex: [scenario()], templateVariants: [variant()], currentConnectionBoard: null,
  });
  assert.equal(generated.signalResults.length, 2);
  assert.equal(generated.data.worth_knowing.cards.length, 2);
  assert.equal(generated.data.worth_knowing.clearExisting, false);
  assert.equal(ai.__calls.length, 1);
  const request = JSON.parse(ai.__calls[0].userText);
  assert.equal(request.signals.length, 1);
  assert.equal(request.signals[0].signalId, 'unmapped_moment');
  assert.equal(request.templates, undefined);
  assert.equal(request.journal, undefined);
  assert.equal(ai.__calls[0].geminiModel, 'gemini-2.5-flash');
  assert.equal(ai.__calls[0].generationConfig.thinkingConfig.thinkingBudget, 512);
  assert.equal(ai.__calls[0].generationConfig.maxOutputTokens, 2048);
  assert.equal(ai.__calls[0].generationConfig.responseMimeType, 'application/json');
  assert.equal(ai.__calls[0].generationConfig.responseSchema.properties.results.minItems, 1);
  assert.deepEqual(
    Array.from(ai.__calls[0].generationConfig.responseSchema.properties.results.items.properties.outcome.enum),
    ['custom'],
  );
});

test('a confident reviewed match renders stored copy with no second AI call', async () => {
  const ai = connectionAiWithResponses([]);
  const reviewed = variant({
    templateCard: {
      label: 'OUT IN THE WORLD', title: 'The effort finally moved',
      observation: 'They crossed a meaningful threshold after sustained effort.',
      meaning: 'The meaningful threshold reflects sustained effort.', takeaway: null,
    },
  });
  const generated = await ai.runConnectionMatchWriter({
    reflectId: 'reflect-template-only',
    selectedSignals: [signal('career_win', 'missed', 'milestone_or_quiet_win')],
    scenarioIndex: [scenario()], templateVariants: [reviewed], currentConnectionBoard: null,
  });
  assert.equal(ai.__calls.length, 0);
  assert.equal(generated.result, null);
  assert.equal(generated.signalResults[0].outcome, 'matched');
  assert.equal(generated.signalResults[0].scenarioKey, 'quiet_threshold');
  assert.equal(generated.data.worth_knowing.cards[0].title, 'The effort finally moved');
  assert.equal(generated.data.worth_knowing.cards[0].label, 'OUT IN THE WORLD');
  assert.equal(generated.data.worth_knowing.cards[0].meaning, 'The meaningful threshold reflects sustained effort.');
});

test('strict scenario gates reject disqualifiers and unsupported world, ways-in, and between signals', () => {
  const disqualified = templateMatcher.selectConnectionScenario({
    ...signal('routine_meeting', 'missed', 'milestone_or_quiet_win'),
    semanticCue: 'routine meeting no indication it matters',
    summary: 'Routine meeting with no indication it matters.',
  }, [scenario({
    retrievalText: 'routine meeting no indication it matters',
    disqualifiers: 'Routine meeting; no indication it matters',
  })]);
  assert.equal(disqualified.matched, false);

  const unsupportedWorld = templateMatcher.selectConnectionScenario({
    ...signal('one_off_world', 'world', 'mood_and_energy'),
    kind: 'pattern',
    semanticCue: 'ongoing energy pattern',
  }, [scenario({
    familyKey: 'mood_and_energy', section: 'world', signalType: 'ongoing_pattern',
    temporalState: 'ongoing_repeated', persistence: 'repeated_or_explicit_continuity',
    retrievalText: 'ongoing energy pattern',
  })]);
  assert.equal(unsupportedWorld.matched, false);

  const unclearWaysIn = templateMatcher.selectConnectionScenario({
    ...signal('unclear_support', 'ways_in', 'listening_and_venting'),
    semanticCue: 'needs someone to listen',
    supportOpenness: 'unclear',
  }, [scenario({
    familyKey: 'listening_and_venting', section: 'ways_in', signalType: 'support_opening',
    supportMode: 'listen', supportOpenness: 'explicit',
    responsePreference: 'listening_or_words', retrievalText: 'needs someone to listen',
  })]);
  assert.equal(unclearWaysIn.matched, false);

  const oneSidedBetween = templateMatcher.selectConnectionScenario({
    ...signal('one_sided_pair', 'between', 'parallel_routines'),
    semanticCue: 'matching weekend routines',
    mutuality: 'one_sided',
  }, [scenario({
    familyKey: 'parallel_routines', section: 'between', signalType: 'shared_pattern',
    persistence: 'independent_pair_evidence', mutuality: 'two_sided_independent',
    retrievalText: 'matching weekend routines',
  })]);
  assert.equal(oneSidedBetween.matched, false);
});

test('operation prompts are separate, concise, and retain the essential contracts', () => {
  const ai = connectionAiWithResponses([]);
  const router = ai.CONNECTION_ROUTER_SYSTEM_PROMPT;
  const writer = ai.CONNECTION_MATCH_WRITER_SYSTEM_PROMPT;
  assert.match(router, /at most 3 distinct signals/i);
  assert.match(router, /recent5d/i);
  assert.match(router, /never write finished Connection card copy/i);
  assert.match(writer, /no reviewed template matched/i);
  assert.match(writer, /Return every supplied signal exactly once/i);
  assert.match(writer, /they\/them\/their/i);
  assert.match(writer, /takeaway is always null/i);
  assert.doesNotMatch(writer, /literal icon gaps/i);
  assert.ok(router.length < 2400);
  assert.ok(writer.length < 2400);
});

test('strong safe unmatched missed signals use custom fallback while ways-in is suppressed', async () => {
  const ai = connectionAiWithResponses([{
    results: [
      {
        signalId: 'signal_one', outcome: 'custom', scenarioKey: null,
        card: missedCard('signal_one'),
      },
    ],
  }]);
  const result = await ai.runConnectionMatchWriter({
    reflectId: 'reflect-3',
    selectedSignals: [
      { ...signal('signal_one', 'missed', 'milestone_or_quiet_win'), topicKey: 'career_progress', evidenceStrength: 'strong' },
      { ...signal('signal_two', 'ways_in', null), topicKey: 'decompression_space' },
    ],
    scenarioIndex: [], templateVariants: [], currentConnectionBoard: null,
  });
  assert.deepEqual(result.signalResults.map((row) => row.signalId), ['signal_one', 'signal_two']);
  assert.equal(result.signalResults[0].outcome, 'custom');
  assert.equal(result.signalResults[0].scenarioKey, null);
  assert.equal(result.signalResults[1].outcome, 'no_update');
  assert.equal(result.signalResults[1].reason, 'custom_fallback_not_eligible');
  assert.equal(result.data.talk_about.cards.length, 0);
  const normalized = result.data.worth_knowing.cards[0];
  assert.equal(normalized.assignedSection, 'missed');
  assert.equal(normalized.signalType, 'event');
  assert.equal(normalized.topicKey, 'career_progress');
  assert.equal(ai.__calls.length, 1);
  const request = JSON.parse(ai.__calls[0].userText);
  assert.deepEqual(request.signals.map((row) => row.signalId), ['signal_one']);
});

test('second stage never spends a second writer call when output reaches MAX_TOKENS', async () => {
  const ai = connectionAiWithResponses([
    { __finishReason: 'MAX_TOKENS' },
  ], { cachedContent: 'cachedContents/global-connection' });
  await assert.rejects(() => ai.runConnectionMatchWriter({
    reflectId: 'reflect-no-retry',
    selectedSignals: [{ ...signal('career_win', 'missed', null), evidenceStrength: 'strong' }],
    scenarioIndex: [], currentConnectionBoard: null,
  }), /connection_match_writer_max_tokens/);
  assert.equal(ai.__calls.length, 1);
  assert.equal(ai.__calls[0].generationConfig.maxOutputTokens, 2048);
  assert.equal(ai.__calls[0].cachedContent, 'cachedContents/global-connection');
});

test('writer settlement keeps valid siblings and terminally closes invalid rows', async () => {
  const ai = connectionAiWithResponses([]);
  const selectedSignals = [
    signal('career_win', 'missed', null),
    signal('need_space', 'ways_in', null),
  ];
  const updates = emptyUpdates();
  updates.worth_knowing = {
    hasUpdate: true, clearExisting: false, cards: [missedCard('career_win')],
  };
  const settled = ai.settleWriterSignalResults(selectedSignals, [
    { signalId: 'career_win', outcome: 'custom', moduleKey: 'worth_knowing' },
    { signalId: 'need_space', outcome: 'custom', moduleKey: 'how_to_show_up' },
  ], updates);
  assert.deepEqual(settled.map((row) => row.outcome), ['custom', 'no_update']);
  assert.equal(settled[1].reason, 'generated_card_rejected');
});

test('pipeline migration records recoverable stage status and failure boundary', () => {
  const sql = source('supabase/migrations/20260911000083_connection_pipeline_reliability.sql');
  assert.match(sql, /connection_pipeline_status text not null default 'completed'/i);
  assert.match(sql, /'router_completed',[\s\S]*'partial',[\s\S]*'failed'/i);
  assert.match(sql, /add column if not exists failure_stage text/i);
});

test('job pipeline has two AI stages and settles writer validation without a paid retry', () => {
  const jobs = source('apps/api/src/lib/reflect-analysis-jobs.js');
  assert.match(jobs, /runConnectionRouter/);
  assert.match(jobs, /runConnectionMatchWriter/);
  assert.doesNotMatch(jobs, /runConnectionMatcher/);
  assert.doesNotMatch(jobs, /runConnectionWriter/);
  assert.doesNotMatch(jobs, /readConnectionTemplatesByScenarioKeys/);
  assert.match(jobs, /settleWriterSignalResults/);
  assert.doesNotMatch(jobs, /throw new Error\('connection_match_writer_missing_qualified_card'\)/);
  assert.match(jobs, /pendingSignals = eligibleSignals\.filter/);
  assert.match(jobs, /stage_one_result/);
});

test('Connection page resumes a durable job instead of starting a third paid catch-up call', () => {
  const route = source('apps/api/src/app/api/friends/insights/route.js');
  assert.match(route, /from\('connection_analysis_jobs'\)/);
  assert.match(route, /processReflectAnalysisJobs\(\{ reflectId: activeJob\.reflect_id \}\)/);
  assert.match(route, /refreshPending: true/);
  assert.ok(route.indexOf("from('connection_analysis_jobs')") < route.indexOf('generateBrief(supabase'));
});

test('explicit cache is leased, seven-day renewable, and automatically cost-gated', () => {
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
  assert.match(cache, /AUTO_MIN_CALLS = 623/);
  assert.match(cache, /GEMINI_EXPLICIT_CACHE_MIN_TOKENS = 2048/);
  assert.match(cache, /CONNECTION_EXPLICIT_CACHE_MODE/);
  assert.match(cache, /systemInstruction/);
  assert.match(cache, /ttl: `\$\{CACHE_TTL_SECONDS\}s`/);
});

test('obviously low-information journals skip Gemini without blocking meaningful short events', async () => {
  const ai = connectionAiWithResponses([]);
  const skipped = await ai.runConnectionRouter({
    reflectId: 'reflect-bored', journal: 'bored', connectionEnabled: true,
    familyCatalog: [], currentConnectionBoard: null,
  });
  assert.equal(skipped.data.decision, 'no_update');
  assert.equal(skipped.result, null);
  assert.equal(ai.__calls.length, 0);

  const meaningful = connectionAiWithResponses([{ decision: 'no_update', signals: [], learning: [] }]);
  await meaningful.runConnectionRouter({
    reflectId: 'reflect-engaged', journal: 'got engaged', connectionEnabled: true,
    familyCatalog: [], currentConnectionBoard: null,
  });
  assert.equal(meaningful.__calls.length, 1);
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

test('v6 migration loads all 220 scenarios and four reviewed variants for each', () => {
  const sql = source('supabase/migrations/20260915000090_connection_template_library_v6.sql');
  const scenarioBlock = sql.match(/\$connection_scenarios_v6\$([\s\S]*?)\$connection_scenarios_v6\$/)?.[1] || '';
  const variantBlock = sql.match(/\$connection_variants_v6\$([\s\S]*?)\$connection_variants_v6\$/)?.[1] || '';
  const scenarios = JSON.parse(scenarioBlock);
  const variants = JSON.parse(variantBlock);
  assert.equal(scenarios.length, 220);
  assert.equal(new Set(scenarios.map((row) => row.scenario_key)).size, 220);
  assert.equal(variants.length, 880);
  assert.equal(new Set(variants.map((row) => row.template_variant_id)).size, 880);
  const counts = new Map();
  for (const row of variants) counts.set(row.scenario_key, (counts.get(row.scenario_key) || 0) + 1);
  assert.deepEqual([...new Set(counts.values())], [4]);
  assert.match(sql, /create table if not exists public\.connection_template_variants/i);
  assert.match(sql, /library_version='v6'/i);
});

test('originality monitor counts only cards that were actually accepted for display', async () => {
  const calls = [];
  const monitor = load('apps/api/src/lib/connection-output-monitor.js');
  const supabase = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: null, error: null };
    },
  };
  const updates = emptyUpdates();
  updates.worth_knowing.cards.push({ signalId: 'visible_template' });
  updates.recent_vibe.cards.push({ signalId: 'visible_original' });
  const result = await monitor.recordConnectionOutputOutcomes(supabase, {
    reflectId: 'reflect-monitor',
    signalResults: [
      { signalId: 'visible_template', outcome: 'matched', moduleKey: 'worth_knowing' },
      { signalId: 'visible_original', outcome: 'custom', moduleKey: 'recent_vibe' },
      { signalId: 'rejected_original', outcome: 'custom', moduleKey: 'recent_vibe' },
      { signalId: 'suppressed', outcome: 'no_update', moduleKey: 'talk_about' },
    ],
    updates,
  });
  assert.equal(result.recorded, 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'record_connection_output_outcomes');
  assert.deepEqual(
    JSON.parse(JSON.stringify(calls[0].args.p_outcomes)),
    [
      { signal_id: 'visible_template', outcome: 'matched', section: 'worth_knowing' },
      { signal_id: 'visible_original', outcome: 'custom', section: 'recent_vibe' },
    ],
  );
});

test('originality alert uses one idempotent email per completed 100-card window', async () => {
  const rpcCalls = [];
  const fetchCalls = [];
  const monitor = load('apps/api/src/lib/connection-output-monitor.js', {}, {
    process: {
      env: {
        RESEND_API_KEY: 'resend-test',
        CONNECTION_ALERT_EMAIL: 'owner@example.com',
      },
    },
    fetch: async (url, options) => {
      fetchCalls.push({ url, options, body: JSON.parse(options.body) });
      return { ok: true, text: async () => '' };
    },
  });
  const supabase = {
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      if (name === 'claim_connection_output_alert') {
        return {
          data: [{
            id: 7, window_number: 12, total_outputs: 100,
            original_outputs: 31, original_ratio: 0.31,
          }],
          error: null,
        };
      }
      return { data: null, error: null };
    },
  };
  const result = await monitor.sendPendingConnectionOutputAlert(supabase);
  assert.equal(result.sent, true);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].options.headers['Idempotency-Key'], 'connection-output-window-12');
  assert.deepEqual(fetchCalls[0].body.to, ['owner@example.com']);
  assert.match(fetchCalls[0].body.subject, /31%/);
  assert.equal(rpcCalls.at(-1).name, 'complete_connection_output_alert');
  assert.equal(rpcCalls.at(-1).args.p_success, true);
});

test('originality migration uses unique accepted-card events and alerts only above 30 per 100', () => {
  const sql = source('supabase/migrations/20260915000091_connection_originality_monitor.sql');
  assert.match(sql, /unique \(reflect_id, signal_id\)/i);
  assert.match(sql, /if v_outputs = 100 then/i);
  assert.match(sql, /if v_originals > 30 then/i);
  assert.doesNotMatch(sql, /v_originals >= 30/i);
  assert.match(sql, /on conflict \(reflect_id, signal_id\) do nothing/i);
  assert.match(sql, /attempts < 5/i);
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
    './connection-output-monitor': { recordConnectionOutputOutcomes: async () => ({ recorded: 0 }) },
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
