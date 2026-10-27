import type { NavigationAction, ParamListBase, TabNavigationState } from '@react-navigation/native';

/** Visual history only. TabRouter remains the owner of navigation/back state. */
export type RetainedTabState = {
  index: number;
  routes: readonly { key: string; name: string }[];
  history?: readonly { type: string; key?: string }[];
};

// Peer destinations have no back gesture. Rooms are cards above the last peer,
// even though TabRouter retains their data/React trees for instant revisits.
export const RETAINED_CARD_TABS = new Set(['burrow', 'shop', 'friends', 'collection', 'love']);
export const isRetainedTabRoot = (name: string) => name === 'index' || name === 'quests';
export const isRetainedTabCard = (name: string) => RETAINED_CARD_TABS.has(name);

export function retainedTabAction(state: RetainedTabState, action: NavigationAction): NavigationAction {
  const selected = state.routes[state.index];
  if (action.type === 'GO_BACK' && isRetainedTabCard(selected.name)
    && !(state.history ?? []).some(entry => entry.type === 'route' && entry.key !== selected.key))
    return { ...action, type: 'NAVIGATE', payload: { name: 'index' } };
  if (!['NAVIGATE', 'JUMP_TO', 'POP_TO', 'PRELOAD'].includes(action.type)) return action;
  const payload = action.payload as { name?: string } | undefined;
  if (!payload?.name) return action;
  const name = { court: 'index', status: 'index', bags: 'collection' }[payload.name] ?? payload.name;
  // dismissTo targeted at TabRouter must not bubble POP_TO into the native
  // parent and create/pop a second copy of the entire tabs navigator.
  return { ...action, type: action.type === 'POP_TO' ? 'NAVIGATE' : action.type, payload: { ...payload, name } };
}

export function retainedTabRoot(state: RetainedTabState) {
  const selected = state.routes[state.index];
  if (isRetainedTabRoot(selected.name)) return selected;
  const trail = (state.history ?? []).flatMap(entry => entry.type === 'route'
    ? state.routes.filter(route => route.key === entry.key && isRetainedTabRoot(route.name)) : []);
  return trail.at(-1) ?? state.routes.find(route => route.name === 'index');
}

export function retainedTabLayers(state: RetainedTabState): string[] {
  const valid = new Set(state.routes.map(route => route.key));
  const home = retainedTabRoot(state)?.key;
  const selected = state.routes[state.index].key;
  if (selected === home) return [selected];
  const history = (state.history ?? []).flatMap(entry =>
    entry.type === 'route' && entry.key && valid.has(entry.key) ? [entry.key] : []);
  // Even a direct link has a real Home underlay, never a copied scene/screenshot.
  return [...new Set([...(home ? [home] : []), ...history.filter(key => key !== home && key !== selected), selected])];
}

/** Explicit back buttons navigate to existing tabs; discard their forward trail. */
export function retainedTabHistory(previous: TabNavigationState<ParamListBase>, next: TabNavigationState<ParamListBase>): TabNavigationState<ParamListBase> {
  const selected = next.routes[next.index];
  if (isRetainedTabRoot(selected.name)) return { ...next, history: [{ type: 'route', key: selected.key }] };
  const at = previous.history?.findIndex(entry => entry.type === 'route' && entry.key === selected.key) ?? -1;
  return at < 0 ? next : { ...next, history: previous.history!.slice(0, at + 1) };
}

export function retainedTabDirection(previous: RetainedTabState, next: RetainedTabState): 'open' | 'close' | null {
  const from = previous.routes[previous.index].key;
  const to = next.routes[next.index].key;
  if (from === to) return null;
  const fromName = previous.routes[previous.index].name;
  const toName = next.routes[next.index].name;
  if (!isRetainedTabCard(fromName) && !isRetainedTabCard(toName)) return null;
  if (isRetainedTabRoot(toName)) return 'close';
  return retainedTabLayers(previous).includes(to) ? 'close' : 'open';
}

export function shouldExitRetainedTab(dx: number, vx: number, width: number): boolean {
  return dx > width * .28 || (dx > 10 && vx > .65);
}
