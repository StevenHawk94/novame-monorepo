const owners = new Set<object>();
const listeners = new Set<() => void>();
export const privateAudioFocused = () => owners.size > 0;
export function subscribePrivateAudioFocus(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
/** The existing Surprise/private-message focus contract, shared with quiet
 * effect players without importing or mounting the Music presentation. */
export function acquirePrivateAudioFocus() {
  const owner = {};
  const publish = () => { for (const fn of listeners) try { fn(); } catch {} };
  owners.add(owner); publish();
  let released = false;
  return () => { if (!released) { released = true; owners.delete(owner); publish(); } };
}
