import {router} from 'expo-router';
import {getBurrowSnapshot} from './burrow-store';
import {sessionEpoch,sessionUserId,subscribeSessionIdentity} from './session-lifecycle';
import type {MajorUpdateBootstrap} from './app-major-update-api';
import type {PairingPerson} from '@/components/onboarding/partner-pairing-ui';

/** All shared-feature gates open the same native overlay; never stack duplicate prompts. */
export function showPartnerPairing(){receipt=null;router.navigate('/(main)/pair-partner');}
export function requirePartner(data:MajorUpdateBootstrap|null|undefined=getBurrowSnapshot().data){
  const snapshot=getBurrowSnapshot();
  // Retained screens/callbacks may still capture the old pair. The shared
  // invalidation barrier wins until a fresh bootstrap confirms authorization.
  if(!snapshot.pairInvalidated&&(snapshot.data??data)?.partner)return false;
  showPartnerPairing();return true;
}
type Receipt={ownerId:string;epoch:number;self:PairingPerson;partner:PairingPerson};
let receipt:Receipt|null=null;
subscribeSessionIdentity(()=>{receipt=null;});
export function rememberPartnerConnection(self:PairingPerson&{userId:string},partner:PairingPerson){
  if(self.userId!==sessionUserId())return false;
  receipt={ownerId:self.userId,epoch:sessionEpoch(),self,partner};return true;
}
export function readPartnerConnection(){return receipt&&receipt.ownerId===sessionUserId()&&receipt.epoch===sessionEpoch()?receipt:null;}
