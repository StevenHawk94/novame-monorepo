import type {GameOverview,GameSessionSummary,GameSummary} from './burrow-game-room-api';

export type GameCardState = {kind:'plus';price:number} | {kind:'locked';price:number} |
  {kind:'unlocked';mineFinished:boolean;partnerFinished:boolean;round:GameSessionSummary|null};
const newest = (rows:GameSessionSummary[]) => rows.reduce<GameSessionSummary|null>((latest,row)=>
  !latest || row.createdAt>latest.createdAt || row.createdAt===latest.createdAt&&row.id>latest.id ? row : latest,null);
/** A replay never erases the completed round on a permanent catalogue card. */
export function gameCardState(game:GameSummary,overview:GameOverview,hasPlus:boolean):GameCardState {
  if(game.plus_only&&!hasPlus)return {kind:'plus',price:game.price??150};
  // Free offers use the playable-card UI before their first shared receipt.
  // Entry still checks pairing, Plus and the current server quote separately.
  if(game.price!==0&&!overview.availableIds.includes(game.id))return {kind:'locked',price:game.price??150};
  const rounds=overview.sessions.filter(row=>row.gameId===game.id);
  const savedRound=overview.lastRounds?.[game.id];
  if(savedRound&&!rounds.some(row=>row.id===savedRound.id))rounds.push(savedRound);
  const completed=newest(rounds.filter(row=>!!row.completedAt));
  const round=completed??newest(rounds);
  const saved=overview.completion?.[game.id];
  return {kind:'unlocked',round,mineFinished:!!saved?.mineFinished||!!completed||!!round&&round.ownCount===6&&round.guessCount===6,
    partnerFinished:!!saved?.partnerFinished||!!completed||!!round&&round.partnerOwnCount===6&&round.partnerGuessCount===6};
}
