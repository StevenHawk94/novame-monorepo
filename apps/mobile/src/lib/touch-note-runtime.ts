import {requireOptionalNativeModule} from 'expo';
import {getInteractionPreferences} from './interaction-preferences';
import {haptics} from './haptics';
import {Platform} from 'react-native';
import {storage} from './storage';
import {kTouchVibrationVerified} from '../shared/storage/keys';
export type TouchCapabilities={availableBytes:number;lowMemory:boolean;hasVibrator:boolean;systemHaptics:'enabled'|'disabled'|'unknown'};
const native=requireOptionalNativeModule<{capabilities:()=>Promise<TouchCapabilities>}>('TouchRuntime');
export const touchVibrationVerified=(user:string|undefined)=>{try{return !!user&&storage.getString(kTouchVibrationVerified.name)===user;}catch{return false;}};
export const confirmTouchVibration=(user:string|undefined)=>{if(user)storage.set(kTouchVibrationVerified.name,user);};
export const touchVisualOnly=(value:TouchCapabilities|null)=>Platform.OS==='ios'&&Platform.isPad||value?.hasVibrator===false;
export async function touchCapabilities():Promise<TouchCapabilities|null>{try{return native?await native.capabilities():null;}catch{return null;}}
export function touchInitialQuality(value:TouchCapabilities|null,reduced=false):'full'|'standard'{
 return !reduced&&value&&!value.lowMemory&&Number.isFinite(value.availableBytes)&&value.availableBytes>=96*1024*1024?'full':'standard';
}
export async function testTouchVibration(){
 if(!getInteractionPreferences().haptics)return false;
 return haptics.touchPulse();
}
