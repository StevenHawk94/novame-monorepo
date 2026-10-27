import { randomUUID } from 'expo-crypto';
import { ApiError } from '@novame/api-client';
import { apiClient } from './api';
import { withDeadline } from './async-lifecycle';
import { sessionEpoch } from './session-lifecycle';
import { GAME_ROOM_CONTENT_VERSION, localGameOverview, localGameSession } from './burrow-game-room-content';
import { gameReads } from './game-read-coordinator';

export interface GameQuestion { self: string; partner: string; options: string[] }
export interface GameSummary { id: string; category: string; categoryId: string; number: number; title: string; hook: string; spicy: string; questionCount: number; price?: number; plus_only?: boolean; active?: boolean }
export interface GameSessionSummary { id: string; gameId: string; createdAt: string; completedAt: string | null; resultViewedAt?: string|null; ownCount: number; guessCount: number; partnerOwnCount: number; partnerGuessCount: number }
export interface GameCompletion { mineFinished: boolean; partnerFinished: boolean }
export interface GameOverview { paired: boolean; categories: string[]; games: GameSummary[]; products?: Record<string, {price:number;plus_only:boolean;active:boolean}>; ownedIds: string[]; availableIds: string[]; sessions: GameSessionSummary[]; completion?: Record<string,GameCompletion>; lastRounds?: Record<string,GameSessionSummary> }
export const GAME_UNLOCK_PRICE = 150;
export interface GameSession { id: string; gameId: string; questions: GameQuestion[]; completedAt: string | null; resultViewedAt?: string|null; ownAnswers: number[]; guesses: number[]; partnerOwnCount: number; partnerGuessCount: number; partnerOwnAnswers: number[] | null; partnerGuesses: number[] | null; notifyReady: boolean; result: { mine: number; partner: number; outcome: 'win'|'lose'|'tie' } | null }
export interface GameHistoryRound { id: string; gameId: string; createdAt: string; completedAt: string; resultViewedAt?: string|null; result: GameSession['result'] }
export interface GameHistoryPage { paired: boolean; rounds: GameHistoryRound[]; nextCursor: string | null }

function sharedRead<T>(key:string,work:()=>Promise<T>):Promise<T>{
  const epoch=sessionEpoch();
  return gameReads.read(`${epoch}:${key}`,async()=>{
    if(epoch!==sessionEpoch())throw Error('session_changed');
    const value=await work();
    if(epoch!==sessionEpoch())throw Error('session_changed');
    return value;
  }).then(value=>{
    // A recently shared receipt is still asynchronous; fence an identity
    // switch between cache lookup and its consumer's microtask too.
    if(epoch!==sessionEpoch())throw Error('session_changed');
    return value;
  });
}

async function checked<T extends { error?: string | null }>(promise: Promise<T>): Promise<T> {
  const epoch = sessionEpoch();
  let result: T;
  try { result = await withDeadline(promise, 20_000); }
  catch (error) {
    if (error instanceof ApiError && error.body && typeof error.body === 'object'
      && 'error' in error.body && typeof error.body.error === 'string') throw new Error(error.body.error);
    throw error;
  }
  if (epoch !== sessionEpoch()) throw new Error('session_changed');
  if (result.error) throw new Error(result.error);
  return result;
}

export function gameOverview() {
  return sharedRead('overview',()=>checked(apiClient.get<Partial<GameOverview> & { error?: string }>(
    `/api/vnext/game-room?mode=overview&content=local&catalogVersion=${GAME_ROOM_CONTENT_VERSION}`,
  )).then(localGameOverview));
}
export function gameSession(sessionId: string) {
  return sharedRead(`session:${sessionId}`,()=>checked(apiClient.get<Omit<GameSession, 'questions'> & { questions?: GameQuestion[]; error?: string }>(
    `/api/vnext/game-room?mode=session&id=${encodeURIComponent(sessionId)}&content=local&catalogVersion=${GAME_ROOM_CONTENT_VERSION}`,
  )).then(localGameSession));
}
export function gameHistory(cursor?: string | null) {
  return checked(apiClient.get<GameHistoryPage & { error?: string }>(
    `/api/vnext/game-room?mode=history${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
  ));
}
export function unlockGame(gameId: string, expectedPrice = GAME_UNLOCK_PRICE) {
  return checked(apiClient.post<{ error?: string; charged?: boolean }>('/api/vnext/game-room', { action: 'unlock', gameId, expectedPrice, key: randomUUID() }))
    .then(result=>{gameReads.invalidate();return result;});
}
export function startGame(gameId: string) {
  return checked(apiClient.post<{ error?: string; sessionId: string; session?: GameSession }>('/api/vnext/game-room', { action: 'start', gameId, content: 'local', catalogVersion: GAME_ROOM_CONTENT_VERSION }))
    .then(result => {gameReads.invalidate();return { ...result, session: result.session ? localGameSession(result.session) : undefined };});
}
export function answerGame(sessionId: string, phase: 'own'|'guess', index: number, choice: number) {
  return checked(apiClient.post<{ error?: string; session?: GameSession }>('/api/vnext/game-room', { action: 'answer', sessionId, phase, index, choice, content: 'local', catalogVersion: GAME_ROOM_CONTENT_VERSION }))
    .then(result => {gameReads.invalidate();return { ...result, session: result.session ? localGameSession(result.session) : undefined };});
}
export function notifyGame(sessionId: string, enabled: boolean) {
  return checked(apiClient.post<{ error?: string }>('/api/vnext/game-room', { action: 'notify', sessionId, enabled }));
}
export function nudgeGame(sessionId: string) {
  return checked(apiClient.post<{error?:string;alreadySent?:boolean;finished?:boolean}>('/api/vnext/game-room', {action:'nudge',sessionId}));
}
export function viewGameResult(sessionId:string) {
  return checked(apiClient.post<{error?:string;viewedAt:string}>('/api/vnext/game-room',{action:'view_result',sessionId}))
    .then(result=>{gameReads.invalidate();return result;});
}
/** One atomic delivery, after both local rounds. No answer-button HTTP request. */
export function submitGame(sessionId: string, ownAnswers: number[], guesses: number[],gameId?:string) {
  return checked(apiClient.post<{ error?: string; session: GameSession }>('/api/vnext/game-room', {
    action: 'submit', sessionId, ownAnswers, guesses, gameId, content: 'local', catalogVersion: GAME_ROOM_CONTENT_VERSION,
  })).then(result => {gameReads.invalidate();return { ...result, session: localGameSession(result.session) };});
}
