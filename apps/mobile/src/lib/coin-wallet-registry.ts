import {useSyncExternalStore} from 'react';
export type WalletAnchor={x:number;y:number;width:number;height:number};
export type WalletSlot={owner:object;anchor:WalletAnchor;fontSize:number;onPress:()=>void;disabled:boolean;showAdd?:boolean};
const slots=new Map<object,WalletSlot>(),portals:object[]=[],listeners=new Set<()=>void>();
let state:{slot:WalletSlot|null;portal:object|null}={slot:null,portal:null};
const emit=()=>{state={slot:[...slots.values()].at(-1)??null,portal:portals.at(-1)??null};listeners.forEach(fn=>fn());};
export function registerCoinWallet(slot:WalletSlot){slots.set(slot.owner,slot);emit();return()=>{if(slots.delete(slot.owner))emit();};}
export function claimCoinWalletPortal(owner:object){portals.push(owner);emit();return()=>{const i=portals.indexOf(owner);if(i>=0){portals.splice(i,1);emit();}};}
export const getCoinWalletRegistry=()=>state;
export const useCoinWalletRegistry=()=>useSyncExternalStore(fn=>(listeners.add(fn),()=>{listeners.delete(fn);}),getCoinWalletRegistry,getCoinWalletRegistry);
