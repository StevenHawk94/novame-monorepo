import { randomUUID } from 'expo-crypto';
import { ApiError } from '@novame/api-client';
import { apiClient } from './api';
import { withDeadline } from './async-lifecycle';
import { sessionEpoch } from './session-lifecycle';

export interface GameQuestion { self: string; partner: string; options: string[] }
export interface GameSummary { id: string; category: string; categoryId: string; number: number; title: string; hook: string; spicy: string; questionCount: number }
export interface GameSessionSummary { id: string; gameId: string; createdAt: string; completedAt: string | null; ownCount: number; guessCount: number; partnerOwnCount: number; partnerGuessCount: number }
export interface GameOverview { paired: boolean; categories: string[]; games: GameSummary[]; ownedIds: string[]; availableIds: string[]; sessions: GameSessionSummary[] }
export interface GameSession { id: string; gameId: string; questions: GameQuestion[]; completedAt: string | null; ownAnswers: number[]; guesses: number[]; partnerOwnCount: number; partnerGuessCount: number; partnerOwnAnswers: number[] | null; partnerGuesses: number[] | null; notifyReady: boolean; result: { mine: number; partner: number; outcome: 'win'|'lose'|'tie' } | null }

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
  return checked(apiClient.get<GameOverview & { error?: string }>('/api/vnext/game-room?mode=overview'));
}
export function gameSession(sessionId: string) {
  return checked(apiClient.get<GameSession & { error?: string }>(`/api/vnext/game-room?mode=session&id=${encodeURIComponent(sessionId)}`));
}
export function unlockGame(gameId: string) {
  return checked(apiClient.post<{ error?: string; charged?: boolean }>('/api/vnext/game-room', { action: 'unlock', gameId, key: randomUUID() }));
}
export function startGame(gameId: string) {
  return checked(apiClient.post<{ error?: string; sessionId: string }>('/api/vnext/game-room', { action: 'start', gameId }));
}
export function answerGame(sessionId: string, phase: 'own'|'guess', index: number, choice: number) {
  return checked(apiClient.post<{ error?: string }>('/api/vnext/game-room', { action: 'answer', sessionId, phase, index, choice }));
}
export function notifyGame(sessionId: string, enabled: boolean) {
  return checked(apiClient.post<{ error?: string }>('/api/vnext/game-room', { action: 'notify', sessionId, enabled }));
}
