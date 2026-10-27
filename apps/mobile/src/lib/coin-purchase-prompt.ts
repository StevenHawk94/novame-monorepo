import type { ReactNode } from 'react';
import { registerOverlay } from './overlay-presence';
import { sessionEpoch, subscribeSessionIdentity } from './session-lifecycle';

export type CoinPurchaseOffer = { name: string; price: number; artwork: ReactNode; description?: string };
type Prompt = CoinPurchaseOffer & { id: number };
type State = { prompt: Prompt | null; toast: string | null; toastId: number };
let state: State = { prompt: null, toast: null, toastId: 0 };
const listeners = new Set<() => void>();
let sequence = 0;
let pending: { owner: object; valid: () => boolean; resolve: (confirmed: boolean) => void; release: () => void } | null = null;
let releaseSuccess: (() => void) | undefined;
const publish = (next: State) => { state = next; listeners.forEach(listener => listener()); };
export const coinPurchaseSnapshot = () => state;
export const subscribeCoinPurchase = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Asking never spends coins. Exactly one current prompt can authorize a call. */
export function requestCoinPurchase(owner: object, offer: CoinPurchaseOffer, valid: () => boolean): Promise<boolean> {
  if (pending || !valid() || !Number.isSafeInteger(offer.price) || offer.price < 0) return Promise.resolve(false);
  const epoch = sessionEpoch();
  return new Promise(resolve => {
    // Reserve immediately, before the host commits, so automatic prompts wait.
    pending = { owner, valid: () => epoch === sessionEpoch() && valid(), resolve, release: registerOverlay(owner) };
    publish({ ...state, prompt: { ...offer, id: ++sequence } });
  });
}
export function settleCoinPurchase(id: number, confirmed: boolean) {
  if (!pending || state.prompt?.id !== id) return;
  const ticket = pending;
  const accepted = confirmed && ticket.valid();
  pending = null;
  publish({ ...state, prompt: null });
  ticket.release();
  ticket.resolve(accepted);
}
export function cancelCoinPurchase(owner?: object) {
  if (pending && (!owner || pending.owner === owner)) settleCoinPurchase(state.prompt!.id, false);
}
export function showCoinPurchaseSuccess(name: string) {
  showCoinPurchaseNotice(`Purchased ${name}!`);
}
export function showCoinPurchaseNotice(message: string) {
  // The toast remains touch-through, but automatic store reviews wait until
  // the user has seen the purchase acknowledgement in full.
  releaseSuccess ??= registerOverlay({});
  publish({ ...state, toast: message, toastId: state.toastId + 1 });
}
export function clearCoinPurchaseToast(id: number) {
  if (id === state.toastId) { publish({ ...state, toast: null }); releaseSuccess?.(); releaseSuccess = undefined; }
}
subscribeSessionIdentity(() => {
  cancelCoinPurchase();
  publish({ prompt: null, toast: null, toastId: state.toastId + 1 });
  releaseSuccess?.(); releaseSuccess = undefined;
});
