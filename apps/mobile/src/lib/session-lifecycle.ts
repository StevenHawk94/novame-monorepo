let owner: string | null | undefined;
let epoch = 0;
const listeners = new Set<() => void>();

/** A refresh/re-authentication is not a new user. Never clear same-UUID data. */
export function observeSessionIdentity(userId: string | null): boolean {
  const unchanged = owner !== undefined && owner === userId;
  if (!unchanged) {
    owner = userId;
    epoch += 1;
    listeners.forEach(fn => fn());
  }
  return unchanged;
}
export const sessionEpoch = () => epoch;
export function subscribeSessionIdentity(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
