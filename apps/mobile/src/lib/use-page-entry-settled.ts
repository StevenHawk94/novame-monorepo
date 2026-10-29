import {useLayoutEffect,useState} from 'react';
import {Platform} from 'react-native';
import {useIsFocused,useNavigation} from '@react-navigation/native';

type TransitionNavigation={
  isFocused():boolean;
  addListener(event:'transitionStart'|'transitionEnd'|'gestureCancel',listener:(event:{data?:{closing?:boolean}})=>void):()=>void;
};

/** Observe at the route boundary, even while its content/data is unavailable.
 * Idle JS is not proof a native card has appeared: the native start callback
 * can arrive later. The editor remains tappable while auto-focus waits for
 * the real appearance event. This never locks navigation or user input. */
export function usePageEntrySettled(enabled:boolean){
  const navigation=useNavigation() as unknown as TransitionNavigation,focused=useIsFocused();
  const [settled,setSettled]=useState(false);
  useLayoutEffect(()=>{
    if(!enabled||Platform.OS==='web')return;
    const start=navigation.addListener('transitionStart',()=>setSettled(false));
    const end=navigation.addListener('transitionEnd',event=>{
      if(!event.data?.closing&&navigation.isFocused())setSettled(true);
    });
    const cancel=navigation.addListener('gestureCancel',()=>{if(navigation.isFocused())setSettled(true);});
    return()=>{start();end();cancel();};
  },[navigation,enabled]);
  useLayoutEffect(()=>{if(!focused)setSettled(false);},[focused]);
  return !enabled||Platform.OS==='web'||(focused&&settled);
}
