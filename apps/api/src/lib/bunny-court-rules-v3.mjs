function pair(first, second, number) {
  return [first?.[number], second?.[number]]
}

function every(values, allowed) {
  return values.every((value) => allowed.includes(value))
}

function either(values, allowed) {
  return values.some((value) => allowed.includes(value))
}

function same(values) {
  return values[0] != null && values[0] === values[1]
}

function matrixOutcome(definition, first, second) {
  const keys = definition.outcome_keys || []
  const q = (number) => pair(first, second, number)
  const A = keys[0]; const B = keys[1] || A; const C = keys[2] || B
  const rules = {
    'LOVE-04': [() => either(q(2), ['C']), () => every(q(2), ['A']) && !either(q(3), ['D'])],
    'LOVE-05': [() => either(q(2), ['D']), () => every(q(2), ['A','B']) && !either(q(3), ['D'])],
    'LOVE-06': [() => either(q(3), ['C']) && !either(q(3), ['D']), () => same(q(1)) && !either(q(3), ['B','C'])],
    'LOVE-07': [() => either(q(3), ['B']), () => every(q(1), ['A','B']) && every(q(3), ['A','D'])],
    'LOVE-09': [() => either(q(3), ['C']) || (every(q(1), ['A','B']) && !same(q(1))), () => every(q(1), ['B']) && every(q(3), ['A'])],
    'LOVE-10': [() => either(q(2), ['C']), () => every(q(2), ['A','B'])],
    'LOVE-11': [() => either(q(3), ['B']) && same(q(1)), () => every(q(1), ['C']) && !either(q(3), ['A','B'])],
    'LOVE-12': [() => either(q(2), ['C']) && either(q(2), ['A','B']), () => every(q(1), ['A','B']) && every(q(2), ['A','B'])],
    'LOVE-15': [() => either(q(1), ['D']) || either(q(2), ['D']), () => every(q(1), ['A']) && every(q(2), ['A','B'])],
    'LOVE-16': [() => either(q(2), ['C','D']) || either(q(3), ['D']), () => every(q(1), ['A']) && every(q(2), ['A']) && every(q(3), ['A'])],
    'LOVE-17': [() => either(q(2), ['D']) || either(q(3), ['D']), () => every(q(1), ['A','B']) && every(q(2), ['A']) && every(q(3), ['A'])],
    'LOVE-18': [() => either(q(1), ['D']) || either(q(2), ['D']), () => every(q(1), ['A','B']) && every(q(2), ['A','B'])],
    'LOVE-19': [() => either(q(2), ['C']) && !same(q(3)), () => same(q(1)) && every(q(2), ['A'])],
    'LOVE-21': [() => either(q(1), ['D']) || either(q(3), ['D']), () => every(q(1), ['A','B']) && same(q(3))],
    'LOVE-22': [() => !same(q(1)) && either(q(3), ['B','C']), () => same(q(1)) && every(q(3), ['A'])],
    'LIFE-02': [() => every(q(1), ['A']) || every(q(1), ['B']) || (either(q(2), ['D']) && !every(q(1), ['C'])), () => every(q(1), ['C']) && same(q(3))],
    'LIFE-03': [() => either(q(3), ['C']) || (!same(q(1)) && either(q(1), ['A','D'])), () => every(q(1), ['C']) && same(q(2))],
    'LIFE-04': [() => every(q(1), ['A']) || every(q(1), ['B']) || either(q(2), ['D']), () => every(q(1), ['C']) && same(q(3))],
    'LIFE-06': [() => !same(q(1)) && !same(q(2)), () => every(q(1), ['C','D']) && every(q(2), ['C']) && same(q(3))],
    'LIFE-08': [() => either(q(1), ['D']), () => every(q(1), ['C']) && every(q(2), ['C']) && same(q(3))],
    'LIFE-10': [() => either(q(2), ['D']) && !same(q(1)), () => same(q(1)) && every(q(3), ['A','D'])],
    'LIFE-13': [() => every(q(1), ['C','D']) || (either(q(1), ['C']) && either(q(2), ['D'])), () => every(q(1), ['A','B']) && !same(q(2))],
    'LIFE-14': [() => either(q(2), ['D']), () => every(q(1), ['C','D']) || same(q(3))],
    'LIFE-15': [() => either(q(1), ['C']) || either(q(2), ['D']), () => every(q(1), ['A','B']) && every(q(2), ['A','B'])],
    'LIFE-16': [() => either(q(1), ['D']) || every(q(2), ['B']), () => every(q(1), ['A']) && every(q(2), ['C'])],
    'LIFE-17': [() => (every(q(1), ['A','B']) && !same(q(1))) || either(q(2), ['D']), () => every(q(1), ['C']) && !same(q(2))],
    'LIFE-18': [() => either(q(1), ['D']) || (!same(q(1)) && either(q(2), ['D'])), () => every(q(1), ['C']) && same(q(3))],
    'MIDDLE-01': [() => (either(q(1), ['D']) && either(q(2), ['C','D'])) || either(q(3), ['D']), () => every(q(1), ['A','C']) && every(q(2), ['A'])],
    'MIDDLE-02': [() => (either(q(1), ['D']) && either(q(2), ['C','D'])) || either(q(3), ['D']), () => every(q(1), ['A','B']) && every(q(2), ['A'])],
    'MIDDLE-03': [() => either(q(1), ['D']) || either(q(2), ['B','C','D']), () => every(q(1), ['A','B']) && !either(q(2), ['B','C','D'])],
    'MIDDLE-04': [() => either(q(2), ['D']) || every(q(2), ['B','C']), () => same(q(1)) && every(q(2), ['A'])],
    'MIDDLE-06': [() => either(q(1), ['C','D']) && either(q(2), ['C','D']), () => every(q(1), ['A','B']) && every(q(2), ['A'])],
    'MIDDLE-07': [() => either(q(2), ['D']) || !same(q(1)), () => same(q(1)) && every(q(2), ['A','B'])],
    'MIDDLE-09': [() => (either(q(1), ['D']) && either(q(2), ['C','D'])) || either(q(3), ['D']), () => every(q(1), ['A']) && every(q(2), ['A'])],
    'MIDDLE-10': [() => either(q(1), ['D']), () => every(q(1), ['A']) && every(q(2), ['A','D'])],
    'MIDDLE-11': [() => either(q(3), ['D']) || (either(q(3), ['C']) && either(q(1), ['B','D'])), () => every(q(3), ['A']) && every(q(2), ['A'])],
    'MIDDLE-13': [() => either(q(2), ['D']), () => every(q(2), ['A','C']) && every(q(3), ['C'])],
    'MIDDLE-14': [() => (either(q(1), ['C']) || either(q(2), ['D'])) && either(q(3), ['C','D']), () => every(q(2), ['A','B']) && !either(q(3), ['C','D'])],
    'MIDDLE-15': [() => either(q(3), ['C','D']), () => every(q(1), ['A','B']) && every(q(2), ['A']) && every(q(3), ['A','B'])],
    'MIDDLE-16': [() => every(q(1), ['C','D']) || either(q(2), ['C','D']), () => every(q(1), ['A']) && every(q(2), ['A','B'])],
    'MIDDLE-18': [() => either(q(1), ['D']) || either(q(3), ['D']), () => every(q(1), ['A','B']) && !either(q(3), ['D'])],
  }
  const rule = rules[definition.case_id]
  if (!rule) return null
  if (rule[0]()) return C
  if (rule[1]()) return A
  return B
}

function spectrumOutcome(definition, questions, first, second) {
  let config = definition.analysis_logic
  if (typeof config === 'string') {
    try { config = JSON.parse(config) } catch { config = {} }
  }
  const highMin = Number(config?.highMin ?? 3)
  const lowMax = Number(config?.lowMax ?? -3)
  const score = (answers) => questions.reduce((total, question) => {
    if (question.response_type === 'Short text') return total
    const raw = answers?.[question.question_number]
    const values = Array.isArray(raw) ? raw : [raw]
    return total + values.reduce((sum, value) => sum + Number(String(value || '').split(':').at(-1) || 0), 0)
  }, 0)
  const bucket = (value) => value >= highMin ? 0 : value <= lowMax ? 2 : 1
  const a = bucket(score(first)); const b = bucket(score(second))
  const low = Math.min(a, b); const high = Math.max(a, b)
  const templateIndex = [[0, 1, 2], [1, 3, 4], [2, 4, 5]][low][high]
  return definition.outcome_keys?.[templateIndex] || definition.outcome_keys?.[0] || null
}

export function fixedLaunchOutcomeV3(definition, questions, first, second) {
  if (definition.engine === 'SPECTRUM_V3') return spectrumOutcome(definition, questions, first, second)
  if (definition.engine === 'MATRIX_V3') return matrixOutcome(definition, first, second)
  return null
}
