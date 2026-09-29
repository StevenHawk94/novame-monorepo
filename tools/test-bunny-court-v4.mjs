import assert from 'node:assert/strict'
import { resolveCourtOutcomeV4 } from '../apps/api/src/lib/bunny-court-rules-v4.mjs'

const q = (dimension, count = 5, number = 1) => ({ question_number: number, analysis_dimension: dimension, options: Array.from({ length: count }, (_, index) => ({ value: `q${number}_o${index + 1}` })) })
const answer = (number, index) => ({ [number]: `q${number}_o${index + 1}` })
const definition = (engine, variant = null) => ({ analysis_logic: JSON.stringify({ engine, variant, positionQuestionNumber: 1, satisfactionQuestionNumber: 2, categoryQuestionNumber: 1, weightQuestionNumber: 2 }) })

const comparison = [q('comparison_vote')]
assert.equal(resolveCourtOutcomeV4(definition('comparison'), comparison, answer(1, 0), answer(1, 2)).outcomeKey, 'consensus_a')
assert.equal(resolveCourtOutcomeV4(definition('comparison'), comparison, answer(1, 0), answer(1, 0)).outcomeKey, 'self_claim_clash')
assert.equal(resolveCourtOutcomeV4(definition('comparison'), comparison, answer(1, 4), answer(1, 2)).outcomeKey, 'partial_overlap')

const spectrum = [q('position'), q('satisfaction', 4, 2)]
assert.equal(resolveCourtOutcomeV4(definition('spectrum', 'intensity'), spectrum, { ...answer(1, 0), ...answer(2, 0) }, { ...answer(1, 1), ...answer(2, 0) }).outcomeKey, 'small_gap_both_content')
assert.equal(resolveCourtOutcomeV4(definition('spectrum', 'intensity'), spectrum, { ...answer(1, 0), ...answer(2, 1) }, { ...answer(1, 4), ...answer(2, 0) }).outcomeKey, 'large_gap_split')
assert.equal(resolveCourtOutcomeV4(definition('spectrum', 'dual_pole'), spectrum, { ...answer(1, 0), ...answer(2, 1) }, { ...answer(1, 0), ...answer(2, 1) }).outcomeKey, 'double_martyr')

const category = [q('category', 4), q('weight', 4, 2)]
assert.equal(resolveCourtOutcomeV4(definition('category'), category, { ...answer(1, 1), ...answer(2, 0) }, { ...answer(1, 1), ...answer(2, 0) }).outcomeKey, 'fun_overlap')
assert.equal(resolveCourtOutcomeV4(definition('category'), category, { ...answer(1, 0), ...answer(2, 2) }, { ...answer(1, 2), ...answer(2, 1) }).outcomeKey, 'making_room_for_both')

console.log('Bunny Court v4 rule tests passed.')
