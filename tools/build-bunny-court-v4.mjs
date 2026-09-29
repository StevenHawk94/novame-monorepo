#!/usr/bin/env node
/** Build SQL-Editor-sized Bunny Court v4 migrations from the approved JSON. */
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
const sourcePath = process.argv[2] || '/Users/nihao/Downloads/971622dc-f660-4a09-a0ce-0b2b2ee2a78b.json'
const outputDir = process.argv[3] || path.join(repoRoot, 'supabase/migrations')
const manifestPath = process.argv[4] || null
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'))
const freeCases = new Set(['love-us-vibes-01', 'life-home-chores-01', 'conflict-miscommunication-01'])
let quoteSequence = 0
const sq = (value) => {
  const text = String(value ?? '')
  let delimiter
  do delimiter = `$bc${quoteSequence++}$`
  while (text.includes(delimiter))
  return `${delimiter}${text}${delimiter}`
}
const json = (value) => `${sq(JSON.stringify(value))}::jsonb`

function caseQuestions(entry) {
  const quiz = entry.quiz || {}
  const raw = Array.isArray(entry.questions) ? entry.questions
    : Object.keys(quiz).sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, ''))).map((key) => quiz[key])
  const satisfactionPattern = /bother|satisf(?:ied|action)|happy with|content with|work(?:s|ing) for you|okay with|fine with|how do you feel about/i
  return [...raw.map((question, index) => {
    let dimension = 'flavor'
    if (index === 0) dimension = entry.type === 'Comparison' ? 'comparison_vote' : entry.type === 'Spectrum' ? 'position' : 'category'
    else if (entry.type === 'Spectrum' && satisfactionPattern.test(question.prompt || '')) dimension = 'satisfaction'
    else if (entry.type === 'Category' && index === 1) dimension = 'weight'
    const optionSource = question.options || question.options_template || []
    return {
      number: index + 1, prompt: question.prompt, responseType: 'Single select',
      questionClass: question.template === 'person_voice' ? 'PERSON VOICE' : 'STRUCTURED CHOICE',
      options: optionSource.map((label, optionIndex) => ({ label, value: `q${index + 1}_o${optionIndex + 1}` })),
      analysisDimension: dimension, required: true,
      interactionRule: question.template === 'person_voice' ? 'Display as the answering player’s own voice.' : 'Answers stay sealed until both finish.',
    }
  }), {
    number: raw.length + 1, prompt: entry.free_text_prompt || 'Anything else the court should know? (optional)',
    responseType: 'Short text', questionClass: 'OPTIONAL PRIVATE CONTEXT', options: [],
    analysisDimension: 'free_text', required: false,
    interactionRule: 'Private context is used only to personalize the selected deterministic branch.',
  }]
}

const manifest = Object.entries(source).map(([caseId, entry]) => {
  const questions = caseQuestions(entry)
  const satisfaction = questions.find((item) => item.analysisDimension === 'satisfaction')
  return {
    caseId, category: entry.court, subcategory: entry.subcategory, title: entry.title,
    subtitle: questions[0]?.prompt || entry.subcategory, engine: entry.type.toLowerCase(), variant: entry.variant || null,
    accessTier: freeCases.has(caseId) ? 'free' : 'plus', questions,
    analysisConfig: { version: 4, engine: entry.type.toLowerCase(), variant: entry.variant || null,
      positionQuestionNumber: 1, satisfactionQuestionNumber: satisfaction?.number || null,
      categoryQuestionNumber: entry.type === 'Category' ? 1 : null, weightQuestionNumber: entry.type === 'Category' ? 2 : null },
    outcomes: Object.entries(entry.results || {}).map(([outcomeKey, result]) => ({ outcomeKey, ...result })),
  }
}).sort((a, b) => a.caseId.localeCompare(b.caseId))

const counts = manifest.reduce((memo, item) => ({ ...memo, [item.engine]: (memo[item.engine] || 0) + 1 }), {})
if (manifest.length !== 298 || counts.comparison !== 114 || counts.spectrum !== 142 || counts.category !== 42) {
  throw new Error(`Unexpected approved catalog: ${manifest.length} cases ${JSON.stringify(counts)}`)
}

const caseRow = (item) => `(${[
  sq(item.caseId), sq(item.category), sq(item.subcategory), sq(item.title), sq(item.subtitle), sq('All paired relationships'),
  sq(item.engine), sq(item.accessTier), sq('DETERMINISTIC + OPTIONAL AI PERSONALIZATION'),
  sq('Compare two sealed answers and return the approved verdict branch.'), item.questions.length,
  sq('Replayable'), sq(item.category === 'Conflict Court' ? 'Medium' : 'Low'), sq('Staged v4'),
  sq(JSON.stringify(item.analysisConfig)), json(item.outcomes.map((outcome) => outcome.outcomeKey)),
  sq('Never shown as a relationship score'), sq('Verdict + two individual actions + Try This Together + closing'),
  sq('Use the fixed template unless meaningful optional context is present.'),
  json({ inviteTitle: 'A case has been filed.', inviteBody: `Your person filed ${item.title}. The court needs your side.`, inviteCta: 'Testify Now', readyTitle: 'The verdict is ready.', readyBody: `Both sides are in. Bunny Judge has ruled on ${item.title}.`, readyCta: 'Hear the Verdict', privacyNote: 'No peeking. Your answers stay sealed until both sides finish.' }), 4,
].join(',')})`

const questionRow = (item, question) => `(${[
  sq(item.caseId), question.number, sq(question.prompt), sq('Same question shown independently to both players.'),
  sq(question.responseType), sq(question.questionClass), sq(item.accessTier.toUpperCase()), json(question.options),
  sq(question.analysisDimension), question.required, sq(question.interactionRule),
].join(',')})`

const resultRow = (item, outcome) => {
  const legacyMove = `${outcome.actions_a || ''} ${outcome.actions_b || ''}`.trim()
  return `(${[
    sq(item.caseId), sq(outcome.outcomeKey), sq(outcome.closing || 'THE VERDICT'), sq(outcome.role_note || ''),
    sq(outcome.verdict), sq(legacyMove), sq(outcome.closing || ''), sq('Approved v4 template'),
    sq(outcome.aha_tool || ''), sq(outcome.role_note || ''), sq(outcome.actions_a || ''), sq(outcome.actions_b || ''),
    sq(outcome.try_together || ''), sq(outcome.closing || ''),
  ].join(',')})`
}

const schemaSql = `-- Bunny Court v4 schema. Run before all numbered content parts.
-- New content remains staged until the final activation migration.
alter table public.court_case_definitions add column if not exists subcategory text;
alter table public.court_verdict_templates add column if not exists aha_tool text;
alter table public.court_verdict_templates add column if not exists role_note text;
alter table public.court_verdict_templates add column if not exists action_a text;
alter table public.court_verdict_templates add column if not exists action_b text;
alter table public.court_verdict_templates add column if not exists try_together text;
alter table public.court_verdict_templates add column if not exists closing text;
alter table public.court_verdicts add column if not exists action_a text;
alter table public.court_verdicts add column if not exists action_b text;
alter table public.court_verdicts add column if not exists action_a_name text;
alter table public.court_verdicts add column if not exists action_b_name text;
alter table public.court_verdicts add column if not exists try_together text;
alter table public.court_verdicts add column if not exists closing text;
`

fs.mkdirSync(outputDir, { recursive: true })
for (const file of fs.readdirSync(outputDir)) {
  if (/^202609200001\d\d_bunny_court_content_v4_/.test(file)) fs.rmSync(path.join(outputDir, file))
}
const oldMonolith = path.join(outputDir, '20260920000099_bunny_court_content_v4.sql')
if (fs.existsSync(oldMonolith)) fs.rmSync(oldMonolith)
fs.writeFileSync(path.join(outputDir, '20260920000099_bunny_court_content_v4_schema.sql'), schemaSql)

const batches = []
for (let index = 0; index < manifest.length; index += 20) batches.push(manifest.slice(index, index + 20))
batches.forEach((batch, index) => {
  const caseRows = batch.map(caseRow).join(',\n')
  const questionRows = batch.flatMap((item) => item.questions.map((question) => questionRow(item, question))).join(',\n')
  const resultRows = batch.flatMap((item) => item.outcomes.map((outcome) => resultRow(item, outcome))).join(',\n')
  const ids = batch.map((item) => sq(item.caseId)).join(',')
  const sql = `${schemaSql}
-- Bunny Court v4 content part ${index + 1} of ${batches.length}. Safe to retry before activation.
insert into public.court_case_definitions (
  case_id,category,subcategory,title,card_subtitle,eligibility,engine,access_tier,verdict_method,user_value,
  question_count,repeatability,sensitivity,status,analysis_logic,outcome_keys,scoring_display,result_anatomy,
  insufficient_evidence_rule,notification_copy,content_version
) values
${caseRows}
on conflict (case_id) do update set
  category=excluded.category, subcategory=excluded.subcategory, title=excluded.title, card_subtitle=excluded.card_subtitle,
  eligibility=excluded.eligibility, engine=excluded.engine, access_tier=excluded.access_tier,
  verdict_method=excluded.verdict_method, user_value=excluded.user_value, question_count=excluded.question_count,
  repeatability=excluded.repeatability, sensitivity=excluded.sensitivity, status=excluded.status,
  analysis_logic=excluded.analysis_logic, outcome_keys=excluded.outcome_keys, scoring_display=excluded.scoring_display,
  result_anatomy=excluded.result_anatomy, insufficient_evidence_rule=excluded.insufficient_evidence_rule,
  notification_copy=excluded.notification_copy, content_version=greatest(public.court_case_definitions.content_version + 1, 4), updated_at=now();

delete from public.court_questions where case_id in (${ids});
insert into public.court_questions (
  case_id,question_number,prompt,other_player_prompt,response_type,question_class,access_tag,options,
  analysis_dimension,required,interaction_rule
) values
${questionRows};

delete from public.court_verdict_templates where case_id in (${ids});
insert into public.court_verdict_templates (
  case_id,outcome_key,headline,what_court_heard,verdict,court_ordered_move,share_text,tone_condition,
  aha_tool,role_note,action_a,action_b,try_together,closing
) values
${resultRows};
`
  const timestamp = String(20260920000100 + index)
  fs.writeFileSync(path.join(outputDir, `${timestamp}_bunny_court_content_v4_part_${String(index + 1).padStart(2, '0')}.sql`), sql)
})

const activationTimestamp = String(20260920000100 + batches.length)
const activationSql = `-- Activate v4 only after every content part succeeds.
update public.court_case_definitions set status = 'Retired', updated_at = now()
where status ilike '%Launch' and content_version < 4;
update public.court_case_definitions set status = 'Launch v4', updated_at = now()
where status = 'Staged v4' and content_version >= 4;
`
fs.writeFileSync(path.join(outputDir, `${activationTimestamp}_bunny_court_content_v4_activate.sql`), activationSql)
if (manifestPath) fs.writeFileSync(manifestPath, JSON.stringify({ version: 4, generatedAt: new Date().toISOString(), counts, cases: manifest }, null, 2))
console.log(`Generated ${manifest.length} cases across ${batches.length + 2} migrations in ${outputDir}`)
