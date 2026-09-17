import { createClient } from '@supabase/supabase-js'
import { callAI, getAIModelConfig, parseAIJson } from './ai'
import { recordAIUsage } from './ai-usage'
import { drainPushNotificationOutbox } from './push-notifications'
import { fixedLaunchOutcomeV2 } from './bunny-court-rules-v2.mjs'
import { fixedLaunchOutcomeV3 } from './bunny-court-rules-v3.mjs'
import { resolveUserLocalDate } from './user-local-date'

const EXPIRABLE_STATUSES = ['awaiting_initiator', 'awaiting_partner', 'processing']
const LOVE_RELATIONSHIPS = new Set(['Lover', 'Partner', 'Someone Special'])
const HEAVY_TEXT = /\b(kill|suicide|self[- ]?harm|hit me|hurt me|threat|abuse|abusive|coerc|forced|unsafe|weapon|rape|stalk)\b|自杀|自残|杀|打我|伤害我|威胁|虐待|强迫|不安全|跟踪/i

export function courtServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export function pairBounds(userId, partnerId) {
  return userId < partnerId ? [userId, partnerId] : [partnerId, userId]
}

export async function loadPair(supabase, userId) {
  const { data, error } = await supabase.from('pairings')
    .select('partner_user_id,relationship').eq('user_id', userId).maybeSingle()
  if (error) throw error
  return data || null
}

export async function loadCourtCase(supabase, caseId) {
  const [definitionResult, questionResult, templateResult] = await Promise.all([
    supabase.from('court_case_definitions').select('*').eq('case_id', caseId).ilike('status', '%Launch').maybeSingle(),
    supabase.from('court_questions').select('*').eq('case_id', caseId).order('question_number'),
    supabase.from('court_verdict_templates').select('*').eq('case_id', caseId),
  ])
  if (definitionResult.error) throw definitionResult.error
  if (questionResult.error) throw questionResult.error
  if (templateResult.error) throw templateResult.error
  return definitionResult.data ? {
    definition: definitionResult.data,
    questions: questionResult.data || [],
    templates: templateResult.data || [],
  } : null
}

function normalizedAnswerMap(questions, submitted) {
  const byQuestion = new Map(questions.map((question) => [question.question_number, question]))
  const clean = {}
  for (const raw of Array.isArray(submitted) ? submitted : []) {
    const number = Number(raw?.questionNumber)
    const question = byQuestion.get(number)
    if (!question || Object.hasOwn(clean, number)) continue
    const allowed = new Set((question.options || []).map((option) => option.value))
    let value = raw?.value
    if (question.response_type === 'Multi select') {
      if (!Array.isArray(value)) throw new Error(`invalid_answer_${number}`)
      value = [...new Set(value.filter((entry) => typeof entry === 'string' && allowed.has(entry)))].slice(0, 8)
      if (question.required && value.length === 0) throw new Error(`missing_answer_${number}`)
    } else if (question.response_type === 'Short text') {
      value = typeof value === 'string' ? value.trim().slice(0, 600) : ''
      if (question.required && !value) throw new Error(`missing_answer_${number}`)
    } else if (question.response_type === 'Memory picker') {
      value = typeof value === 'string' ? value.trim().slice(0, 500) : ''
      if (question.required && !value) throw new Error(`missing_answer_${number}`)
    } else {
      if (typeof value !== 'string' || !allowed.has(value)) throw new Error(`invalid_answer_${number}`)
    }
    clean[number] = value
  }
  for (const question of questions) {
    if (question.required && !Object.hasOwn(clean, question.question_number)) {
      throw new Error(`missing_answer_${question.question_number}`)
    }
  }
  return clean
}

export function validateCourtAnswers(questions, answers) {
  return normalizedAnswerMap(questions, answers)
}

function optionIndex(question, value) {
  return Math.max(0, (question.options || []).findIndex((option) => option.value === value))
}

function answerForDimension(questions, answers, dimension) {
  const question = questions.find((item) => item.analysis_dimension === dimension)
  return question ? answers[question.question_number] : undefined
}

function sameAnswer(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    const left = Array.isArray(a) ? [...a].sort() : [a]
    const right = Array.isArray(b) ? [...b].sort() : [b]
    return JSON.stringify(left) === JSON.stringify(right)
  }
  return a === b
}

function includesAnswer(container, value) {
  return Array.isArray(container) ? container.includes(value) : container === value
}

function overlapCount(left, right) {
  const a = Array.isArray(left) ? left : left == null ? [] : [left]
  const b = new Set(Array.isArray(right) ? right : right == null ? [] : [right])
  return a.filter((value) => b.has(value)).length
}

function ordinalGap(left, right, order) {
  const a = order.indexOf(left)
  const b = order.indexOf(right)
  return a < 0 || b < 0 ? 0 : Math.abs(a - b)
}

function fixedLaunchOutcome(definition, questions, first, second) {
  const value = (answers, dimension) => answerForDimension(questions, answers, dimension)
  const crossMatches = (leftDimension, rightDimension) => Number(sameAnswer(value(first, leftDimension), value(second, rightDimension)))
    + Number(sameAnswer(value(second, leftDimension), value(first, rightDimension)))
  switch (definition.case_id) {
    case 'LOVE-04': {
      const desiredToInitiation = { checkin: ['text', 'call'], affection: ['physical_affection'], plans: ['plan'], appreciation: ['appreciation'], balanced: [] }
      const aDesired = value(first, 'desired_channel'); const bDesired = value(second, 'desired_channel')
      const aSatisfied = aDesired === 'balanced' || desiredToInitiation[aDesired]?.some((item) => includesAnswer(value(second, 'initiation_channels'), item))
      const bSatisfied = bDesired === 'balanced' || desiredToInitiation[bDesired]?.some((item) => includesAnswer(value(first, 'initiation_channels'), item))
      if (aSatisfied && bSatisfied) return 'balanced'
      const aCount = Array.isArray(value(first, 'initiation_channels')) ? value(first, 'initiation_channels').length : 0
      const bCount = Array.isArray(value(second, 'initiation_channels')) ? value(second, 'initiation_channels').length : 0
      return Math.abs(aCount - bCount) >= 2 ? 'imbalance' : 'missed_channel'
    }
    case 'CLOSE-02': {
      const matches = ['comfort_pick', 'plan_pick', 'support_pick', 'current_phrase']
        .filter((dimension) => sameAnswer(value(first, dimension), value(second, dimension))).length
      return matches >= 4 ? 'high' : matches >= 2 ? 'mixed' : 'low'
    }
    case 'CLOSE-06': {
      const matches = ['food_pick', 'free_hour', 'message_pick', 'treat_pick']
        .filter((dimension) => sameAnswer(value(first, dimension), value(second, dimension))).length
      return matches >= 4 ? 'perfect' : matches >= 2 ? 'good' : 'chaos'
    }
    case 'LIFE-01': {
      const effort = [value(first, 'effort'), value(second, 'effort')]
      const budget = [value(first, 'budget'), value(second, 'budget')]
      if (effort.includes('zero') || budget.includes('low')) return 'low_energy'
      return sameAnswer(value(first, 'craving'), value(second, 'craving')) ? 'clear' : 'split'
    }
    case 'LIFE-02': {
      const need = [value(first, 'need'), value(second, 'need')]
      const mustHave = [value(first, 'must_have'), value(second, 'must_have')]
      if (need[0] === need[1] && mustHave[0] === mustHave[1]) return 'aligned'
      if (need.includes('rest') || mustHave.includes('alone_time')) return 'rest_adventure'
      return 'productive_cozy'
    }
    case 'LIFE-03': {
      const windowOverlap = overlapCount(value(first, 'energy_window'), value(second, 'energy_window'))
      const format = [value(first, 'format'), value(second, 'format')]
      if (!windowOverlap || format.includes('voice_notes')) return 'format_bridge'
      return sameAnswer(format[0], format[1]) && sameAnswer(value(first, 'duration'), value(second, 'duration'))
        ? 'overlap' : 'energy_gap'
    }
    case 'LIFE-04': {
      if (sameAnswer(value(first, 'priority'), value(second, 'priority'))
        && sameAnswer(value(first, 'pace'), value(second, 'pace'))) return 'aligned'
      return ordinalGap(value(first, 'pace'), value(second, 'pace'), ['open', 'light', 'balanced', 'packed']) >= 2
        ? 'pace_gap' : 'priority_gap'
    }
    case 'LIFE-05': {
      if (sameAnswer(value(first, 'mood'), value(second, 'mood'))
        && sameAnswer(value(first, 'attention'), value(second, 'attention'))) return 'clear'
      return ordinalGap(value(first, 'attention'), value(second, 'attention'), ['background', 'light', 'full']) >= 1
        ? 'attention_gap' : 'picker'
    }
    case 'LIFE-06': {
      const capacity = [value(first, 'capacity'), value(second, 'capacity')]
      if (capacity.some((item) => ['none', 'low'].includes(item))) return 'low_capacity'
      const history = [value(first, 'history'), value(second, 'history')]
      return (history[0] === 'self' && history[1] === 'other') || (history[0] === 'other' && history[1] === 'self')
        ? 'clear_owner' : 'split_roles'
    }
    case 'MIDDLE-01': {
      const aligned = ['comfort_window', 'reassurance_signal', 'commitment']
        .every((dimension) => sameAnswer(value(first, dimension), value(second, dimension)))
      if (aligned) return 'aligned'
      const noSignal = [value(first, 'reassurance_signal'), value(second, 'reassurance_signal')].includes('none')
      const wideGap = ordinalGap(value(first, 'comfort_window'), value(second, 'comfort_window'), ['hours', 'end_of_day', 'full_day']) >= 2
      return noSignal && wideGap ? 'no_overlap' : 'bridge'
    }
    case 'MIDDLE-02': {
      if (sameAnswer(value(first, 'conflict_pace'), value(second, 'conflict_pace'))
        && sameAnswer(value(first, 'pause_length'), value(second, 'pause_length'))) return 'aligned'
      const risks = [...(Array.isArray(value(first, 'pause_risk')) ? value(first, 'pause_risk') : []),
        ...(Array.isArray(value(second, 'pause_risk')) ? value(second, 'pause_risk') : [])]
      return [value(first, 'conflict_pace'), value(second, 'conflict_pace')].every((item) => item === 'talk_now')
        || risks.includes('sudden_silence') ? 'too_hot' : 'pace_gap'
    }
    case 'MIDDLE-03': {
      const needs = [value(first, 'first_need'), value(second, 'first_need')]
      if (sameAnswer(needs[0], needs[1])) return 'aligned'
      const fixing = new Set(['advice', 'practical_help'])
      const hearing = new Set(['listening', 'validation'])
      return (fixing.has(needs[0]) && hearing.has(needs[1])) || (fixing.has(needs[1]) && hearing.has(needs[0]))
        ? 'fixer_listener' : 'different_days'
    }
    case 'MIDDLE-04': {
      if (sameAnswer(value(first, 'space_meaning'), value(second, 'space_meaning'))
        && sameAnswer(value(first, 'duration'), value(second, 'duration'))) return 'aligned'
      const assurances = [value(first, 'reassurance'), value(second, 'reassurance')]
      const triggers = overlapCount(value(first, 'rejection_trigger'), value(second, 'rejection_trigger'))
      return assurances.includes('none') && triggers === 0 ? 'unclear' : 'bridge'
    }
    case 'MIDDLE-05': {
      if (sameAnswer(value(first, 'quality_type'), value(second, 'quality_type'))
        && sameAnswer(value(first, 'ritual'), value(second, 'ritual'))) return 'aligned'
      return ordinalGap(value(first, 'capacity'), value(second, 'capacity'), ['10m', '30m', '60m']) >= 2
        ? 'capacity_gap' : 'type_gap'
    }
    case 'MIDDLE-06': {
      if (sameAnswer(value(first, 'battery'), value(second, 'battery'))
        && sameAnswer(value(first, 'contact_level'), value(second, 'contact_level'))
        && sameAnswer(value(first, 'compromise'), value(second, 'compromise'))) return 'aligned'
      const battery = [value(first, 'battery'), value(second, 'battery')]
      const compromise = [value(first, 'compromise'), value(second, 'compromise')]
      return battery.some((item) => ['empty', 'low'].includes(item))
        && compromise.some((item) => ['brief', 'timed'].includes(item)) ? 'short_plan' : 'bridge'
    }
    case 'LOVE-F01': {
      const matches = crossMatches('give_style', 'receive_style')
      return matches === 2 ? 'double_match' : matches === 1 ? 'one_match' : 'reroute'
    }
    case 'LOVE-F02': {
      const matches = crossMatches('sent_signal', 'wanted_signal')
      return matches === 2 ? 'same_frequency' : matches === 1 ? 'quiet_match' : 'hidden_signal'
    }
    case 'LOVE-F03': {
      const energy = [value(first, 'date_energy'), value(second, 'date_energy')]
      const budget = [value(first, 'budget'), value(second, 'budget')]
      const planning = [value(first, 'planning_capacity'), value(second, 'planning_capacity')]
      if (energy.includes('home') || budget.includes('free') || planning.every((item) => item === 'none')) return 'home_date'
      if (energy.includes('full_date') && !budget.includes('low') && planning.some((item) => ['simple_plan', 'full_plan'].includes(item))) return 'proper_date'
      return 'tiny_adventure'
    }
    case 'CLOSE-F01': {
      const needs = [value(first, 'first_need'), value(second, 'first_need')]
      const loads = [value(first, 'reply_load'), value(second, 'reply_load')]
      if (needs.includes('space') || loads.includes('no_reply')) return 'soft_mode'
      return sameAnswer(needs[0], needs[1]) ? 'shared_manual' : 'two_manuals'
    }
    case 'CLOSE-F02': {
      const matches = ['current_lift', 'energy_drain', 'followup']
        .filter((dimension) => sameAnswer(value(first, dimension), value(second, dimension))).length
      return matches === 3 ? 'radar_locked' : matches > 0 ? 'signal_found' : 'fresh_lore'
    }
    case 'CLOSE-F03': {
      const available = [value(first, 'available_signal'), value(second, 'available_signal')]
      const wanted = [value(first, 'wanted_signal'), value(second, 'wanted_signal')]
      if (available.includes('none') || wanted.includes('warm_space')) return 'space_with_warmth'
      const matches = crossMatches('available_signal', 'wanted_signal')
      return matches === 2 ? 'quiet_sync' : matches === 1 ? 'one_easy_bridge' : 'space_with_warmth'
    }
    case 'LIFE-F01': {
      const battery = [value(first, 'battery'), value(second, 'battery')]
      const channel = [value(first, 'channel'), value(second, 'channel')]
      if (channel.includes('solo')) return 'solo_reset'
      if (battery.some((item) => ['zero', 'low'].includes(item)) || channel.includes('text')) return 'tiny_touchpoint'
      return 'shared_reset'
    }
    case 'LIFE-F02': {
      const duration = [value(first, 'duration'), value(second, 'duration')]
      const habitat = [value(first, 'habitat'), value(second, 'habitat')]
      if (habitat.includes('remote') || (habitat[0] !== habitat[1] && !habitat.includes('flexible'))) return 'remote_microdate'
      if (duration.includes('10') || duration.includes('30')) return 'quick_outing'
      return 'slow_evening'
    }
    case 'LIFE-F03': {
      const cleanSwap = includesAnswer(value(first, 'tolerated_chores'), value(second, 'hated_chore'))
        && includesAnswer(value(second, 'tolerated_chores'), value(first, 'hated_chore'))
      if (cleanSwap) return 'clean_swap'
      const aLoad = value(first, 'recent_load'); const bLoad = value(second, 'recent_load')
      if ((aLoad === 'self' && bLoad === 'other') || (aLoad === 'other' && bLoad === 'self')) return 'first_pick'
      return 'rotation'
    }
    case 'MIDDLE-F01': {
      const matches = ['frequency', 'channel'].filter((dimension) => sameAnswer(value(first, dimension), value(second, dimension))).length
      return matches === 2 ? 'same_settings' : matches === 1 ? 'light_bridge' : 'custom_settings'
    }
    case 'MIDDLE-F02':
      return sameAnswer(value(first, 'repair'), value(second, 'repair')) ? 'shared_protocol'
        : sameAnswer(value(first, 'notice'), value(second, 'notice')) ? 'two_step' : 'minimum_viable_repair'
    case 'MIDDLE-F03':
      if (sameAnswer(value(first, 'boundary'), value(second, 'boundary'))) return 'exact_treaty'
      if ([value(first, 'trigger'), value(second, 'trigger')].every((item) => item === 'none')) return 'awareness_only'
      return 'tiny_boundary'
    default:
      return null
  }
}

function deterministicOutcome(definition, questions, first, second) {
  const keys = Array.isArray(definition.outcome_keys) ? definition.outcome_keys : []
  if (keys.length <= 1) return keys[0] || 'default'
  const version = Number(definition.content_version || 1)
  const fixed = version >= 3
    ? fixedLaunchOutcomeV3(definition, questions, first, second)
    : version >= 2
      ? fixedLaunchOutcomeV2(definition, questions, first, second)
      : fixedLaunchOutcome(definition, questions, first, second)
  if (fixed && keys.includes(fixed)) return fixed
  let comparable = 0
  let matches = 0
  let firstScore = 0
  let secondScore = 0
  for (const question of questions) {
    const a = first[question.question_number]
    const b = second[question.question_number]
    if (a == null || b == null) continue
    comparable += 1
    if (JSON.stringify(a) === JSON.stringify(b)) matches += 1
    if (Array.isArray(a) && Array.isArray(b)) {
      matches += a.filter((value) => b.includes(value)).length * 0.25
      firstScore += a.length
      secondScore += b.length
    } else {
      firstScore += optionIndex(question, a)
      secondScore += optionIndex(question, b)
    }
  }
  const matchRatio = comparable ? matches / comparable : 0
  if (matchRatio >= 0.66 || Math.abs(firstScore - secondScore) <= 1) return keys[0]
  return firstScore > secondScore ? (keys[1] || keys[0]) : (keys[2] || keys[1] || keys[0])
}

export function contentForCourtSession(session, fallback) {
  const snapshot = session?.content_snapshot
  if (snapshot?.definition && Array.isArray(snapshot.questions) && Array.isArray(snapshot.templates)) {
    return snapshot
  }
  return fallback
}

export async function loadCourtSessionContent(supabase, session) {
  return contentForCourtSession(session, null) || await loadCourtCase(supabase, session.case_id)
}

export async function enqueueCourtNotification(supabase, recipientUserId, sessionId, eventType, copy) {
  const { error } = await supabase.from('notification_outbox').upsert({
    recipient_user_id: recipientUserId,
    event_key: `court:${eventType}:${sessionId}`,
    event_type: `court_${eventType}`,
    payload: { sessionId, ...copy },
  }, { onConflict: 'recipient_user_id,event_key', ignoreDuplicates: true })
  if (error) throw error
  void drainPushNotificationOutbox(supabase, 10).catch(() => {})
}

async function saveVerdict(supabase, session, definition, template, analysisMethod, model = null, overrides = {}) {
  const row = {
    session_id: session.id,
    case_id: session.case_id,
    engine: definition.engine,
    analysis_method: analysisMethod,
    outcome_key: overrides.outcomeKey || template.outcome_key,
    headline: overrides.headline || template.headline,
    what_court_heard: overrides.whatCourtHeard || template.what_court_heard,
    verdict: overrides.verdict || template.verdict,
    court_ordered_move: overrides.courtOrderedMove || template.court_ordered_move,
    share_text: overrides.shareText || template.share_text,
    safety_state: overrides.safetyState || 'safe',
    model,
  }
  const { error } = await supabase.from('court_verdicts').upsert(row, { onConflict: 'session_id' })
  if (error) throw error
  const readyAt = new Date().toISOString()
  const { data: transitioned, error: statusError } = await supabase.from('court_sessions').update({
    status: 'ready', verdict_ready_at: readyAt, updated_at: readyAt,
  }).eq('id', session.id).eq('status', 'processing').select('id').maybeSingle()
  if (statusError) throw statusError
  if (!transitioned) throw new Error('court_session_not_processing')
  // Realtime status changes are broadcast to both devices. The visible ready
  // push is only for the person who submitted first; the second responder is
  // already watching the in-court analysis state.
  const { data: firstSubmission } = await supabase.from('court_submissions').select('user_id')
    .eq('session_id', session.id).order('submitted_at', { ascending: true }).limit(1).maybeSingle()
  if (firstSubmission?.user_id) {
    await enqueueCourtNotification(supabase, firstSubmission.user_id, session.id, 'ready', {
      title: definition.notification_copy?.readyTitle, body: definition.notification_copy?.readyBody,
    })
  }
  return row
}

function resolvedRuleTemplate(session, content, submissions) {
  const first = submissions.find((submission) => submission.user_id === session.initiator_id)?.answers || {}
  const second = submissions.find((submission) => submission.user_id === session.partner_id)?.answers || {}
  const outcomeKey = deterministicOutcome(content.definition, content.questions, first, second)
  const template = content.templates.find((item) => item.outcome_key === outcomeKey) || content.templates[0]
  if (!template) throw new Error('court_template_missing')
  return template
}

export async function generateRuleVerdict(supabase, session, content, submissions, analysisMethod = 'deterministic_rules') {
  return saveVerdict(supabase, session, content.definition, resolvedRuleTemplate(session, content, submissions), analysisMethod)
}

function containsHeavyText(submissions) {
  return submissions.some((submission) => Object.values(submission.answers || {}).some((value) =>
    typeof value === 'string' && HEAVY_TEXT.test(value)))
}

function meaningfulOpenText(questions, submissions) {
  const openNumbers = new Set(questions
    .filter((question) => question.response_type === 'Short text')
    .map((question) => String(question.question_number)))
  return submissions.some((submission) => Object.entries(submission.answers || {}).some(([number, value]) => {
    if (!openNumbers.has(String(number)) || typeof value !== 'string') return false
    const text = value.trim()
    const cjkCharacters = (text.match(/[\u3400-\u9fff]/g) || []).length
    return text.length >= 8 || cjkCharacters >= 4
  }))
}

async function claimCourtAI(supabase, session) {
  if (session.access_tier_snapshot !== 'plus') return false
  const localDate = await resolveUserLocalDate(supabase, session.initiator_id)
  const { data, error } = await supabase.rpc('claim_court_ai_credit', {
    p_user_id: session.initiator_id,
    p_session_id: session.id,
    p_local_date: localDate,
  })
  if (error) throw error
  return data?.eligible === true
}

const COURT_SYSTEM_PROMPT = `You are Bunny Court, a warm, playful, privacy-safe judge for two people. The deterministic rules already selected the correct verdict branch. Personalize that branch using the supplied private context without changing its conclusion. Return JSON only.

Rules:
- Never score or rank love, care, attraction, compatibility, trust, commitment, closeness, or relationship health.
- Conflict Court has no winner, loser, guilt assignment, diagnosis, or forced compromise. State each need, the real overlap, and one voluntary next step.
- Never quote, reveal, or place raw open-text testimony in share copy.
- Keep headline to 3-8 words, What the Court Heard and verdict to 1-2 short sentences each, and the move to one doable action within 7 days.
- Love may be witty and warm. Life should be practical with light humor. Conflict should be calm, validating, and low-blame.
- Remove jokes for grief, health, money stress, discrimination, trauma, serious conflict, threats, abuse, coercion, stalking, self-harm, or immediate danger. For danger or coercion set safetyState to safety_redirect, do not mediate, and encourage a trusted nearby person or appropriate local emergency/support resource.`

export async function processCourtVerdictJob(supabase, sessionId) {
  const now = new Date().toISOString()
  const { data: job } = await supabase.from('court_verdict_jobs').update({
    status: 'processing', locked_at: now, updated_at: now,
  }).eq('session_id', sessionId).in('status', ['pending', 'retry']).lte('next_attempt_at', now)
    .select('*').maybeSingle()
  if (!job) return null
  try {
    const [{ data: session }, { data: submissions }] = await Promise.all([
      supabase.from('court_sessions').select('*').eq('id', sessionId).maybeSingle(),
      supabase.from('court_submissions').select('user_id,answers').eq('session_id', sessionId),
    ])
    if (!session || session.status !== 'processing' || submissions?.length !== 2) throw new Error('court_job_not_ready')
    const content = await loadCourtSessionContent(supabase, session)
    if (!content || content.templates.length === 0) throw new Error('court_content_missing')
    const ruleTemplate = resolvedRuleTemplate(session, content, submissions || [])
    if (containsHeavyText(submissions || [])) {
      const template = ruleTemplate
      await saveVerdict(supabase, session, content.definition, template, 'safety_redirect', null, {
        outcomeKey: template.outcome_key, headline: 'COURT ADJOURNED',
        whatCourtHeard: 'This deserves care beyond a playful verdict.',
        verdict: 'Bunny Court will not decide safety, coercion, abuse, or immediate-risk situations.',
        courtOrderedMove: 'Reach out to someone you trust nearby or an appropriate local support service.',
        shareText: 'Bunny Court paused this case for safety.', safetyState: 'safety_redirect',
      })
    } else if (!meaningfulOpenText(content.questions, submissions || []) || !await claimCourtAI(supabase, session)) {
      await saveVerdict(supabase, session, content.definition, ruleTemplate, 'deterministic_rules')
    } else {
      const safeAnswers = submissions.map((submission) => ({
        role: submission.user_id === session.initiator_id ? 'initiator' : 'partner',
        answers: content.questions.map((question) => ({
          questionNumber: question.question_number, dimension: question.analysis_dimension,
          value: submission.answers?.[question.question_number],
        })),
      }))
      const startedAt = Date.now()
      const ai = await callAI({
        systemInstruction: COURT_SYSTEM_PROMPT,
        userText: JSON.stringify({
          caseId: session.case_id, category: content.definition.category, title: content.definition.title,
          analysisLogic: content.definition.analysis_logic,
          selectedTemplate: {
            outcomeKey: ruleTemplate.outcome_key, headline: ruleTemplate.headline,
            whatCourtHeard: ruleTemplate.what_court_heard, verdict: ruleTemplate.verdict,
            courtOrderedMove: ruleTemplate.court_ordered_move,
          },
          testimony: safeAnswers,
        }),
        geminiModel: getAIModelConfig().bunnyCourt, skipDeepSeek: true, totalTimeoutMs: 30000,
        generationConfig: {
          temperature: 0.35, maxOutputTokens: 850, thinkingConfig: { thinkingBudget: 512 },
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT', required: ['headline','whatCourtHeard','verdict','courtOrderedMove','safetyState'],
            properties: {
              headline: { type: 'STRING' }, whatCourtHeard: { type: 'STRING' },
              verdict: { type: 'STRING' }, courtOrderedMove: { type: 'STRING' },
              safetyState: { type: 'STRING' },
            },
          },
        },
      })
      await recordAIUsage(supabase, {
        userId: session.initiator_id, feature: 'bunny_court', promptVersion: 'court-v2',
        result: ai, latencyMs: Date.now() - startedAt, refId: session.id,
      })
      const parsed = parseAIJson(ai.text)
      await saveVerdict(supabase, session, content.definition, ruleTemplate, 'single_pass_ai', ai.model, {
        outcomeKey: ruleTemplate.outcome_key,
        headline: String(parsed.headline || ruleTemplate.headline).slice(0, 100),
        whatCourtHeard: String(parsed.whatCourtHeard || ruleTemplate.what_court_heard).slice(0, 500),
        verdict: String(parsed.verdict || ruleTemplate.verdict).slice(0, 500),
        courtOrderedMove: String(parsed.courtOrderedMove || ruleTemplate.court_ordered_move).slice(0, 300),
        // Share copy is always the reviewed static template. Model output may
        // interpret private testimony for the paired verdict, but it can never
        // place either person's raw words into the system share sheet.
        shareText: ruleTemplate.share_text.slice(0, 240),
        safetyState: parsed.safetyState === 'safety_redirect' ? 'safety_redirect' : 'safe',
      })
    }
    await supabase.from('court_verdict_jobs').update({
      status: 'complete', locked_at: null, last_error: null, updated_at: new Date().toISOString(),
    }).eq('session_id', sessionId)
    return true
  } catch (error) {
    const attempts = Number(job.attempts || 0) + 1
    if (attempts >= 3) {
      try {
        const { data: failedSession } = await supabase.from('court_sessions').select('*').eq('id', sessionId).maybeSingle()
        const fallbackContent = failedSession ? await loadCourtSessionContent(supabase, failedSession) : null
        const { data: fallbackSubmissions } = failedSession
          ? await supabase.from('court_submissions').select('user_id,answers').eq('session_id', sessionId)
          : { data: null }
        if (failedSession?.status === 'processing' && fallbackContent && fallbackSubmissions?.length === 2) {
          await generateRuleVerdict(supabase, failedSession, fallbackContent, fallbackSubmissions, 'ai_failure_template')
          await supabase.from('court_verdict_jobs').update({
            status: 'complete', attempts, locked_at: null,
            last_error: `AI fallback after: ${String(error?.message || error).slice(0, 420)}`,
            updated_at: new Date().toISOString(),
          }).eq('session_id', sessionId)
          return true
        }
      } catch (fallbackError) {
        console.warn('[court] terminal fallback failed:', fallbackError?.message || fallbackError)
      }
    }
    await supabase.from('court_verdict_jobs').update({
      status: attempts >= 3 ? 'failed' : 'retry', attempts, locked_at: null,
      next_attempt_at: new Date(Date.now() + Math.min(15 * 60_000, 2 ** attempts * 60_000)).toISOString(),
      last_error: String(error?.message || error).slice(0, 500), updated_at: new Date().toISOString(),
    }).eq('session_id', sessionId)
    throw error
  }
}

export async function sessionView(supabase, session, viewerId) {
  if (!session || (session.initiator_id !== viewerId && session.partner_id !== viewerId)) return null
  let resolved = session
  if (new Date(session.expires_at) < new Date() && EXPIRABLE_STATUSES.includes(session.status)) {
    const now = new Date().toISOString()
    await supabase.from('court_sessions').update({ status: 'expired', updated_at: now }).eq('id', session.id).in('status', EXPIRABLE_STATUSES)
    resolved = { ...session, status: 'expired', updated_at: now }
  }
  const liveContentRequest = resolved.content_snapshot?.definition
    ? Promise.resolve({ data: null })
    : supabase.from('court_case_definitions').select('case_id,category,title,card_subtitle,engine,access_tier,notification_copy').eq('case_id', resolved.case_id).maybeSingle()
  const [{ data: liveContent }, { data: submissions }, { data: verdict }] = await Promise.all([
    liveContentRequest,
    supabase.from('court_submissions').select('user_id,submitted_at,answers').eq('session_id', resolved.id),
    supabase.from('court_verdicts').select('outcome_key,headline,what_court_heard,verdict,court_ordered_move,share_text,safety_state,created_at').eq('session_id', resolved.id).maybeSingle(),
  ])
  const content = resolved.content_snapshot?.definition || liveContent
  const mine = submissions?.find((item) => item.user_id === viewerId)
  const other = submissions?.find((item) => item.user_id !== viewerId)
  const answersVisible = Boolean(mine?.answers?.__share_answers && other?.answers?.__share_answers)
  const questions = Array.isArray(resolved.content_snapshot?.questions) ? resolved.content_snapshot.questions : []
  const otherRole = other?.user_id === resolved.initiator_id ? 'initiator' : 'partner'
  const otherAnswers = answersVisible ? questions.flatMap((question) => {
    const rawValue = other?.answers?.[question.question_number]
    if (rawValue == null || rawValue === '' || (Array.isArray(rawValue) && rawValue.length === 0)) return []
    const optionLabel = (value) => question.options?.find((option) => option.value === value)?.label || value
    const value = Array.isArray(rawValue) ? rawValue.map(optionLabel) : optionLabel(rawValue)
    const prompt = otherRole === 'partner' && question.other_player_prompt
      && !/^same question/i.test(question.other_player_prompt) ? question.other_player_prompt : question.prompt
    return [{ questionNumber: question.question_number, prompt, value }]
  }) : []
  return {
    id: resolved.id, status: resolved.status, case: content,
    role: viewerId === resolved.initiator_id ? 'initiator' : 'partner',
    hasSubmitted: Boolean(mine), otherSubmitted: Boolean(other), expiresAt: resolved.expires_at,
    createdAt: resolved.created_at,
    answersShareAllowed: Boolean(mine?.answers?.__share_answers), answersVisible, otherAnswers,
    verdict: verdict ? {
      outcomeKey: verdict.outcome_key, headline: verdict.headline, whatCourtHeard: verdict.what_court_heard,
      verdict: verdict.verdict, courtOrderedMove: verdict.court_ordered_move, shareText: verdict.share_text,
      safetyState: verdict.safety_state, createdAt: verdict.created_at,
    } : null,
  }
}

export { EXPIRABLE_STATUSES, LOVE_RELATIONSHIPS }
