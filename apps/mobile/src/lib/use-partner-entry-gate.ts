import {useEffect,useRef} from 'react';
import {useIsFocused} from '@react-navigation/native';
import type {MajorUpdateBootstrap} from './app-major-update-api';
import {requirePartner} from './partner-pairing';
import {afterUiSettles} from './ui-idle';
import {sessionEpoch} from './session-lifecycle';

/** Open after this room is visible, once per real visit. Closing the child
 * prompt must not reopen it immediately or trap the user on the room. */
export function usePartnerEntryGate(data:MajorUpdateBootstrap|null|undefined,enabled=true){
  const focused=useIsFocused(),asked=useRef<string|null>(null),current=useRef(data);current.current=data;
  const returningFromPrompt=useRef(false);
  const scope=data?`${data.profile.id}:${data.pairVersion??'solo'}`:'';
  useEffect(()=>{
    if(data?.partner){asked.current=null;returningFromPrompt.current=false;return;}
    if(!focused){if(!returningFromPrompt.current)asked.current=null;return;}
    if(returningFromPrompt.current){returningFromPrompt.current=false;return;}
    if(!enabled||!focused||!data||data.partner||asked.current===scope)return;
    const epoch=sessionEpoch();
    return afterUiSettles(()=>{
      if(epoch!==sessionEpoch()||current.current?.profile.id!==data.profile.id||current.current.partner)return;
      asked.current=scope;returningFromPrompt.current=true;requirePartner(current.current);
    },{delayMs:240});
  },[enabled,focused,scope,!!data?.partner]);
}
