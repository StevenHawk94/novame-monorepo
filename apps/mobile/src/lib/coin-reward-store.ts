import { useSyncExternalStore } from 'react';
import { sessionEpoch, sessionUserId, subscribeSessionIdentity } from './session-lifecycle';
import { CoinRewardLedger, type CoinWallet, type CoinWalletState } from './coin-reward-ledger';
import { coinArrivalTiming } from './burrow-motion';

export type CoinRewardPoint = { x: number; y: number };
export type CoinRewardBatch = { id: number; earned: number; from: number; revision: number; celebration: number; origin?: CoinRewardPoint;
  flight: { id: number; startedAt: number; origin?: CoinRewardPoint } };
type State = { balance: number | null; displayBalance: number | null; batch: CoinRewardBatch | null };
type Ticket = { id: string; key: string | null; predicted: number; epoch: number; batchId: number | null; duplicate: boolean; deferred: boolean; origin?: CoinRewardPoint };
export type CoinResponse = {
  coinState?: CoinWalletState;
  coinReward?: { key: string; amount: number };
  reward?: unknown;
  carrotsAwarded?: number;
  applied?: boolean;
};
let ledger = new CoinRewardLedger();
let state: State = { balance: null, displayBalance: null, batch: null };
let serial = 0;
let foreground = true;
let reconcile = () => {};
export function setCoinRewardReconciler(refresh: () => void) { reconcile = refresh; }
const listeners = new Set<() => void>();
const deliveries = new Map<string, { key:string|null; amount: number; from: number | null; confirmed: boolean; released: boolean; batchId?:number; origin?: CoinRewardPoint }>();
let nextOrigin: { point: CoinRewardPoint; at: number } | null = null;
/** Capture a claim's screen location once, never measure during a flight. */
export function setNextCoinRewardOrigin(point: CoinRewardPoint) {
  nextOrigin = Number.isFinite(point.x) && Number.isFinite(point.y) ? { point, at: coinRewardClock() } : null;
}
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
function publish(batch = state.batch) {
  const balance = ledger.balance;
  const displayBalance=visibleBalance();
  // Receipts can advance the confirmed wallet without changing the projected
  // balance. Notify durable-wallet listeners, but keep React's snapshot stable.
  if (state.balance !== balance || state.displayBalance!==displayBalance || state.batch !== batch) state = { balance, displayBalance, batch };
  listeners.forEach(fn => {try{fn();}catch{console.warn('[wallet/observer]','notification_failed');}});
}
export const getCoinRewardSnapshot = () => state;
export const subscribeCoinWallet = subscribe;
export const getConfirmedCoinWallet = () => ledger.wallet ? {
  wallet: ledger.wallet,
  coinState: ledger.context?.wallet.version === ledger.wallet.version && ledger.context.wallet.balance === ledger.wallet.balance
    ? ledger.context : undefined,
} : null;
export const useCoinRewards = () => useSyncExternalStore(subscribe, getCoinRewardSnapshot, getCoinRewardSnapshot);
const noCoinSubscription=()=>()=>{};
export const useCoinBalance = (active=true) => useSyncExternalStore(active?subscribe:noCoinSubscription, () => active?state.balance:null, () => null);
export const useCoinRewardBusy = () => useSyncExternalStore(subscribe, () => !!state.batch, () => !!state.batch);
export const coinRewardIncluded=(key:string)=>ledger.has(key);
export const coinRewardClock = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
subscribeSessionIdentity(() => { ledger = new CoinRewardLedger(); deliveries.clear(); nextOrigin = null; publish(null); });

/** A true snapshot is the only source of authority. Never persist projections. */
export function syncCoinWallet(wallet: CoinWallet, coinState?: CoinWalletState, startedAt = coinRewardClock()) {
  if (coinState) ledger.sync(coinState);
  else ledger.syncLegacy(wallet, startedAt);
  publish();
}
/** Durable send queues own these keys. Never turn a projected debit into a
 * reward, persist a fake wallet, or replay a money animation on reconciliation. */
export function projectCoinSpend(key:string,amount:number){ledger.projectSpend(key,amount);publish();}
export function settleCoinSpend(key:string,wallet?:CoinWallet,coinState?:CoinWalletState){
  ledger.settleSpend(key,wallet);
  if(wallet)syncCoinWallet(wallet,coinState);
  publish();
  if(!wallet&&ledger.wallet)reconcile();
}
export function rejectCoinSpend(key:string){ledger.rejectSpend(key);publish();if(ledger.wallet)reconcile();}
function visibleBalance(){
  return ledger.visibleBalance(deliveries);
}
function announce(amount: number, from: number | null, origin?: CoinRewardPoint) {
  if (!foreground || amount <= 0 || from === null) return;
  const batch = state.batch;
  const now = coinRewardClock(), celebration = (batch?.celebration ?? 0) + 1;
  // Rapid claims form one bounded stream, not a new particle tree per tap.
  // Never remove/restart coins already in the air. The task card still responds
  // to every tap; another flight starts only after this one has landed.
  const flight = batch && now - batch.flight.startedAt < coinArrivalTiming(0).flightEnd
    ? batch.flight : { id: celebration, startedAt: now, origin };
  publish(batch ? { ...batch, earned: batch.earned + amount, revision: batch.revision + 1, celebration, origin, flight }
    : { id: ++serial, earned: amount, from, revision: 1, celebration, origin, flight });
}
export function finishCoinRewardBatch(id: number, revision: number) {
  if (state.batch?.id === id && state.batch.revision === revision) publish(null);
}
/** Backgrounding discards presentation, not in-flight monetary operations. */
export function hideCoinRewardBanner() { publish(null); }
export function setCoinRewardForeground(active: boolean) {
  foreground = active;
  if (!active) { nextOrigin = null; hideCoinRewardBanner(); }
}

function localDay() {
  const context = ledger.context;
  if (!context) return null;
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: context.timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date()).reduce((parts, part) => { parts[part.type] = part.value; return parts; }, {} as Record<string, string>);
  } catch { return null; }
}
export function dailyCoinRewardKey(prefix: string) {
  const parts = localDay();
  return parts ? `${prefix}:${parts.year}-${parts.month}-${parts.day}` : null;
}
export function beginCoinReward(id: string, key: string | null, amount: number, deferred = false, quiet = false): Ticket {
  const origin = nextOrigin && coinRewardClock() - nextOrigin.at < 2000 ? nextOrigin.point : undefined;
  nextOrigin = null;
  const from = visibleBalance();
  const duplicate = ledger.presented.has(id) || (!!key && ledger.has(key));
  const predicted = !duplicate && key ? ledger.begin(id, key, amount) : 0;
  if(quiet&&!duplicate)ledger.presented.add(id);
  if (deferred && !duplicate) deliveries.set(id, { key, amount: predicted, from, confirmed: false, released: false, origin });
  if (predicted) { ledger.presented.add(id); if (!deferred&&!quiet) announce(predicted, from, origin); else publish(); }
  return { id, key, predicted, duplicate, epoch: sessionEpoch(), batchId: predicted && !deferred ? state.batch?.id ?? null : null, deferred, origin };
}
export function releaseCoinReward(id: string, quiet = false) {
  const delivery = deliveries.get(id);
  if (!delivery) return;
  if(delivery.released)return;
  const from=visibleBalance();
  delivery.released = true;
  // The scene owns the celebration beat, not the network. A later receipt
  // reconciles this SAME operation; it must never replay its celebration.
  ledger.presented.add(id);
  if(!quiet)announce(delivery.amount,from,delivery.origin);
  delivery.batchId=state.batch?.id;
  publish();
  if(delivery.confirmed)deliveries.delete(id);
}
export function settleCoinReward(ticket: Ticket, response: CoinResponse) {
  if (ticket.epoch !== sessionEpoch()) return;
  if (ticket.duplicate) { if (response.coinState) ledger.sync(response.coinState); publish(); return; }
  const from = ledger.balance;
  const amount = Math.max(0, Number(response.coinReward?.amount ?? response.reward ?? response.carrotsAwarded ?? 0) || 0);
  const key = response.coinReward?.key ?? ticket.key ?? ticket.id;
  // Replays can return delta=0 after a timed-out success. The included receipt
  // confirms the original projection without adding another visual reward.
  const replayAmount = response.applied === false
    ? response.coinState?.credits.find(credit => credit.key === key)?.amount : undefined;
  const actual = ticket.predicted && replayAmount !== undefined ? replayAmount : amount;
  if (key !== ticket.key) ledger.pending.delete(ticket.id);
  if (ticket.key || !response.coinState) ledger.settle(ticket.id, key, actual, coinRewardClock());
  if (response.coinState) ledger.sync(response.coinState);
  let batch = state.batch;
  if (ticket.predicted && batch?.id === (deliveries.get(ticket.id)?.batchId??ticket.batchId) && actual !== ticket.predicted) {
    batch = { ...batch, earned: Math.max(0, batch.earned + actual - ticket.predicted), revision: batch.revision + 1 };
    if (!batch.earned) batch = null;
  }
  const delivery = deliveries.get(ticket.id);
  if (delivery) {
    delivery.amount = actual; delivery.confirmed = true;
    if(delivery.released)deliveries.delete(ticket.id);
    publish(batch);
    if(amount>0||ticket.predicted)reconcile();
    return;
  }
  publish(batch);
  if (amount > 0 || ticket.predicted) reconcile();
  if (!ticket.predicted && amount > 0 && !ledger.presented.has(ticket.id)) {
    ledger.presented.add(ticket.id); announce(amount, from ?? ledger.balance, ticket.origin);
  }
}
export function failCoinReward(ticket: Ticket, failure?:unknown) {
  if (ticket.epoch !== sessionEpoch() || ticket.duplicate) return;
  if(failure!==undefined&&!coinRewardDefinitelyRejected(failure)){reconcile();return;}
  ledger.fail(ticket.id, coinRewardClock());
  const deliveryBatchId=deliveries.get(ticket.id)?.batchId;
  deliveries.delete(ticket.id);
  ledger.presented.delete(ticket.id);
  let batch = state.batch;
  if (ticket.predicted && batch?.id === (deliveryBatchId??ticket.batchId)) {
    batch = { ...batch, earned: Math.max(0, batch.earned - ticket.predicted), revision: batch.revision + 1 };
    if (!batch.earned) batch = null;
  }
  publish(batch);
  if (ticket.predicted) reconcile();
}
export function coinRewardDefinitelyRejected(failure:unknown){
  const e=failure as {status?:number;body?:{error?:string};message?:string};
  const code=e?.body?.error??e?.message??'';
  return ['session_changed','pair_changed','day_changed','plus_required','daily_limit_reached','already_claimed','invalid_request',
    'not_found','visit_expired','visit_session_changed','idempotency_conflict','feature_disabled','content_unavailable','intent_not_saved',
    'not_completed','not_claimable','no_eligible_reward','reward_no_longer_eligible','already_done','already_completed','cooldown_active',
    'care_cooldown','already_full','not_paired','client_upgrade_required','journal_conflict','sharing_conflict','revision_conflict'].includes(code)
    ||!!(e?.status&&e.status>=400&&e.status<500&&![408,409,425,429].includes(e.status));
}
export function commandCoinReward(action: string, payload: Record<string, unknown>) {
  const plan=commandCoinRewardPlan(action,payload);
  return beginCoinReward(plan.id,plan.key,plan.amount,plan.deferred);
}
export function commandCoinRewardPlan(action:string,payload:Record<string,unknown>){
  const id = `${action}:${payload.assignmentId ?? (payload.questId ? `${payload.questId}:${payload.stage}` : payload.idempotencyKey ?? payload.visitId ?? payload.adventureId ?? '')}`;
  let key: string | null = null, amount = 0;
  if (action === 'claim_daily_quest') { key = `daily-quest:${payload.assignmentId}`; amount = 10; }
  if (action === 'claim_special_quest') { key = `special:${payload.questId}:${payload.stage}`; amount = 15; }
  // Actual Trivia rewards vary; wait for the authoritative settlement.
  if (action === 'respond_friend_visit_v2') key = `friend-visit:${payload.visitId}`;
  // No projected balance before Claim. A verified receipt starts the existing
  // top-right celebration, once for this adventure even after reconnect/replay.
  if (action === 'claim_adventure_treasure') key = `adventure-treasure:${payload.adventureId}`;
  if (action === 'complete_affection') { key = dailyCoinRewardKey('affection-first'); amount = 10; }
  if (action === 'refill_room_need' && payload.ownerId !== sessionUserId()) {
    key = dailyCoinRewardKey(`room-need-reward:${payload.need}`); amount = 5;
  }
  return {id,key,amount,deferred:action==='complete_affection'};
}
