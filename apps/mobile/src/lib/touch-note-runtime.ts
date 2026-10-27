import {requireOptionalNativeModule} from 'expo';
import {getInteractionPreferences} from './interaction-preferences';
import {haptics} from './haptics';
export type TouchCapabilities={availableBytes:number;lowMemory:boolean;hasVibrator:boolean;systemHaptics:'enabled'|'disabled'|'unknown'};
const native=requireOptionalNativeModule<{capabilities:()=>Promise<TouchCapabilities>}>('TouchRuntime');
let verifiedUser:string|undefined;
export const touchVibrationVerified=(user:string|undefined)=>!!user&&verifiedUser===user;
export const confirmTouchVibration=(user:string|undefined)=>{verifiedUser=user;};
export async function touchCapabilities():Promise<TouchCapabilities|null>{try{return native?await native.capabilities():null;}catch{return null;}}
export function touchInitialQuality(value:TouchCapabilities|null,reduced=false):'full'|'standard'{
 return !reduced&&value&&!value.lowMemory&&Number.isFinite(value.availableBytes)&&value.availableBytes>=96*1024*1024?'full':'standard';
}
export async function testTouchVibration(){
 if(!getInteractionPreferences().haptics)return false;
 return haptics.touchPulse();
}
