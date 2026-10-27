let owner: string | null | undefined;
let epoch = 0;
const listeners = new Set<() => void>();

/** A refresh/re-authentication is not a new user. Never clear same-UUID data. */
export function observeSessionIdentity(userId: string | null): boolean {
  const unchanged = owner !== undefined && owner === userId;
  if (!unchanged) {
    owner = userId;
    epoch += 1;
    listeners.forEach(fn => {try{fn();}catch{console.warn('[session/observer]','reset_failed');}});
  }
  return unchanged;
}
export const sessionEpoch = () => epoch;
/** undefined until auth hydration; null after sign-out. Never infer an owner from disk. */
export const sessionUserId = () => owner;
export function subscribeSessionIdentity(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
