import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import { Feather } from '@expo/vector-icons';
import { listSurpriseHistory, surpriseTime, type Surprise, type SurpriseHistoryCursor } from '@/lib/surprise-api';
import { sessionEpoch } from '@/lib/session-lifecycle';
import { SurprisePortrait } from './surprise-art';
import { cachedSurpriseHistory, rememberSurprises, saveSurpriseHistoryPage, surpriseHistoryRevision } from '@/lib/surprise-history-cache';
import { useSurpriseOutbox, retrySurpriseSend, surpriseSendFailure, canEditRejectedSurprise } from '@/lib/surprise-send-queue';
import { cachedSurpriseMedia } from '@/lib/surprise-media-cache';

type Direction='received'|'sent';
type Page={items:Surprise[];cursor:SurpriseHistoryCursor|null;loaded:boolean};
/** Cached metadata stays visible; a cold replay prepares media before leaving this list. */
export function SurpriseHistory({scope,userId,name,initial,onSelect,openingId,error:playError,onEditRejected}:{scope:string;userId:string;name:string;initial:Surprise[];onSelect:(item:Surprise)=>void;openingId?:string|null;error?:string;onEditRejected?:(key:string)=>void}) {
  const [tab,setTab]=useState<Direction>('received');
  const outbox=useSurpriseOutbox();
  const pending=outbox.filter(job=>`${job.draft.userId}:${job.draft.partnerId}:${job.draft.pairVersion}`===scope&&job.state!=='sent');
  const [pages,setPages]=useState<Record<Direction,Page>>(()=>{
    rememberSurprises(scope,initial);
    const page=(direction:Direction)=>{const cached=cachedSurpriseHistory(scope,direction);return {items:cached.items,cursor:cached.nextCursor,loaded:cached.loaded};};
    return {received:page('received'),sent:page('sent')};
  });
  const sentRevision=outbox.filter(job=>job.state==='sent').map(job=>job.sentId).join(':');
  useEffect(()=>{
    // An outbox receipt / partner notification can arrive while History is
    // already open. Merge it immediately, retaining all paginated older rows.
    rememberSurprises(scope,initial);
    setPages(previous=>{
      const merge=(direction:Direction)=>({...previous[direction],items:Array.from(new Map([
        ...previous[direction].items,...cachedSurpriseHistory(scope,direction).items,
      ].map(item=>[item.id,item])).values()).sort((a,b)=>b.sent_at.localeCompare(a.sent_at)||b.id.localeCompare(a.id))});
      return {received:merge('received'),sent:merge('sent')};
    });
  },[scope,initial,sentRevision]);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [visibleLoading,setVisibleLoading]=useState(false);
  const visited=useRef(new Set<Direction>());
  const live=useRef(true),version=useRef(0),lock=useRef(false),epoch=useRef(sessionEpoch());
  useEffect(()=>{live.current=true;return()=>{live.current=false;version.current++;};},[]);
  async function load(more=false,manual=false){
    if(lock.current)return;lock.current=true;setBusy(true);setVisibleLoading(more||manual||(!pages[tab].loaded&&!pages[tab].items.length));setError('');
    const request=++version.current,direction=tab,cursor=more?pages[tab].cursor:null;
    const startedRevision=surpriseHistoryRevision();
    const current=()=>live.current&&epoch.current===sessionEpoch()&&request===version.current;
    try{
      const next=await listSurpriseHistory(direction,cursor);
      if(!current())return;
      // UI pagination is unlimited; only the durable preview cache is bounded.
      const saved=saveSurpriseHistoryPage(scope,direction,{...next,items:more?[...pages[direction].items,...next.items]:next.items},false,startedRevision);
      visited.current.add(direction);
      setPages(previous=>({...previous,[direction]:{items:saved.items,cursor:saved.nextCursor,loaded:true}}));
    }catch{if(current()&&(manual||more||(!pages[direction].loaded&&!pages[direction].items.length)))setError('Could not refresh history. Tap Retry.');}
    finally{if(current()){lock.current=false;setBusy(false);setVisibleLoading(false);}}
  }
  useEffect(()=>{version.current++;lock.current=false;setBusy(false);setVisibleLoading(false);if(!visited.current.has(tab))void load();},[tab]);
  const page=pages[tab];
  return <View style={s.root}>
    <View accessibilityRole="tablist" style={s.tabs}>{(['received','sent'] as const).map(direction=><Pressable key={direction} accessibilityRole="tab" accessibilityState={{selected:tab===direction}} onPress={()=>setTab(direction)} style={[s.tab,tab===direction&&s.selected]}><Text style={[s.tabText,tab===direction&&s.activeText]}>{direction==='received'?'Received':'Sent'}</Text></Pressable>)}</View>
    <FlatList data={page.items} keyExtractor={item=>item.id} contentContainerStyle={s.list} showsVerticalScrollIndicator={false}
      ListHeaderComponent={tab==='sent'&&pending.length?<View style={{gap:12}}>{pending.map(job=><View key={job.draft.key} style={s.item}>
        <SurprisePortrait frame={job.draft.frame} uri={job.draft.photoUri} size={68}/><View style={s.details}>
          <Text style={s.title}>{job.state==='failed'?'Not sent':'Sending in the background'}</Text>
          <Text style={s.copy}>{job.state==='failed'?surpriseSendFailure(job):'Your saved surprise will only be charged once.'}</Text>
          {job.state==='failed'&&!(job.draft.deliveryVersion===1&&canEditRejectedSurprise(job))&&<Pressable accessibilityRole="button" onPress={()=>retrySurpriseSend(job.draft.key)}><Text style={s.title}>Retry send</Text></Pressable>}
          {canEditRejectedSurprise(job)&&onEditRejected&&<Pressable accessibilityRole="button" onPress={()=>onEditRejected(job.draft.key)}><Text style={s.title}>Edit surprise</Text></Pressable>}
        </View></View>)}</View>:null}
      refreshing={busy&&visibleLoading&&page.loaded&&!page.cursor} onRefresh={()=>void load(false,true)} initialNumToRender={8} windowSize={5}
      renderItem={({item})=><Pressable accessibilityRole="button" accessibilityLabel={`Replay surprise ${tab==='received'?'from':'to'} ${name}`} disabled={!!openingId} onPress={()=>onSelect(item)} style={s.item}>
        <SurprisePortrait frame={item.frame} uri={cachedSurpriseMedia(userId,scope.split(':')[2],item.id)?.photoUrl} size={68}/><View style={s.details}><Text style={s.title}>{tab==='received'?`From ${name}`:`Sent to ${name}`}</Text><Text style={s.copy}>{new Date(item.sent_at).toLocaleDateString()} · {surpriseTime(item.duration_ms)}</Text>{tab==='received'&&!item.opened_at&&<Text style={s.new}>New surprise</Text>}</View>{openingId===item.id?<ActivityIndicator color="#6B3B23"/>:<Feather name="play-circle" size={26} color="#6B3B23"/>}
      </Pressable>}
      ListEmptyComponent={!visibleLoading&&!(tab==='sent'&&pending.length)?<Text style={s.empty}>No {tab} surprises yet.</Text>:null}
      ListFooterComponent={<View style={s.footer}>{busy&&visibleLoading&&!page.loaded&&<ActivityIndicator color="#FFF0DA"/>}{busy&&visibleLoading&&!!page.cursor&&<ActivityIndicator color="#FFF0DA"/>}{!!error&&<><Text accessibilityRole="alert" style={s.error}>{error}</Text><Pressable accessibilityRole="button" onPress={()=>void load(!!page.cursor,true)}><Text style={s.link}>Retry</Text></Pressable></>}{!busy&&!error&&!!page.cursor&&<Pressable accessibilityRole="button" onPress={()=>void load(true)}><Text style={s.link}>Load more</Text></Pressable>}</View>}/>
      {!!playError&&<Text accessibilityRole="alert" style={s.error}>{playError}</Text>}
    </View>;
}
const s=StyleSheet.create({root:{flex:1},tabs:{flexDirection:'row',backgroundColor:'#F0E0CA',marginHorizontal:20,marginBottom:16,borderRadius:24,padding:4},tab:{flex:1,padding:12,borderRadius:22,alignItems:'center'},selected:{backgroundColor:'#4A2917'},tabText:{fontWeight:'700',fontSize:16,color:'#4A2917'},activeText:{color:'#FFF8EC'},list:{padding:20,gap:12,flexGrow:1},item:{flexDirection:'row',gap:12,alignItems:'center',backgroundColor:'#F4E7D4',borderRadius:22,padding:12},details:{flex:1,gap:6},title:{fontSize:16,fontWeight:'700',color:'#4A2917'},copy:{fontSize:13,color:'#876550'},new:{color:'#A94F32',fontWeight:'600',fontSize:12},empty:{textAlign:'center',color:'#E9CFB1',marginTop:60},footer:{padding:20,gap:12,alignItems:'center'},link:{color:'#FFD0A4',fontWeight:'600',padding:12},error:{color:'#FFAD99',textAlign:'center'}});
