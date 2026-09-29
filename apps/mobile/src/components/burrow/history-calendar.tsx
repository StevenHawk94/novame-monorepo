import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
export function HistoryCalendar({today,selected,onSelect}:{today:string;selected:string;onSelect:(date:string)=>void}) {
  const [month,setMonth]=useState(()=>today.slice(0,7));
  const first=new Date(`${month}-01T12:00:00Z`);
  const count=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
  const move=(delta:number)=>{const next=new Date(first);next.setUTCMonth(next.getUTCMonth()+delta);setMonth(next.toISOString().slice(0,7));};
  return <View style={{gap:10}}>
    <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center'}}>
      <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={()=>move(-1)} style={{padding:14}}><Text>‹</Text></Pressable>
      <Text accessibilityRole="header" style={{fontWeight:'700',color:'#553521'}}>{month}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Next month" disabled={month>=today.slice(0,7)} onPress={()=>move(1)} style={{padding:14}}><Text>›</Text></Pressable>
    </View>
    <View style={{flexDirection:'row',flexWrap:'wrap'}}>{Array.from({length:first.getUTCDay()+count},(_,index)=>{
      const day=index-first.getUTCDay()+1,date=`${month}-${String(day).padStart(2,'0')}`;
      return day<1?<View key={index} style={{width:'14.28%',height:44}}/>:<Pressable key={index} accessibilityRole="button" accessibilityLabel={date} accessibilityState={{selected:date===selected,disabled:date>today}} disabled={date>today} onPress={()=>onSelect(date)} style={{width:'14.28%',minHeight:44,paddingVertical:12,alignItems:'center',borderRadius:12,backgroundColor:date===selected?'#2F8D72':'transparent',opacity:date>today?.4:1}}><Text style={{color:date===selected?'#FFF4E1':'#553521'}}>{day}</Text></Pressable>;
    })}</View>
  </View>;
}
