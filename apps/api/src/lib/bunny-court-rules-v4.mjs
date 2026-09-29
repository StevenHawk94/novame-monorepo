function parseConfig(definition) {
  try {
    return typeof definition.analysis_logic === 'string'
      ? JSON.parse(definition.analysis_logic)
      : (definition.analysis_logic || {})
  } catch { return {} }
}

function questionFor(questions, dimension, fallbackNumber) {
  return questions.find((question) => question.analysis_dimension === dimension)
    || questions.find((question) => question.question_number === fallbackNumber)
}

function indexOfAnswer(question, answers) {
  if (!question) return 0
  return Math.max(0, (question.options || []).findIndex((option) => option.value === answers?.[question.question_number]))
}

function comparisonVote(question, answers, partner) {
  const index = indexOfAnswer(question, answers)
  if (index >= 4) return 'both'
  const self = index <= 1
  if (partner) return self ? 'b' : 'a'
  return self ? 'a' : 'b'
}

export function resolveCourtOutcomeV4(definition, questions, first, second) {
  const config = parseConfig(definition)
  if (config.engine === 'comparison') {
    const question = questionFor(questions, 'comparison_vote', 1)
    const a = comparisonVote(question, first, false)
    const b = comparisonVote(question, second, true)
    if (a === 'both' && b === 'both') return { outcomeKey: 'consensus_both', swapRoles: false }
    if (a === 'both' || b === 'both') return { outcomeKey: 'partial_overlap', swapRoles: a === 'both' }
    if (a === b) return { outcomeKey: a === 'a' ? 'consensus_a' : 'consensus_b', swapRoles: false }
    if (a === 'a' && b === 'b') return { outcomeKey: 'self_claim_clash', swapRoles: false }
    return { outcomeKey: 'mutual_deflection', swapRoles: false }
  }

  if (config.engine === 'category') {
    const category = questionFor(questions, 'category', config.categoryQuestionNumber || 1)
    const weight = questionFor(questions, 'weight', config.weightQuestionNumber || 2)
    const same = first?.[category?.question_number] === second?.[category?.question_number]
    const heavy = Math.max(indexOfAnswer(weight, first), indexOfAnswer(weight, second)) > 0
    return { outcomeKey: same ? (heavy ? 'same_territory' : 'fun_overlap') : (heavy ? 'making_room_for_both' : 'two_different_facts'), swapRoles: false }
  }

  const position = questionFor(questions, 'position', config.positionQuestionNumber || 1)
  const satisfaction = questionFor(questions, 'satisfaction', config.satisfactionQuestionNumber)
  const rawA = indexOfAnswer(position, first)
  const rawB = indexOfAnswer(position, second)
  const discontentA = indexOfAnswer(satisfaction, first) > 0
  const discontentB = indexOfAnswer(satisfaction, second) > 0

  if (config.variant === 'dual_pole') {
    const sharedA = rawA
    const sharedB = 4 - rawB
    if (rawA <= 1 && rawB <= 1) return { outcomeKey: 'double_martyr', swapRoles: false }
    if (rawA >= 3 && rawB >= 3) return { outcomeKey: 'mutual_crediting', swapRoles: false }
    if (sharedA <= 1 && sharedB <= 1) return { outcomeKey: 'a_carries_more', swapRoles: false }
    if (sharedA >= 3 && sharedB >= 3) return { outcomeKey: 'b_carries_more', swapRoles: false }
    if (Math.abs(sharedA - sharedB) <= 1 && Math.abs(sharedA - 2) <= 1 && Math.abs(sharedB - 2) <= 1) {
      return { outcomeKey: 'genuinely_balanced', swapRoles: false }
    }
    return { outcomeKey: 'lopsided_one_notices', swapRoles: !discontentA && discontentB }
  }

  const gap = Math.abs(rawA - rawB)
  const prefix = gap <= 1 ? 'small_gap' : 'large_gap'
  const satisfactionState = !discontentA && !discontentB ? 'both_content'
    : discontentA && discontentB ? 'both_discontent' : 'split'
  const swapForSplit = satisfactionState === 'split' && !discontentA && discontentB
  const swapForLargeGap = gap >= 2 && rawB > rawA
  return { outcomeKey: `${prefix}_${satisfactionState}`, swapRoles: swapForSplit || swapForLargeGap }
}
