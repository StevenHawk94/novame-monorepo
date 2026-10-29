// Build-time JSON import, not an API request. Metro embeds the complete
// versioned catalogue (including all questions) in the installed app bundle.
// Sharing the canonical source prevents mobile/server question order drift.
import catalog from '../../../api/src/data/burrow-game-room-v1.json';
import type { GameOverview, GameSession, GameSummary } from './burrow-game-room-api';
import { compareShopOffers } from './shop-offer-order';

export const GAME_ROOM_CONTENT_VERSION = catalog.version;
export const GAME_ROOM_CATEGORIES = catalog.categories;
export const GAME_ROOM_GAMES: GameSummary[] = catalog.games.map(({ questions, ...game }) => ({
  ...game, title: game.title.replace(/\s+[^\x00-\x7F].*$/u, '').trim(), questionCount: questions.length,
}));
const byId = new Map(catalog.games.map(game => [game.id, game]));

/** Sort the resolved offers, never ownership or the user's membership badge.
 * Keep editorial order for equal prices and never mutate the catalogue. */
export function gameRailItems(games: readonly GameSummary[]): GameSummary[] {
  return games.filter(game => game.active !== false).sort(compareShopOffers);
}

/** User state is remote; every visible catalogue string is always local. */
export function localGameOverview(state?: Partial<GameOverview> | null): GameOverview {
  return {
    paired: state?.paired ?? false,
    ownedIds: state?.ownedIds ?? [], availableIds: state?.availableIds ?? [], sessions: state?.sessions ?? [],
    products: state?.products,
    completion: state?.completion,
    lastRounds: state?.lastRounds,
    categories: GAME_ROOM_CATEGORIES, games: state?.products ? GAME_ROOM_GAMES.map(game => ({...game,
      ...(state.products?.[game.id]??{active:false}),
    })) : GAME_ROOM_GAMES,
  };
}

export function localGameSession(state: Omit<GameSession, 'questions'> & { questions?: GameSession['questions'] }): GameSession {
  const game = byId.get(state.gameId);
  if (!game) throw new Error('game_content_update_required');
  // Old servers still return questions. Never silently reinterpret a historic
  // round using a different locally bundled question/options order.
  if (state.questions && (!Array.isArray(state.questions) || state.questions.length !== game.questions.length
    || state.questions.some((question, index) => {
      const local = game.questions[index];
      return question.self !== local.self || question.partner !== local.partner
        || !Array.isArray(question.options) || question.options.length !== local.options.length
        || question.options.some((option, i) => option !== local.options[i]);
    }))) {
    throw new Error('game_content_update_required');
  }
  return { ...state, questions: game.questions };
}
