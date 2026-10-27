import {useEffect,useRef,useState} from 'react';
import {Pressable,ScrollView,Text,View} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import type {MajorUpdateBootstrap} from '@/lib/app-major-update-api';
import {fetchBurrowHistory,type HistoryCursor} from '@/lib/burrow-history';
import {attentionScope,burrowAttentionCounts,markBurrowUpdatesSeen} from '@/lib/burrow-attention';
import {sessionEpoch} from '@/lib/session-lifecycle';

type Letter=MajorUpdateBootstrap['memoryEntries'][number];
export function LoveLetterInbox({data}:{data:MajorUpdateBootstrap}){
  const scope=attentionScope(data),focused=useIsFocused();
  const activeScope=useRef(scope);activeScope.current=scope;
  const operation=useRef(0);
  const [history,setHistory]=useState<{scope:string;rows:Letter[];next:HistoryCursor}|null>(null);
  const [loading,setLoading]=useState(false),[failed,setFailed]=useState(false);
  const rows=[...new Map([...data.memoryEntries,...(history?.scope===scope?history.rows:[])]
    .filter(row=>row.author_id===data.partner?.id&&row.body.startsWith('💌 ')).map(row=>[row.id,row])).values()]
    .sort((a,b)=>b.updated_at.localeCompare(a.updated_at));
  async function load(more=false){
    const token=++operation.current,epoch=sessionEpoch();setLoading(true);setFailed(false);
    try{
      const page=await fetchBurrowHistory('memories',data.partner?.id,more&&history?.scope===scope?history.next:null,'');
      if(token!==operation.current||epoch!==sessionEpoch()||scope!==activeScope.current)return;
      const letters=page.rows.filter((row):row is Letter&{localDate:string}=>'author_id' in row&&row.author_id===data.partner?.id&&row.body.startsWith('💌 '));
      setHistory(previous=>({scope,rows:[...(more&&previous?.scope===scope?previous.rows:[]),...letters],next:page.next}));
    }catch{if(token===operation.current)setFailed(true);}
    finally{if(token===operation.current)setLoading(false);}
  }
  useEffect(()=>{if(focused&&data.partner)void load();return()=>{operation.current++;};},[focused,scope]);
  const rowKey=rows.map(row=>`${row.id}:${row.updated_at}`).join('|');
  useEffect(()=>{if(focused)markBurrowUpdatesSeen(data,'letters',rows.map(row=>`${row.id}:${row.updated_at}`));},[focused,scope,rowKey]);
  const more=history?.scope===scope&&!!history.next;
  return <ScrollView style={{flex:1}} contentContainerStyle={{gap:14,paddingBottom:20}}>
    {rows.length?rows.map(row=><View key={row.id} style={{backgroundColor:'#FFFCF7',borderRadius:18,padding:20,gap:10}}>
      <Text style={{fontSize:18,color:'#9D6F5C'}}>From {data.partner?.display_name??'your person'}</Text>
      <Text style={{fontSize:20,lineHeight:29,color:'#3F271B'}}>{row.body.slice('💌 '.length)}</Text>
    </View>):<Text style={{color:'#9D6F5C',textAlign:'center'}}>{burrowAttentionCounts(data).letter>0?'Connect to view your new letters.':'No letters yet'}</Text>}
    {failed&&<Text accessibilityRole="alert" style={{color:'#A13B24'}}>Couldn’t load more notes. Please try again.</Text>}
    {(more||failed)&&<Pressable accessibilityRole="button" disabled={loading} onPress={()=>void load(!!more)} style={{padding:16}}><Text style={{textAlign:'center',color:'#4C2B22'}}>{loading?'Loading…':failed?'Retry':'Load more'}</Text></Pressable>}
  </ScrollView>;
}
