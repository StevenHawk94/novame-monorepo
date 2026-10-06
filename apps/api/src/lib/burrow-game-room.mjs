export function sameGameRoomQuestions(left, right) {
  // JSONB changes object-key ordering; compare semantics, preserving option order.
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length
    && left.every((question, index) => question?.self === right[index]?.self
      && question?.partner === right[index]?.partner && Array.isArray(question?.options)
      && Array.isArray(right[index]?.options) && question.options.length === right[index].options.length
      && question.options.every((option, i) => option === right[index].options[i]))
}

export function scoreGameRoomRound(state) {
  if (!state?.completedAt || !Array.isArray(state.partnerOwnAnswers)
      || !Array.isArray(state.partnerGuesses) || !Array.isArray(state.ownAnswers)
      || !Array.isArray(state.guesses) || [state.partnerOwnAnswers,state.partnerGuesses,state.ownAnswers,state.guesses].some(a => a.length !== 6)) return null
  const mine = state.guesses.reduce((score, choice, index) => score + Number(choice === state.partnerOwnAnswers[index]), 0)
  const partner = state.partnerGuesses.reduce((score, choice, index) => score + Number(choice === state.ownAnswers[index]), 0)
  return { mine, partner, outcome: mine > partner ? 'win' : mine < partner ? 'lose' : 'tie' }
}
