export function scoreGameRoomRound(state) {
  if (!state?.completedAt || !Array.isArray(state.partnerOwnAnswers)
      || !Array.isArray(state.partnerGuesses) || !Array.isArray(state.ownAnswers)
      || !Array.isArray(state.guesses) || [state.partnerOwnAnswers,state.partnerGuesses,state.ownAnswers,state.guesses].some(a => a.length !== 6)) return null
  const mine = state.guesses.reduce((score, choice, index) => score + Number(choice === state.partnerOwnAnswers[index]), 0)
  const partner = state.partnerGuesses.reduce((score, choice, index) => score + Number(choice === state.ownAnswers[index]), 0)
  return { mine, partner, outcome: mine > partner ? 'win' : mine < partner ? 'lose' : 'tie' }
}
