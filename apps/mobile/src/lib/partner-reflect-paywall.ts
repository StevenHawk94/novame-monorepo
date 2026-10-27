// Compatibility facade for old routes/imports. Partner records no longer
// enqueue, fetch, assign or present a paywall. Other paywall policies are separate.
import {storage} from './storage';
import {kPartnerReflectPaywallAssignment,kPartnerReflectPaywallQueue} from '@/shared/storage';
export type PartnerReflectPaywallAssignment={reflectId:string;variantId:string;variantKey:string;headline:string;subheadline:string;ctaHeading:string;benefits:string[]};
function clearLegacy(){try{storage.remove(kPartnerReflectPaywallQueue.name);storage.remove(kPartnerReflectPaywallAssignment.name);}catch{}}
clearLegacy();
export function requestPartnerReflectPaywall(_id:string){clearLegacy();}
export const peekPartnerReflectPaywall=():string|null=>null;
export function removePartnerReflectPaywall(_id:string){clearLegacy();}
export const subscribePartnerReflectPaywallRequest=(_listener:()=>void)=>()=>{};
export async function syncPartnerReflectPaywallRequests(){clearLegacy();}
export async function claimPartnerReflectPaywall(_id:string):Promise<{ok:boolean;eligible:boolean;assignment?:PartnerReflectPaywallAssignment}>{return{ok:true,eligible:false};}
export const getPartnerReflectPaywallAssignment=():PartnerReflectPaywallAssignment|null=>null;
export function clearPartnerReflectPaywallAssignment(){clearLegacy();}
export async function recordPartnerReflectPaywallClick(_assignment:PartnerReflectPaywallAssignment){}
