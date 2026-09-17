import fs from 'node:fs'
import path from 'node:path'

const sourcePath = process.argv[2]
if (!sourcePath) throw new Error('Usage: node tools/build-bunny-court-v3.mjs <final-markdown>')
const source = fs.readFileSync(sourcePath, 'utf8').replace(/\r/g, '')
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

const sql = (value) => `'${String(value ?? '').replaceAll("'", "''")}'`
const json = (value) => `${sql(JSON.stringify(value))}::jsonb`
const slug = (value) => String(value).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 52) || 'default'
const clean = (value) => String(value || '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim()

function categoryCaseId(category, number) {
  // The source's global Case # values and its later court-local IDs overlap
  // (for example Case #011 and LOVE-11 are different cases). Keep the global
  // set in a collision-proof namespace instead of silently dropping content.
  return `CASE-${String(number).padStart(3, '0')}`
}

function parseOptions(raw) {
  const normalized = raw.replace(/^\s*-\s*/gm, ' ').replace(/\s*→\s*\*\*([+-]?\d+)\*\*/g, ' ($1)')
  const matches = [...normalized.matchAll(/(?:^|\s)([A-E])\)\s*([\s\S]*?)(?=\s+[A-E]\)|$)/g)]
  return matches.map((match) => {
    const score = match[2].match(/\(([+-]?\d+)\)\s*$/)?.[1]
    const label = clean(match[2].replace(/\s*\([+-]?\d+\)\s*$/, ''))
    return { label, value: score == null ? match[1] : `${match[1]}:${Number(score)}` }
  })
}

function templateFields(block) {
  const field = (start, end) => clean(block.match(new RegExp(`${start}\\n([\\s\\S]*?)(?=\\n(?:${end})|$)`))?.[1])
  return {
    what: field('📋 The Case', '⚖️ The Verdict'),
    verdict: field('⚖️ The Verdict', '📜 Court-Ordered Actions'),
    move: [field('📜 Court-Ordered Actions', '💌 Try This Together'), field('💌 Try This Together', '🥕 Case dismissed')].filter(Boolean).join(' '),
    share: field('🥕 Case dismissed\\.?', '$'),
  }
}

function parseLegacy() {
  const end = source.indexOf('\n# Love Court\n', source.indexOf('## Remaining 44 cases'))
  const text = source.slice(0, end)
  const metas = [...text.matchAll(/^\*\*(Love Court|Life Court|Conflict Court) \/ (Free|Plus) \/ Case #(\d+)\*\*$/gm)]
  return metas.map((meta, index) => {
    const start = meta.index
    const finish = metas[index + 1]?.index ?? text.length
    const body = text.slice(start, finish)
    const prefix = text.slice(Math.max(0, text.lastIndexOf('\n#', start - 2)), start)
    const title = clean(prefix.match(/^#(?:\s*案例\d+：)?\s*(.+)$/m)?.[1])
    const category = meta[1]
    const caseId = categoryCaseId(category, Number(meta[3]))
    const questionMatches = [...body.matchAll(/^\*\*Q(\d+)(?:（[^）]*）)?\.\s*(.*?)\*\*/gm)]
    const questions = questionMatches.map((question, questionIndex) => {
      const questionBody = body.slice(question.index + question[0].length, questionMatches[questionIndex + 1]?.index ?? body.indexOf('**分值范围', question.index))
      const options = parseOptions(questionBody)
      const isLast = questionIndex === questionMatches.length - 1
      return {
        number: Number(question[1]), prompt: clean(question[2]),
        responseType: isLast ? 'Short text' : 'Single select',
        options: isLast ? [] : options, required: !isLast,
        dimension: isLast ? 'optional_context' : `spectrum_${question[1]}`,
      }
    })
    const templateMatches = [...body.matchAll(/^### 模板\d+：([^\n]+)\n(?:\n)?```\n([\s\S]*?)\n```/gm)]
    const templates = templateMatches.map((template, templateIndex) => {
      const fields = templateFields(template[2])
      return {
        key: `spectrum_${templateIndex + 1}`,
        headline: clean(template[1]).toUpperCase(),
        what: fields.what, verdict: fields.verdict, move: fields.move,
        share: fields.share || `Bunny Court closed ${title}.`,
      }
    })
    if (questions.length < 4 || templates.length !== 6) throw new Error(`Legacy parse failed for ${caseId}: ${questions.length} questions, ${templates.length} templates`)
    const thresholdLine = body.match(/\*\*分值范围：[^\n]*?阈值：([^\n]+)\*\*/)?.[1]
      || body.match(/分值范围：[^\n]*?阈值：([^\n]+)/)?.[1] || ''
    const highMin = Number(thresholdLine.match(/≥\+?(-?\d+)/)?.[1] ?? 3)
    const lowMax = Number(thresholdLine.match(/≤\s*(-?\d+)/)?.[1] ?? -3)
    return {
      id: caseId, category, tier: meta[2].toLowerCase(), title,
      subtitle: clean(body.match(/### 维度：([^\n]+)/)?.[1] || 'Compare your answers and let Bunny Court rule.'),
      engine: 'SPECTRUM_V3', questions, templates,
      analysis: { kind: 'spectrum_v3', highMin, lowMax }, sensitivity: category === 'Conflict Court' ? 'Medium' : 'Low',
    }
  })
}

function parseNew() {
  const start = source.indexOf('\n# Love Court\n', source.indexOf('## Remaining 44 cases'))
  const end = source.indexOf('\n# Exact deterministic trigger matrix', start)
  const text = source.slice(start, end)
  const headings = [...text.matchAll(/^## ((?:LOVE|LIFE|MIDDLE)-\d+) — (.+)$/gm)]
  return headings.map((heading, index) => {
    const body = text.slice(heading.index, headings[index + 1]?.index ?? text.length)
    const meta = body.match(/^\*\*Court:\*\* (Love Court|Life Court|Conflict Court) \| \*\*Tier:\*\* (Free|Plus)/m)
    if (!meta) throw new Error(`Missing metadata for ${heading[1]}`)
    const questionsPart = body.match(/### Questions\n\n([\s\S]*?)\n\n### Deterministic mapping/)?.[1] || ''
    const questionLines = [...questionsPart.matchAll(/^(\d+)\. (.+)$/gm)]
    const questions = questionLines.map((question) => {
      const optionStart = question[2].search(/\sA\) /)
      const prompt = optionStart >= 0 ? question[2].slice(0, optionStart) : question[2]
      const options = optionStart >= 0 ? parseOptions(question[2].slice(optionStart + 1)) : []
      return {
        number: Number(question[1]), prompt: clean(prompt.replace(/^Optional:\s*/i, 'Optional: ')),
        responseType: options.length ? 'Single select' : 'Short text', options,
        required: options.length > 0, dimension: options.length ? `signal_${question[1]}` : 'optional_context',
      }
    })
    const mappingPart = body.match(/### Deterministic mapping\n\n([\s\S]*?)\n\n### Complete result branches/)?.[1] || ''
    const branchOrder = [...mappingPart.matchAll(/^- \*\*(.+?):\*\*/gm)].map((match) => clean(match[1]))
    const resultsPart = body.match(/### Complete result branches\n\n([\s\S]*)$/)?.[1] || ''
    const branchHeadings = [...resultsPart.matchAll(/^#### (.+)$/gm)]
    const branches = branchHeadings.map((branch, branchIndex) => {
      const branchBody = resultsPart.slice(branch.index, branchHeadings[branchIndex + 1]?.index ?? resultsPart.length)
      const get = (name, next) => clean(branchBody.match(new RegExp(`\\*\\*${name}:\\*\\* ([\\s\\S]*?)(?=\\n\\n\\*\\*(?:${next}):\\*\\*|$)`))?.[1])
      return {
        name: clean(branch[1]), key: slug(branch[1]),
        what: get('The Case', 'The Verdict'), verdict: get('The Verdict', 'Court-Ordered Actions'),
        move: [get('Court-Ordered Actions', 'Try This Together'), get('Try This Together', 'Case dismissed')].filter(Boolean).join(' '),
        share: get('Case dismissed', 'NEVER_MATCH'),
      }
    })
    const templates = branchOrder.map((name) => {
      const found = branches.find((branch) => branch.name === name)
      if (!found) throw new Error(`Missing branch ${name} for ${heading[1]}`)
      return { ...found, headline: name.toUpperCase() }
    })
    if (questions.length !== 4 || templates.length !== 3) throw new Error(`New parse failed for ${heading[1]}: ${questions.length} questions, ${templates.length} templates`)
    return {
      id: heading[1], category: meta[1], tier: meta[2].toLowerCase(), title: clean(heading[2]),
      subtitle: clean(body.match(/^\*\*Card subtitle:\*\* (.+)$/m)?.[1]),
      engine: 'MATRIX_V3', questions, templates,
      analysis: { kind: 'matrix_v3', branchOrder: templates.map((item) => item.key) },
      sensitivity: heading[1].startsWith('MIDDLE-') ? 'Medium' : 'Low',
    }
  })
}

const cases = [...parseLegacy(), ...parseNew()]
const ids = new Set(cases.map((item) => item.id))
if (cases.length !== 65 || ids.size !== 65) throw new Error(`Expected 65 unique cases, got ${cases.length}/${ids.size}`)
if (cases.filter((item) => item.tier === 'free').length !== 3) throw new Error('Expected exactly 3 Free cases')

function migrationFor(category, stamp) {
  const selected = cases.filter((item) => item.category === category)
  const caseIds = selected.map((item) => sql(item.id)).join(',')
  const definitions = selected.map((item) => `(${[
    sql(item.id), sql(item.category), sql(item.title), sql(item.subtitle), sql('Paired users'), sql(item.engine), sql(item.tier),
    sql('RULES_WITH_OPTIONAL_AI'), sql('A sealed two-player verdict'), item.questions.length, sql('Anytime'), sql(item.sensitivity), sql('Launch'),
    sql(JSON.stringify(item.analysis)), json(item.templates.map((template) => template.key)), sql('Private structured evidence only'),
    sql('The Case + Verdict + Court-Ordered Actions + Try This Together'), sql('Deterministic fallback'),
    json({ inviteTitle: 'A case has been filed.', inviteBody: `${item.title} needs your testimony.`, readyTitle: 'The verdict is ready.', readyBody: `Bunny Judge has ruled on ${item.title}.` }), 3,
  ].join(',')})`).join(',\n')
  const questions = selected.flatMap((item) => item.questions.map((question) => `(${[
    sql(item.id), question.number, sql(question.prompt), sql('Same question shown independently to both players.'), sql(question.responseType),
    sql(question.required ? 'STRUCTURED CHOICE' : 'OPTIONAL PRIVATE CONTEXT'), sql(item.tier.toUpperCase()), json(question.options),
    sql(question.dimension), question.required, sql('Answers stay sealed until both finish.'),
  ].join(',')})`)).join(',\n')
  const templates = selected.flatMap((item) => item.templates.map((template) => `(${[
    sql(item.id), sql(template.key), sql(template.headline), sql(template.what), sql(template.verdict), sql(template.move),
    sql(template.share || `Bunny Court closed ${item.title}.`), sql(item.category === 'Conflict Court' ? 'Calm, validating, low-blame.' : 'Warm, specific, lightly playful.'),
  ].join(',')})`)).join(',\n')
  const retire = category === 'Love Court' ? "update public.court_case_definitions set status = 'Retired' where status ilike '%Launch';\n" : ''
  return `-- Generated from Bunny_Court_All_65_Cases_Final.md. Do not hand-edit.\n${retire}
delete from public.court_questions where case_id in (${caseIds});
delete from public.court_verdict_templates where case_id in (${caseIds});

insert into public.court_case_definitions (
  case_id,category,title,card_subtitle,eligibility,engine,access_tier,verdict_method,user_value,
  question_count,repeatability,sensitivity,status,analysis_logic,outcome_keys,scoring_display,result_anatomy,
  insufficient_evidence_rule,notification_copy,content_version
) values\n${definitions}
on conflict (case_id) do update set
  category=excluded.category,title=excluded.title,card_subtitle=excluded.card_subtitle,eligibility=excluded.eligibility,
  engine=excluded.engine,access_tier=excluded.access_tier,verdict_method=excluded.verdict_method,user_value=excluded.user_value,
  question_count=excluded.question_count,repeatability=excluded.repeatability,sensitivity=excluded.sensitivity,status=excluded.status,
  analysis_logic=excluded.analysis_logic,outcome_keys=excluded.outcome_keys,scoring_display=excluded.scoring_display,
  result_anatomy=excluded.result_anatomy,insufficient_evidence_rule=excluded.insufficient_evidence_rule,
  notification_copy=excluded.notification_copy,content_version=excluded.content_version,updated_at=now();

insert into public.court_questions (
  case_id,question_number,prompt,other_player_prompt,response_type,question_class,access_tag,options,
  analysis_dimension,required,interaction_rule
) values\n${questions};

insert into public.court_verdict_templates (
  case_id,outcome_key,headline,what_court_heard,verdict,court_ordered_move,share_text,tone_condition
) values\n${templates};
`
}

const outputs = [
  ['Love Court', '20260916000091_bunny_court_content_v3_love.sql'],
  ['Life Court', '20260916000092_bunny_court_content_v3_life.sql'],
  ['Conflict Court', '20260916000093_bunny_court_content_v3_conflict.sql'],
]
for (const [category, filename] of outputs) {
  fs.writeFileSync(path.join(repo, 'supabase/migrations', filename), migrationFor(category, filename))
}
fs.writeFileSync(path.join(repo, 'docs/bunny-court-content-v3.json'), JSON.stringify(cases, null, 2))
console.log(JSON.stringify({ cases: cases.length, free: cases.filter((item) => item.tier === 'free').length, questions: cases.reduce((sum, item) => sum + item.questions.length, 0), templates: cases.reduce((sum, item) => sum + item.templates.length, 0) }))
