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
const ai = load('apps/api/src/lib/reflect-ai.js', {
  './ai': { callAI: async () => ({ text: '{}' }), parseAIJson: JSON.parse },
  './item-learning-evidence': { itemLearningHints: () => [], cleanLearningSignals: () => [] },
  './connection-card': publicCards,
});

function emptyUpdates() {
  return Object.fromEntries(ai.CONNECTION_DIMENSIONS.map((key) => [key, {
    hasUpdate: false,
    clearExisting: false,
    cards: [],
  }]));
}

test('prompt makes label and observation the only globally required display fields', () => {
  assert.match(ai.REFLECT_ANALYZER_SYSTEM_PROMPT, /two required user-facing fields: labelKey and observation/);
  assert.match(ai.CONNECTION_REFRESH_SYSTEM_PROMPT, /two required user-facing fields: labelKey and observation/);
  assert.match(ai.REFLECT_ANALYZER_SYSTEM_PROMPT, /explicit request is not required/i);
  assert.match(ai.REFLECT_ANALYZER_SYSTEM_PROMPT, /comfort, encouragement, listening, conversation, companionship/i);
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
