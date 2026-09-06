/* Offline Connection regression tests. Run: node --test tools/test-connection-cards.cjs */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function load(file, imports = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
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

const publicCards = load('apps/api/src/lib/connection-card.js');
const evidence = load('apps/api/src/lib/connection-evidence.js');
const ai = load('apps/api/src/lib/reflect-ai.js', {
  './ai': { callAI: async () => ({ text: '{}' }), parseAIJson: JSON.parse },
  './item-learning-evidence': { itemLearningHints: () => [], cleanLearningSignals: () => [] },
  './connection-evidence': evidence,
  './connection-card': publicCards,
});
const analysisStore = load('apps/api/src/lib/reflect-analysis-store.js', {
  './reflect-ai': ai,
  './connection-evidence': evidence,
});

function emptyUpdates() {
  return Object.fromEntries(ai.CONNECTION_DIMENSIONS.map((key) => [key, {
    hasUpdate: false,
    clearExisting: false,
    cards: [],
  }]));
}

test('prompt prioritizes current evidence and requires useful extension beyond memories', () => {
  assert.match(ai.REFLECT_ANALYZER_SYSTEM_PROMPT, /latest supplied reflection is the primary and highest-weight evidence/i);
  assert.match(ai.CONNECTION_REFRESH_SYSTEM_PROMPT, /newest unprocessed reflection\/signal has the strongest recency weight/i);
  assert.match(ai.REFLECT_ANALYZER_SYSTEM_PROMPT, /Memories already show what happened/i);
  assert.match(ai.REFLECT_ANALYZER_SYSTEM_PROMPT, /At most 3 new cards total per analysis/i);
  assert.match(ai.REFLECT_ANALYZER_SYSTEM_PROMPT, /Direct interaction is not required/i);
  assert.match(ai.REFLECT_ANALYZER_SYSTEM_PROMPT, /Write like a warm, observant friend/i);
});

test('a title-free event card is accepted and receives a category label', () => {
  const updates = emptyUpdates();
  updates.worth_knowing = {
    hasUpdate: true,
    clearExisting: false,
    cards: [{
      signalId: 'assignment_complete',
      topicKey: 'school_assignment',
      signalType: 'event',
      assignedSection: 'missed',
      labelKey: 'quiet_win',
      title: null,
      observation: 'They finished a school assignment today.',
      meaning: null,
      takeaway: null,
      confidence: 0.9,
    }],
  };
  const clean = ai.cleanConnectionUpdates(updates, 'reflect-1');
  assert.equal(clean.worth_knowing.cards.length, 1);
  assert.equal(clean.worth_knowing.cards[0].label, 'Quiet Win');
  assert.equal(clean.worth_knowing.cards[0].title, null);
});

test('a safe dynamic category label is retained while labelKey stays canonical', () => {
  const updates = emptyUpdates();
  updates.what_theyre_into = {
    hasUpdate: true,
    clearExisting: false,
    cards: [{
      signalId: 'curiosity_returning', topicKey: 'learning_energy',
      signalType: 'trend', assignedSection: 'world', labelKey: 'interest',
      label: 'Curiosity Loop', title: 'A little spark',
      observation: 'Small discoveries have been giving their days more energy lately.',
      meaning: null, takeaway: null, confidence: 0.9,
    }],
  };
  const clean = ai.cleanConnectionUpdates(updates, 'reflect-dynamic');
  assert.equal(clean.what_theyre_into.cards[0].labelKey, 'interest');
  assert.equal(clean.what_theyre_into.cards[0].label, 'Curiosity Loop');
});

test('Ways In accepts a grounded support action without forcing a title', () => {
  const updates = emptyUpdates();
  updates.how_to_show_up = {
    hasUpdate: true,
    clearExisting: false,
    cards: [{
      signalId: 'overwhelmed_support',
      topicKey: 'difficult_workday',
      signalType: 'action',
      assignedSection: 'ways_in',
      labelKey: 'listen',
      title: null,
      observation: 'They sounded overwhelmed and could use a calm place to be heard.',
      meaning: null,
      takeaway: 'Offer a low-pressure call and let them lead the conversation.',
      confidence: 0.88,
    }],
  };
  const clean = ai.cleanConnectionUpdates(updates, 'reflect-2');
  assert.equal(clean.how_to_show_up.cards.length, 1);
  assert.equal(clean.how_to_show_up.cards[0].label, 'Listen');
  assert.equal(clean.how_to_show_up.cards[0].title, null);
  assert.match(clean.how_to_show_up.cards[0].takeaway, /low-pressure call/);
});

test('free-form event labels are rejected from new generations', () => {
  const updates = emptyUpdates();
  updates.worth_knowing = {
    hasUpdate: true,
    clearExisting: false,
    cards: [{
      signalId: 'assignment_complete', topicKey: 'school_assignment',
      signalType: 'event', assignedSection: 'missed',
      labelKey: 'finished_assignment', title: null,
      observation: 'They finished a school assignment today.', confidence: 0.9,
    }],
  };
  const clean = ai.cleanConnectionUpdates(updates, 'reflect-3');
  assert.equal(clean.worth_knowing.cards.length, 0);
});

test('a new card cannot repeat a topic already visible in another section', () => {
  const updates = emptyUpdates();
  updates.worth_knowing = {
    hasUpdate: true,
    clearExisting: false,
    cards: [{
      signalId: 'new_assignment_signal', topicKey: 'school_assignment',
      signalType: 'event', assignedSection: 'missed', labelKey: 'quiet_win',
      title: null, observation: 'They finished another school assignment.', confidence: 0.91,
    }],
  };
  const currentBoard = {
    schemaVersion: 2,
    modules: {
      what_theyre_into: [{
        signalId: 'school_work', topicKey: 'school_assignment',
        title: null, observation: 'School assignments have occupied much of their attention lately.',
      }],
    },
  };
  const clean = ai.cleanConnectionUpdates(updates, 'reflect-4', { currentBoard });
  assert.equal(clean.worth_knowing.cards.length, 0);
});

test('a module can replace its own current card without self-blocking', () => {
  const updates = emptyUpdates();
  updates.what_theyre_into = {
    hasUpdate: true,
    clearExisting: false,
    cards: [{
      signalId: 'game_interest_update', topicKey: 'mario_kart',
      signalType: 'trend', assignedSection: 'world', labelKey: 'interest',
      title: null, observation: 'Mario Kart has continued to show up in their downtime.', confidence: 0.9,
    }],
  };
  const currentBoard = {
    schemaVersion: 2,
    modules: {
      what_theyre_into: [{
        signalId: 'game_interest', topicKey: 'mario_kart',
        title: null, observation: 'Mario Kart has been part of their downtime lately.',
      }],
    },
  };
  const clean = ai.cleanConnectionUpdates(updates, 'reflect-5', { currentBoard });
  assert.equal(clean.what_theyre_into.cards.length, 1);
});

test('one analysis can persist no more than three cards total', () => {
  const updates = emptyUpdates();
  const samples = [
    ['worth_knowing', 'event', 'missed', 'quiet_win', 'project_finish', 'A long-running personal project finally crossed the finish line.'],
    ['recent_vibe', 'trend', 'world', 'mood', 'morning_pace', 'Slower mornings have been giving their week a steadier pace.'],
    ['what_theyre_into', 'trend', 'world', 'interest', 'science_curiosity', 'Tiny science discoveries keep adding a spark to their downtime.'],
    ['how_to_show_up', 'action', 'ways_in', 'listen', 'quiet_company', 'They need company that does not turn a hard evening into a problem-solving session.'],
  ];
  samples.forEach(([moduleKey, signalType, assignedSection, labelKey, signalId, observation], index) => {
    updates[moduleKey] = {
      hasUpdate: true, clearExisting: false,
      cards: [{
        signalId, topicKey: `${signalId}_topic`, signalType,
        assignedSection, labelKey, label: `Category ${index}`,
        observation,
        takeaway: assignedSection === 'ways_in' ? 'Offer a quiet call tonight.' : null,
        confidence: 0.95 - index * 0.01,
      }],
    };
  });
  const clean = ai.cleanConnectionUpdates(updates, 'reflect-limit', { maxTotal: 3 });
  const count = ai.CONNECTION_DIMENSIONS.reduce((sum, key) => sum + clean[key].cards.length, 0);
  assert.equal(count, 3);
});

test('legacy cards are presented with a category label and repetitive fields removed', () => {
  const card = publicCards.publicConnectionCard({
    label: 'Finished Assignment',
    title: 'Completed a school assignment',
    observation: 'They finished a school assignment today.',
    meaning: 'This suggests they completed their school assignment.',
    takeaway: null,
  }, 'worth_knowing');
  assert.equal(card.label, 'Worth Noticing');
  assert.equal(card.title, null);
  assert.equal(card.meaning, null);
  assert.equal(card.observation, 'They finished a school assignment today.');
});

test('a genuinely separate optional framing remains visible', () => {
  const card = publicCards.publicConnectionCard({
    labelKey: 'change',
    title: 'A new chapter',
    observation: 'They started a different role at school this week.',
    meaning: null,
    takeaway: null,
  }, 'worth_knowing');
  assert.equal(card.label, 'Change');
  assert.equal(card.title, 'A new chapter');
});

test('history is compacted into a 10-day active tier and persistent 11-30 day tier', () => {
  const now = Date.parse('2026-09-06T12:00:00.000Z');
  const signal = (topicKey, kind, summary, continuity = 'one_off') => ({
    signalId: `${topicKey}_signal`, topicKey, kind, summary, continuity,
    sentiment: 'neutral', supportMode: null, confidence: 0.8, expiresAt: null,
  });
  const rows = [
    { reflect_id: 'r1', created_at: '2026-09-05T12:00:00.000Z', connection_signals: [
      signal('learning_energy', 'pattern', 'They keep making time to learn.', 'ongoing'),
    ] },
    { reflect_id: 'r2', created_at: '2026-08-22T12:00:00.000Z', connection_signals: [
      signal('learning_energy', 'pattern', 'Learning has stayed in their routine.', 'ongoing'),
    ] },
    { reflect_id: 'r3', created_at: '2026-08-20T12:00:00.000Z', connection_signals: [
      signal('old_errand', 'event', 'They completed an errand.'),
    ] },
  ];
  const compact = evidence.compactConnectionEvidence(rows, { nowMs: now });
  assert.equal(compact.length, 1);
  assert.equal(compact[0].topicKey, 'learning_energy');
  assert.equal(compact[0].occurrenceCount, 2);
  assert.equal(compact[0].recencyTier, 'recent_10d');
});

test('unprocessed catch-up may retain a valuable one-off from days 11-30', () => {
  const now = Date.parse('2026-09-06T12:00:00.000Z');
  const rows = [{
    reflect_id: 'r-old', created_at: '2026-08-22T12:00:00.000Z',
    connection_signals: [{
      signalId: 'quiet_win', topicKey: 'quiet_win', kind: 'event',
      summary: 'They reached a goal they had worked toward.', continuity: 'one_off',
      sentiment: 'positive', supportMode: null, confidence: 0.9, expiresAt: null,
    }],
  }];
  assert.equal(evidence.compactConnectionEvidence(rows, { nowMs: now }).length, 0);
  assert.equal(evidence.compactConnectionEvidence(rows, {
    nowMs: now, retainBackgroundOneOff: true,
  }).length, 1);
});

test('Between You Lately is written identically to both people', async () => {
  const calls = [];
  const supabase = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: { changed: true, payload: { forUser: args.p_for_user } }, error: null };
    },
  };
  const updates = emptyUpdates();
  updates.shared_rhythm = {
    hasUpdate: true, clearExisting: false,
    cards: [{ observation: 'Both have been reaching for quieter evenings.' }],
  };
  const result = await analysisStore.applyConnectionUpdates(supabase, {
    pair: { ua: 'a', ub: 'b', writerId: 'a', readerId: 'b' },
    updates, reflectId: 'reflect-between', localDate: '2026-09-06',
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].args.p_for_user, 'b');
  assert.equal(calls[1].args.p_for_user, 'a');
  assert.deepEqual(calls[1].args.p_updates.shared_rhythm, updates.shared_rhythm);
  assert.deepEqual(result.payload, { forUser: 'b' });
});
