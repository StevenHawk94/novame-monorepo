import {useEffect,useRef,useState} from 'react';
import {useIsFocused} from '@react-navigation/native';
import {router} from 'expo-router';
import {PairingConnectedPage} from './partner-pairing-ui';
import {readPartnerConnection} from '@/lib/partner-pairing';
import {getBurrowSnapshot,refreshBurrowAfterCurrent} from '@/lib/burrow-store';
import {sessionEpoch} from '@/lib/session-lifecycle';
import {registerOverlay} from '@/lib/overlay-presence';
import { View, Text } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';

/** Also rendered inside the invitation route, so success never exposes Home. */
export function PartnerConnectedScreen(){
  const receipt=readPartnerConnection(),leaving=useRef(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const mounted=useRef(true),focused=useIsFocused(),active=useRef(focused);active.current=focused;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>registerOverlay({}),[]);
  const close=()=>{if(router.canGoBack())router.back();else router.replace('/(main)/(tabs)');};
  async function continueToRoom(){
    if(leaving.current||!receipt)return;leaving.current=true;setBusy(true);setError(null);
    const epoch=sessionEpoch();
    if(getBurrowSnapshot().data?.partner?.id!==receipt.partner.userId)try{await refreshBurrowAfterCurrent({silent:true});}catch{}
    if(epoch!==sessionEpoch()||readPartnerConnection()!==receipt||!mounted.current||!active.current)return;
    if(getBurrowSnapshot().data?.partner?.id===receipt.partner.userId){close();return;}
    leaving.current=false;setBusy(false);setError('Your connection is saved. Reconnect to update your burrow, then continue.');
  }
  if(!receipt)return <View style={{flex:1,backgroundColor:'#572B1A',alignItems:'center',justifyContent:'center',gap:20}}><Text style={{color:'#FFF9EF'}}>Return to your burrow to view your current connection.</Text><Pressable onPress={close}><Text style={{color:'#FFF9EF'}}>Back to Home</Text></Pressable></View>;
  return <PairingConnectedPage partner={receipt.partner} self={receipt.self} onContinue={()=>void continueToRoom()} busy={busy} error={error}/>;
}
