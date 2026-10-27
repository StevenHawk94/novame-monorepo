import {useEffect,useMemo,useRef} from 'react';
import {Pressable,ScrollView,StyleSheet,Text,View,type NativeScrollEvent,type NativeSyntheticEvent} from 'react-native';
import {ONBOARDING_CREAM,ONBOARDING_INK} from '@/lib/burrow-onboarding-design';
import {clampRelationshipDate,formatRelationshipDate,localRelationshipDate,relationshipDateParts,relationshipMonthDays,RELATIONSHIP_MONTHS} from '@/lib/onboarding-relationship-date';

const ROW=44;
function Wheel({label,values,index,onSelect,flex}:{label:string;values:string[];index:number;onSelect:(index:number)=>void;flex:number}){
  const scroll=useRef<ScrollView>(null),dragging=useRef(false),settle=useRef<ReturnType<typeof setTimeout>|null>(null),offset=useRef(index*ROW),active=useRef({values,index,onSelect});active.current={values,index,onSelect};
  const clear=()=>{if(settle.current!==null){clearTimeout(settle.current);settle.current=null;}};
  useEffect(()=>{if(!dragging.current)scroll.current?.scrollTo({y:index*ROW,animated:false});},[index,values.length]);
  useEffect(()=>()=>clear(),[]);
  function finish(){
    clear();dragging.current=false;
    const next=Math.max(0,Math.min(active.current.values.length-1,Math.round(offset.current/ROW)));
    scroll.current?.scrollTo({y:next*ROW,animated:true});
    if(next!==active.current.index)active.current.onSelect(next);
  }
  function record(event:NativeSyntheticEvent<NativeScrollEvent>){offset.current=event.nativeEvent.contentOffset.y;}
  function select(next:number){clear();dragging.current=false;onSelect(next);scroll.current?.scrollTo({y:next*ROW,animated:true});}
  return <View style={{flex,minWidth:0}}>
    <ScrollView ref={scroll} style={s.wheel} contentOffset={{x:0,y:index*ROW}} contentContainerStyle={{paddingVertical:ROW}} showsVerticalScrollIndicator={false} bounces={false} overScrollMode="never" snapToInterval={ROW} decelerationRate="fast" scrollEventThrottle={16}
      onScroll={record} onScrollBeginDrag={()=>{clear();dragging.current=true;}}
      onScrollEndDrag={event=>{record(event);clear();settle.current=setTimeout(finish,120);}}
      onMomentumScrollBegin={clear} onMomentumScrollEnd={event=>{record(event);finish();}}
      accessible accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{text:values[index]}} accessibilityActions={[{name:'increment'},{name:'decrement'}]} onAccessibilityAction={event=>select(Math.max(0,Math.min(values.length-1,index+(event.nativeEvent.actionName==='increment'?1:-1))))}>
      {values.map((value,i)=><Pressable key={value} accessibilityRole="button" accessibilityState={{selected:index===i}} accessibilityLabel={`${label}: ${value}`} onPress={()=>select(i)} style={s.row}><Text numberOfLines={1} adjustsFontSizeToFit style={[s.text,i===index&&s.selected]}>{value}</Text></Pressable>)}
    </ScrollView>
  </View>;
}
/** Same embedded month/day/year wheels on both platforms; no Android dialog hop. */
export function OnboardingDateWheel({value,onChange}:{value:string;onChange:(value:string)=>void}){
  const today=useMemo(()=>localRelationshipDate(),[]),date=relationshipDateParts(value,today);
  const monthCount=date.year===today.year?today.month:12;
  const dayCount=date.year===today.year&&date.month===today.month?today.day:relationshipMonthDays(date.year,date.month);
  const months=RELATIONSHIP_MONTHS.slice(0,monthCount),days=Array.from({length:dayCount},(_,i)=>String(i+1));
  const years=useMemo(()=>Array.from({length:today.year-1900+1},(_,i)=>String(1900+i)),[today.year]);
  function change(part:'year'|'month'|'day',number:number){onChange(formatRelationshipDate(clampRelationshipDate({...date,[part]:number},today)));}
  return <View style={s.card}>
    <View pointerEvents="none" style={s.highlight}/>
    <View style={s.columns}><Wheel label="Month" flex={1.8} values={months} index={date.month-1} onSelect={i=>change('month',i+1)}/><Wheel label="Day" flex={.8} values={days} index={date.day-1} onSelect={i=>change('day',i+1)}/><Wheel label="Year" flex={1.1} values={years} index={date.year-1900} onSelect={i=>change('year',1900+i)}/></View>
  </View>;
}
const s=StyleSheet.create({card:{backgroundColor:'#F7E9D6',borderRadius:20,paddingVertical:18,paddingHorizontal:10},columns:{flexDirection:'row'},wheel:{height:ROW*3},row:{height:ROW,justifyContent:'center',alignItems:'center',paddingHorizontal:4},text:{fontFamily:'Inter_500Medium',color:'#B69B82',fontSize:19},selected:{fontFamily:'Inter_800ExtraBold',color:ONBOARDING_INK,fontSize:21},highlight:{position:'absolute',left:10,right:10,top:18+ROW,height:ROW,borderRadius:11,backgroundColor:ONBOARDING_CREAM}});
