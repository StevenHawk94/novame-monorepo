import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import { fetchProducts,requestPurchase,finishTransaction,ErrorCode,type Purchase,type ExpoPurchaseError } from 'expo-iap';
import { supabase } from './supabase';
import { apiClient } from './api';
import { refreshBurrow } from './burrow-store';
import { sessionEpoch,subscribeSessionIdentity } from './session-lifecycle';

export const CARROT_PRODUCTS = ['burrow.coin.200','burrow.coin.400','burrow.coin.1000'] as const;
export const isCarrotProduct = (id?:string) => CARROT_PRODUCTS.some(product=>product===id);
type State = {busy:boolean;message:string|null};
let state:State={busy:false,message:null};
let owner:string|null=null;
let activeProduct:string|null=null;
let operation=0;
let subscriptionBusy=()=>false;
// Inject the owner check from the existing IAP listener without a circular import.
export function setSubscriptionPurchaseGuard(check:()=>boolean) {subscriptionBusy=check;}
let timeout:ReturnType<typeof setTimeout>|null=null;
const listeners=new Set<()=>void>();
function publish(patch:Partial<State>) {state={...state,...patch};listeners.forEach(fn=>fn());}
function finish(message:string|null) {operation++;if(timeout)clearTimeout(timeout);timeout=null;owner=null;activeProduct=null;publish({busy:false,message});}
function finishCurrent(epoch:number,attempt:number,message:string|null) {
  if(epoch===sessionEpoch()&&attempt===operation)finish(message);
}
subscribeSessionIdentity(()=>finish(null));
export const coinPurchaseBusy=()=>state.busy;
export const useCarrotPurchase=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};},()=>state,()=>state);
export async function fetchCarrotProducts() {
  if(!['ios','android'].includes(Platform.OS))return [];
  const ready=await apiClient.get<{available:boolean}>(`/api/vnext/coins/verify?platform=${Platform.OS}`);
  if(!ready.available)throw new Error('Carrot purchases are not enabled on this server yet.');
  return (await fetchProducts({skus:[...CARROT_PRODUCTS],type:'in-app'}))??[];
}
export async function purchaseCarrots(productId:string) {
  if(subscriptionBusy())throw new Error('Please finish your subscription purchase first.');
  if(state.busy||!isCarrotProduct(productId))throw new Error('A purchase is already in progress.');
  const epoch=sessionEpoch();
  const ready=await apiClient.get<{available:boolean}>(`/api/vnext/coins/verify?platform=${Platform.OS}`);
  if(!ready.available)throw new Error('Carrot purchases are not enabled on this server yet.');
  if(subscriptionBusy())throw new Error('Please finish your subscription purchase first.');
  if(state.busy)throw new Error('A purchase is already in progress.');
  if(epoch!==sessionEpoch())throw new Error('Your account changed. Please reopen the shop.');
  const attempt=++operation;
  activeProduct=productId;
  publish({busy:true,message:'Waiting for the store…'});
  try {
    const {data}=await supabase.auth.getSession();
    const user=data.session?.user.id;
    if(epoch!==sessionEpoch()||attempt!==operation)throw new Error('Your account changed. Please reopen the shop.');
    if(!user)throw new Error('Please sign in before purchasing carrots.');
    owner=user;
    const account=await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,`novame:${user}`);
    if(epoch!==sessionEpoch()||attempt!==operation)throw new Error('Your account changed. Please reopen the shop.');
    timeout=setTimeout(()=>finishCurrent(epoch,attempt,'Still waiting for the store. Use Check pending purchases before trying again.'),120000);
    await requestPurchase({type:'in-app',request:{apple:{sku:productId,quantity:1,appAccountToken:user,andDangerouslyFinishTransactionAutomatically:false},google:{skus:[productId],obfuscatedAccountId:account,obfuscatedProfileId:user}}});
  } catch(error) {finishCurrent(epoch,attempt,'Purchase did not finish. Check pending purchases before retrying.');throw error;}
}
export function handleCarrotError(error:ExpoPurchaseError) {
  // A subscription error must reach the subscription listener, even while a
  // coin request is waiting. A replay for another SKU cannot clear this checkout.
  if(error.productId&&!isCarrotProduct(error.productId))return false;
  if(!isCarrotProduct(error.productId)&&!state.busy)return false;
  if(error.productId&&activeProduct&&error.productId!==activeProduct)return true;
  finish(error.code===ErrorCode.UserCancelled?'Purchase cancelled.':'The store could not finish. Check pending purchases to recover an unfinished payment.');
  return true;
}
const flights=new Map<string,Promise<boolean>>();
export async function handleCarrotPurchase(purchase:Purchase):Promise<boolean> {
  if(!isCarrotProduct(purchase.productId))return false;
  const epoch=sessionEpoch(),attempt=operation;
  const update=(message:string)=>{if(!activeProduct||activeProduct===purchase.productId)finishCurrent(epoch,attempt,message);};
  if(purchase.purchaseState==='pending'){update('Payment is pending approval. Carrots will arrive after the store confirms it.');return false;}
  const credential=purchase.purchaseToken;
  if(!credential){update('The store receipt is unavailable. Please check pending purchases.');return false;}
  const key=`${epoch}:${Platform.OS}:${credential}`;
  const running=flights.get(key);if(running)return running;
  const task=(async()=>{
    const {data}=await supabase.auth.getSession();const user=data.session?.user.id;
    if(epoch!==sessionEpoch()||!user||(owner&&owner!==user))return false;
    const result=await apiClient.post<{success:boolean;error?:string}>('/api/vnext/coins/verify',{platform:Platform.OS,productId:purchase.productId,purchaseToken:credential});
    if(!result.success||result.error)throw new Error('Receipt verification is pending.');
    // Google consumption happens on the server AFTER credit. Apple must finish
    // only after that same durable credit; failures remain recoverable on launch.
    if(Platform.OS==='ios')await finishTransaction({purchase,isConsumable:true});
    const current=await supabase.auth.getSession();
    if(epoch===sessionEpoch()&&current.data.session?.user.id===user){update('Your payment has been processed. Balance refreshed.');await refreshBurrow();}
    return true;
  })().catch(()=>{update('Your payment is not confirmed yet. Check pending purchases to retry safely; you will not be credited twice.');return false;}).finally(()=>flights.delete(key));
  flights.set(key,task);return task;
}
