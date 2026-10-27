import { router, type Href } from 'expo-router';

let handoffSequence = 0;
/** The native child owns this pop. The retained destination must not also slide. */
export function dismissToRetainedTab(pathname: string) {
  router.dismissTo({ pathname, params: { __tabHandoff: `${Date.now()}:${++handoffSequence}` } } as Href);
}
