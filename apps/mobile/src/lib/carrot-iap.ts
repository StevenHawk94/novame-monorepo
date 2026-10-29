import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import { requestPurchase,finishTransaction,ErrorCode,type Purchase,type ExpoPurchaseError } from 'expo-iap';
import { supabase } from './supabase';
import { apiClient } from './api';
import { refreshBurrowAfterCurrent,burrowClock } from './burrow-store';
import { sessionEpoch,subscribeSessionIdentity } from './session-lifecycle';
import { syncCoinWallet } from './coin-reward-store';
import type { CoinWallet,CoinWalletState } from './coin-reward-ledger';

import { CARROT_PRODUCTS } from './coin-store-prices';
export { CARROT_PRODUCTS } from './coin-store-prices';
export const isCarrotProduct = (id?:string) => CARROT_PRODUCTS.some(product=>product===id);
type Status = 'idle'|'purchasing'|'pending'|'unconfirmed'|'failed'|'success';
type State = {busy:boolean;message:string|null;status:Status};
let state:State={busy:false,message:null,status:'idle'};
let owner:string|null=null;
let activeProduct:string|null=null;
let operation=0;
let subscriptionBusy=()=>false;
type PurchaseReadiness={available:boolean;environment?:string;wallet?:string;reason?:string};
const READINESS_FRESH_MS=30_000;
let readinessCache:{epoch:number;at:number;value:PurchaseReadiness}|null=null;
let readinessFlight:{epoch:number;promise:Promise<PurchaseReadiness>}|null=null;
function clearReadiness(){readinessCache=null;readinessFlight=null;}
function loadPurchaseReadiness(force=false):Promise<PurchaseReadiness>{
  const epoch=sessionEpoch();
  if(readinessFlight?.epoch===epoch)return readinessFlight.promise;
  if(!force&&readinessCache?.epoch===epoch&&Date.now()-readinessCache.at<READINESS_FRESH_MS)
    return Promise.resolve(readinessCache.value);
  readinessCache=null;
  const flight={epoch,promise:null as unknown as Promise<PurchaseReadiness>};
  flight.promise=apiClient.get<PurchaseReadiness>(`/api/vnext/coins/verify?platform=${Platform.OS}`).then(value=>{
    // Only a recent, authenticated success is reusable; never persist this gate
    // or publish a response from an old account / superseded request.
    if(readinessFlight===flight&&sessionEpoch()===epoch&&value.available)
      readinessCache={epoch,at:Date.now(),value};
    return value;
  }).finally(()=>{if(readinessFlight===flight)readinessFlight=null;});
  readinessFlight=flight;
  return flight.promise;
}
/** Warm while the shop opens, not after the user taps a priced pack. */
export function prewarmCarrotPurchase(force=false):void{
  if(!['ios','android'].includes(Platform.OS))return;
  void loadPurchaseReadiness(force).catch(()=>{/* Checkout retries and surfaces actionable failures. */});
}
// Inject the owner check from the existing IAP listener without a circular import.
export function setSubscriptionPurchaseGuard(check:()=>boolean) {subscriptionBusy=check;}
let timeout:ReturnType<typeof setTimeout>|null=null;
const listeners=new Set<()=>void>();
function publish(patch:Partial<State>) {state={...state,...patch};listeners.forEach(fn=>{try{fn();}catch(error){console.warn('[coins] observer failed:',error);}});}
function finish(message:string|null,status:Status='idle') {operation++;if(timeout)clearTimeout(timeout);timeout=null;owner=null;activeProduct=null;clearReadiness();publish({busy:false,message,status});}
function finishCurrent(epoch:number,attempt:number,message:string|null,status:Status='idle') {
  if(epoch===sessionEpoch()&&attempt===operation)finish(message,status);
}
const cancelled=(error:unknown)=>!!error&&typeof error==='object'&&'code' in error&&error.code===ErrorCode.UserCancelled;
function storeFailure(error:unknown):{message:string;status:Status}{
  const code=error&&typeof error==='object'&&'code' in error?error.code:null;
  if(code===ErrorCode.Pending||code===ErrorCode.DeferredPayment)return{
    message:'Payment is pending approval. Coins will arrive after the store confirms it.',status:'pending'};
  const rejected=[ErrorCode.ItemUnavailable,ErrorCode.SkuNotFound,ErrorCode.BillingUnavailable,
    ErrorCode.IapNotAvailable,ErrorCode.DeveloperError,ErrorCode.UserError].filter(Boolean);
  if(code&&rejected.includes(code as ErrorCode))return{
    message:'The store could not start this purchase. Please try again.',status:'failed'};
  return{message:'Your payment is not confirmed yet. Check pending purchases to retry safely; you will not be credited twice.',status:'unconfirmed'};
}
subscribeSessionIdentity(()=>finish(null));
export const coinPurchaseBusy=()=>state.busy;
export const useCarrotPurchase=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};},()=>state,()=>state);
export async function purchaseCarrots(productId:string) {
  if(subscriptionBusy())throw new Error('Please finish your subscription purchase first.');
  if(state.busy||!isCarrotProduct(productId))throw new Error('A purchase is already in progress.');
  const epoch=sessionEpoch();
  const attempt=++operation;
  activeProduct=productId;
  // Own checkout before any async work so two screens cannot both preflight.
  publish({busy:true,message:null,status:'purchasing'});
  const startedAt=Date.now();
  let dispatched=false;
  try {
    const [ready,{data}]=await Promise.all([loadPurchaseReadiness(),supabase.auth.getSession()]);
    if(epoch!==sessionEpoch()||attempt!==operation)throw new Error('Your account changed. Please reopen the shop.');
    if(ready.reason==='sandbox_account_conflict')throw new Error('This account contains test coins. Use a separate live account for real purchases.');
    if(ready.reason==='production_account_conflict')throw new Error('This account has live purchases. Use a separate test account for sandbox testing.');
    if(!ready.available)throw new Error('Coin purchases are temporarily unavailable. Please try again later.');
    if(subscriptionBusy())throw new Error('Please finish your subscription purchase first.');
    publish({message:ready.environment==='sandbox'&&ready.wallet!=='room'
      ?'Sandbox testing: this purchase credits a separate test balance, not Home coins.':'Waiting for the store…'});
    const user=data.session?.user.id;
    if(epoch!==sessionEpoch()||attempt!==operation)throw new Error('Your account changed. Please reopen the shop.');
    if(!user)throw new Error('We couldn’t reconnect to your account. Please try again.');
    owner=user;
    const account=await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,`novame:${user}`);
    if(epoch!==sessionEpoch()||attempt!==operation)throw new Error('Your account changed. Please reopen the shop.');
    timeout=setTimeout(()=>finishCurrent(epoch,attempt,'Still waiting for the store. Use Check pending purchases before trying again.','unconfirmed'),120000);
    if(typeof __DEV__!=='undefined'&&__DEV__)console.info('[coins] Native payment requested',{
      platform:Platform.OS,preparationMs:Date.now()-startedAt,
    });
    dispatched=true;
    await requestPurchase({type:'in-app',request:{apple:{sku:productId,quantity:1,appAccountToken:user,andDangerouslyFinishTransactionAutomatically:false},google:{skus:[productId],obfuscatedAccountId:account,obfuscatedProfileId:user}}});
  } catch(error) {
    // Listener may already have completed/cancelled this exact attempt.
    if(epoch!==sessionEpoch()||attempt!==operation){if(dispatched)return;throw error;}
    if(cancelled(error)){finishCurrent(epoch,attempt,null);return;}
    if(dispatched){const failure=storeFailure(error);finishCurrent(epoch,attempt,failure.message,failure.status);return;}
    finishCurrent(epoch,attempt,'Couldn’t start this purchase. Please try again.','failed');throw error;
  }
}
export function handleCarrotError(error:ExpoPurchaseError) {
  // A subscription error must reach the subscription listener, even while a
  // coin request is waiting. A replay for another SKU cannot clear this checkout.
  if(error.productId&&!isCarrotProduct(error.productId))return false;
  if(!isCarrotProduct(error.productId)&&!state.busy)return false;
  if(!state.busy)return true;
  if(error.productId&&activeProduct&&error.productId!==activeProduct)return true;
  if(error.code===ErrorCode.UserCancelled)finish(null);
  else {const failure=storeFailure(error);finish(failure.message,failure.status);}
  return true;
}
const flights=new Map<string,Promise<boolean>>();
export async function handleCarrotPurchase(purchase:Purchase):Promise<boolean> {
  if(!isCarrotProduct(purchase.productId))return false;
  const epoch=sessionEpoch(),attempt=operation;
  const update=(message:string,status:Status='unconfirmed')=>{if(!activeProduct||activeProduct===purchase.productId)finishCurrent(epoch,attempt,message,status);};
  if(purchase.purchaseState==='pending'){update('Payment is pending approval. Coins will arrive after the store confirms it.','pending');return false;}
  const credential=purchase.purchaseToken;
  if(!credential){update('The store receipt is unavailable. Please check pending purchases.');return false;}
  const key=`${epoch}:${Platform.OS}:${credential}`;
  const running=flights.get(key);if(running)return running;
  const task=(async()=>{
    const {data}=await supabase.auth.getSession();const user=data.session?.user.id;
    if(epoch!==sessionEpoch()||!user||(owner&&owner!==user))return false;
    const result=await apiClient.post<{success:boolean;error?:string;environment?:string;wallet?:string;balance?:number;roomWallet?:CoinWallet;coinState?:CoinWalletState}>('/api/vnext/coins/verify',{platform:Platform.OS,productId:purchase.productId,purchaseToken:credential});
    if(!result.success||result.error)throw new Error('Receipt verification is pending.');
    const creditedAt=burrowClock();
    const roomCredit=result.environment!=='sandbox'||result.wallet==='room';
    if(roomCredit&&epoch===sessionEpoch()&&(result.coinState?.wallet||result.roomWallet)) {
      try{syncCoinWallet(result.coinState?.wallet??result.roomWallet!,result.coinState,creditedAt);}
      catch(error){console.warn('[coins] credited wallet application needs refresh:',error);}
    }
    // Google consumption happens on the server AFTER credit. Apple must finish
    // only after that same durable credit; failures remain recoverable on launch.
    if(epoch===sessionEpoch()){
      if(result.environment==='sandbox'&&result.wallet!=='room')update(`Sandbox purchase verified. Test balance: ${Number(result.balance??0).toLocaleString()} coins. Room balance unchanged.`,'success');
      else{
        update('Coins added to your balance.','success');
        // Supplementary reads cannot delay checkout success or turn a committed
        // credit into a payment failure. The receipt already updates Home.
        void refreshBurrowAfterCurrent({silent:true,after:creditedAt}).catch(()=>{});
      }
    }
    // Receipt committed: acknowledge independently, never downgrade success.
    // A failed finish remains in StoreKit for the next idempotent recovery.
    if(Platform.OS==='ios'){
      try{await finishTransaction({purchase,isConsumable:true});}
      catch(error){console.warn('[coins] credited transaction finish pending:',error);}
    }
    return true;
  })().catch(()=>{update('Your payment is not confirmed yet. Check pending purchases to retry safely; you will not be credited twice.');return false;}).finally(()=>flights.delete(key));
  flights.set(key,task);return task;
}
