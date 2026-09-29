import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

const HEADERS = ['case_id','category','subcategory','title','subtitle','engine','variant','access_tier','status','questions_json','results_json']
const ENGINE_KEYS = {
  comparison: ['consensus_a','consensus_b','consensus_both','self_claim_clash','mutual_deflection','partial_overlap'],
  category: ['fun_overlap','same_territory','two_different_facts','making_room_for_both'],
  spectrum: ['small_gap_both_content','small_gap_split','small_gap_both_discontent','large_gap_both_content','large_gap_split','large_gap_both_discontent'],
  dual_pole: ['a_carries_more','b_carries_more','genuinely_balanced','double_martyr','mutual_crediting','lopsided_one_notices'],
}

function csvEscape(value) {
  const text = String(value ?? '')
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted && char === '"' && text[index + 1] === '"') { cell += '"'; index += 1 }
    else if (char === '"') quoted = !quoted
    else if (char === ',' && !quoted) { row.push(cell); cell = '' }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1
      row.push(cell); if (row.some((value) => value.trim())) rows.push(row); row = []; cell = ''
    } else cell += char
  }
  row.push(cell); if (row.some((value) => value.trim())) rows.push(row)
  if (rows.length < 2) return []
  const headers = rows[0].map((value) => value.trim())
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])))
}

function normalizeRow(row, rowNumber) {
  for (const header of HEADERS) if (!Object.hasOwn(row, header)) throw new Error(`Row ${rowNumber}: missing column ${header}`)
  const engine = row.engine.trim().toLowerCase()
  const variant = row.variant.trim().toLowerCase() || null
  if (!['comparison','spectrum','category'].includes(engine)) throw new Error(`Row ${rowNumber}: invalid engine`)
  if (!['Love Court','Life Court','Conflict Court'].includes(row.category.trim())) throw new Error(`Row ${rowNumber}: invalid category`)
  if (!['free','plus'].includes(row.access_tier.trim().toLowerCase())) throw new Error(`Row ${rowNumber}: invalid access_tier`)
  let questions; let results
  try { questions = JSON.parse(row.questions_json); results = JSON.parse(row.results_json) } catch { throw new Error(`Row ${rowNumber}: invalid JSON cell`) }
  if (!Array.isArray(questions) || questions.length < 2) throw new Error(`Row ${rowNumber}: questions_json must be an array`)
  if (!results || Array.isArray(results) || typeof results !== 'object') throw new Error(`Row ${rowNumber}: results_json must be an object`)
  const expected = engine === 'spectrum' && variant === 'dual_pole' ? ENGINE_KEYS.dual_pole : ENGINE_KEYS[engine]
  const missing = expected.filter((key) => !results[key])
  if (missing.length) throw new Error(`Row ${rowNumber}: missing result keys ${missing.join(', ')}`)
  const normalizedQuestions = questions.map((question, index) => ({
    number: index + 1, prompt: String(question.prompt || '').trim(),
    responseType: question.responseType || (question.required === false ? 'Short text' : 'Single select'),
    questionClass: question.questionClass || 'STRUCTURED CHOICE',
    options: Array.isArray(question.options) ? question.options.map((option, optionIndex) => typeof option === 'string'
      ? { label: option, value: `q${index + 1}_o${optionIndex + 1}` }
      : option) : [],
    analysisDimension: question.analysisDimension || (index === 0 ? (engine === 'comparison' ? 'comparison_vote' : engine === 'spectrum' ? 'position' : 'category') : 'flavor'),
    required: question.required !== false,
  }))
  const satisfaction = normalizedQuestions.find((question) => question.analysisDimension === 'satisfaction')
  return {
    caseId: row.case_id.trim(), category: row.category.trim(), subcategory: row.subcategory.trim(),
    title: row.title.trim(), subtitle: row.subtitle.trim(), engine, variant,
    accessTier: row.access_tier.trim().toLowerCase(), status: row.status.trim() || 'Launch v4',
    questions: normalizedQuestions, results,
    analysisConfig: { version: 4, engine, variant, positionQuestionNumber: 1,
      satisfactionQuestionNumber: satisfaction?.number || null, categoryQuestionNumber: engine === 'category' ? 1 : null,
      weightQuestionNumber: engine === 'category' ? 2 : null },
  }
}

function chunks(items, size = 50) {
  const output = []
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size))
  return output
}

export async function GET(request) {
  const auth = await requireAdmin(); if (auth.error) return auth.error
  const action = new URL(request.url).searchParams.get('action')
  if (action === 'template') {
    const questions = [{ prompt: 'Who is more likely to do this?', options: ['Me, no contest','Probably me','Probably them','Definitely them','Honestly? We both are'], analysisDimension: 'comparison_vote', required: true }, { prompt: 'Got more evidence? (optional)', options: [], analysisDimension: 'free_text', required: false, responseType: 'Short text' }]
    const result = { aha_tool: 'Reframe', verdict: '[A] and [B] see this differently.', actions_a: 'Try one small action.', actions_b: 'Notice the result.', try_together: 'Compare notes on Sunday.', closing: 'Case dismissed.' }
    const results = Object.fromEntries(ENGINE_KEYS.comparison.map((key) => [key, result]))
    const example = ['example-case-01','Love Court','Real Talk','Example Case','A short card subtitle.','comparison','','plus','Launch v4',JSON.stringify(questions),JSON.stringify(results)]
    const csv = `${HEADERS.join(',')}\n${example.map(csvEscape).join(',')}\n`
    return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="bunny-court-upload-template.csv"' } })
  }
  const db = createAdminClient()
  const { data, error } = await db.from('court_case_definitions').select('case_id,category,subcategory,title,engine,access_tier,status,updated_at').order('updated_at', { ascending: false }).limit(500)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, cases: data || [] }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request) {
  const auth = await requireAdmin(); if (auth.error) return auth.error
  try {
    const form = await request.formData(); const file = form.get('file')
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith('.csv')) return NextResponse.json({ error: 'Upload a .csv spreadsheet.' }, { status: 400 })
    const rows = parseCsv(await file.text())
    const cases = rows.map((row, index) => normalizeRow(row, index + 2))
    if (!cases.length) return NextResponse.json({ error: 'The spreadsheet has no case rows.' }, { status: 400 })
    const db = createAdminClient()
    const definitions = cases.map((item) => ({
      case_id: item.caseId, category: item.category, subcategory: item.subcategory, title: item.title,
      card_subtitle: item.subtitle, eligibility: 'All paired relationships', engine: item.engine,
      access_tier: item.accessTier, verdict_method: 'DETERMINISTIC + OPTIONAL AI PERSONALIZATION',
      user_value: 'Compare two sealed answers and return the approved verdict branch.', question_count: item.questions.length,
      repeatability: 'Replayable', sensitivity: item.category === 'Conflict Court' ? 'Medium' : 'Low', status: item.status,
      analysis_logic: JSON.stringify(item.analysisConfig), outcome_keys: Object.keys(item.results),
      scoring_display: 'Never shown as a relationship score', result_anatomy: 'Verdict + two individual actions + Try This Together + closing',
      insufficient_evidence_rule: 'Use the fixed template unless meaningful optional context is present.', content_version: 4,
      notification_copy: { inviteTitle: 'A case has been filed.', inviteBody: `Your person filed ${item.title}. The court needs your side.`, inviteCta: 'Testify Now', readyTitle: 'The verdict is ready.', readyBody: `Both sides are in. Bunny Judge has ruled on ${item.title}.`, readyCta: 'Hear the Verdict' },
    }))
    for (const batch of chunks(definitions)) { const { error } = await db.from('court_case_definitions').upsert(batch, { onConflict: 'case_id' }); if (error) throw error }
    for (const batch of chunks(cases.map((item) => item.caseId))) {
      let result = await db.from('court_questions').delete().in('case_id', batch); if (result.error) throw result.error
      result = await db.from('court_verdict_templates').delete().in('case_id', batch); if (result.error) throw result.error
    }
    const questions = cases.flatMap((item) => item.questions.map((question) => ({ case_id: item.caseId, question_number: question.number, prompt: question.prompt, other_player_prompt: 'Same question shown independently to both players.', response_type: question.responseType, question_class: question.questionClass, access_tag: item.accessTier.toUpperCase(), options: question.options, analysis_dimension: question.analysisDimension, required: question.required, interaction_rule: 'Answers stay sealed until both finish.' })))
    const templates = cases.flatMap((item) => Object.entries(item.results).map(([key, value]) => ({ case_id: item.caseId, outcome_key: key, headline: value.closing || 'THE VERDICT', what_court_heard: value.role_note || '', verdict: value.verdict, court_ordered_move: `${value.actions_a || ''} ${value.actions_b || ''}`.trim(), share_text: value.closing || '', tone_condition: 'Approved v4 template', aha_tool: value.aha_tool || '', role_note: value.role_note || '', action_a: value.actions_a || '', action_b: value.actions_b || '', try_together: value.try_together || '', closing: value.closing || '' })))
    for (const batch of chunks(questions, 300)) { const { error } = await db.from('court_questions').insert(batch); if (error) throw error }
    for (const batch of chunks(templates, 300)) { const { error } = await db.from('court_verdict_templates').insert(batch); if (error) throw error }
    return NextResponse.json({ success: true, imported: cases.length, questions: questions.length, templates: templates.length })
  } catch (error) {
    return NextResponse.json({ error: error?.message || 'Import failed.' }, { status: 400 })
  }
}
