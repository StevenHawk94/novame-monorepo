import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { router, type Href } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { deleteMemoryRoomEntry, saveMemoryRoomEntry, type MajorUpdateBootstrap } from '@/lib/app-major-update-api';
import { runBurrowAction } from '@/lib/burrow-store';
import { fetchBurrowHistory, historyDayLabel, mergeHistory, type HistoryPage, type HistoryKind, type HistoryRow } from '@/lib/burrow-history';
import { MemoryComposer } from './memory-composer';
import { MemoryPhotos } from './memory-photos';
import { HistoryCalendar } from './history-calendar';
import { apiClient } from '@/lib/api';
import { ITEM_IMAGES } from '@/lib/item-images.g';

function Button({title,onPress,disabled=false}:{title:string;onPress:()=>void;disabled?:boolean}) {
  return <Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={[s.button,disabled&&{opacity:.5}]}><Text style={s.buttonText}>{title}</Text></Pressable>;
}
const eventCopy: Record<string,string> = {affection_sent:'sent a little love',room_need_refilled:'left a little care',gift_sent:'sent a gift',gift_claimed:'opened a gift',adventure_completed:'returned from an adventure',friend_discovered:'met a new friend',adventure_record_saved:'shared a day',memory_created:'saved a memory',room_media_updated:'personalized a room',room_photo_updated:'updated a photo',game_played:'played a game together',toy_interacted:'played with the dolls',room_decor_changed:'decorated the room'};
const affectionLabel: Record<string,string> = {hug:'hug',kiss:'kiss',cuddle:'cuddle',spicy:'spicy moment',miss_you:'miss-you note',gratitude:'thank-you'};
const decorSlotLabel: Record<string,string> = {rug:'carpet',vase:'flowers',cabinet:'dresser',shelf:'bookshelf',cushion:'cushion',frame:'photo frame',music_player:'radio',light_string:'string lights',couple_doll:'dolls',dresser_plant:'plant',shelf_decor:'decoration'};
const eventSymbol: Record<string,string> = {room_need_refilled:'💧',affection_sent:'♥',gift_sent:'🎁',gift_claimed:'🎁',adventure_completed:'🧭',friend_discovered:'🐾',room_media_updated:'🖼️',game_played:'🎲',toy_interacted:'🧸',room_decor_changed:'✦'};
function eventAction(eventType:string):{label:string;href:Href}{
  if(eventType==='affection_sent')return {label:'Send affection',href:'/(main)/burrow-detail?section=affection' as Href};
  if(eventType==='game_played')return {label:'Open Game Room',href:'/(main)/game-room' as Href};
  if(eventType==='adventure_completed'||eventType==='friend_discovered')return {label:'Open Adventure',href:'/(main)/burrow-detail?section=adventure' as Href};
  if(eventType==='memory_created')return {label:'Open Memories Room',href:'/(main)/burrow-detail?section=memories_room' as Href};
  if(eventType==='gift_sent'||eventType==='gift_claimed')return {label:'Open Collection',href:'/(main)/burrow-detail?section=collection' as Href};
  return {label:'Go to Our Room',href:'/(main)/(tabs)' as Href};
}
function eventDescription(row: Extract<HistoryRow,{event_type:string}>) {
  if (row.event_type === 'room_need_refilled') return row.payload.need === 'water' ? 'watered the flower' : row.payload.need === 'food' ? 'fed the bunny' : 'cared for the room';
  if (row.event_type === 'affection_sent') return `sent ${affectionLabel[row.payload.affectionType] ?? 'a little affection'}`;
  if (row.event_type === 'room_media_updated') return row.payload.media === 'room_photo' ? 'changed a room photo' : 'changed the room music';
  if (row.event_type === 'room_decor_changed') {
    const changes=(row.payload as unknown as {changes?:{slot:string;itemId?:string}[]}).changes;
    if (changes?.length===1) return `${changes[0]?.itemId?'replaced':'removed'} the ${decorSlotLabel[changes[0].slot]??changes[0].slot}`;
    return 'decorated the room';
  }
  return eventCopy[row.event_type] ?? 'shared a moment';
}
function momentTime(value:string,timezone:string){
  try{return new Intl.DateTimeFormat('en',{hour:'numeric',minute:'2-digit',timeZone:timezone}).format(new Date(value));}
  catch{return '';}
}
function momentDay(value:string,timezone:string){
  try{
    const parts=new Intl.DateTimeFormat('en-US',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:timezone}).formatToParts(new Date(value));
    const date=Object.fromEntries(parts.map(part=>[part.type,part.value]));
    return `${date.year}-${date.month}-${date.day}`;
  }catch{return value.slice(0,10);}
}
export function BurrowHistory({data,kind,busy}:{data:MajorUpdateBootstrap;kind:HistoryKind;busy:boolean}) {
  const [page,setPage]=useState<HistoryPage|null>(null);
  const [date,setDate]=useState('');const [input,setInput]=useState('');
  const [calendarOpen,setCalendarOpen]=useState(false);
  const [filter,setFilter]=useState<'all'|'logs'|'interactions'>('all');
  const [soloDraft,setSoloDraft]=useState('');
  const [loading,setLoading]=useState(false);const [error,setError]=useState('');
  const scope=`${data.profile.id}:${data.partner?.id}:${data.pairVersion}`;
  const liveScope=useRef(scope);liveScope.current=scope;
  const pageScope=useRef<string|null>(null);
  // Freeze the edit baseline. A wallet/realtime refresh must not close the
  // editor, lose a non-persisted draft, or silently adopt a newer edit version.
  const [edit,setEdit]=useState<{scope:string;entry:Extract<HistoryRow,{body:string}>}|null>(null);
  const editing=edit?.scope===scope?edit.entry:null;
  const [revision,setRevision]=useState(0);
  const generation=useRef(0);const lock=useRef(false);
  const focused=useIsFocused();
  const [foreground,setForeground]=useState(AppState.currentState==='active');
  useEffect(()=>{const sub=AppState.addEventListener('change',state=>setForeground(state==='active'));return()=>sub.remove();},[]);
  async function load(reset:boolean,token=generation.current) {
    if(lock.current||!data.partner)return;
    lock.current=true;setLoading(true);setError('');
    try {
      const result=await fetchBurrowHistory(kind,data.partner.id,reset?null:page?.next??null,date);
      if(token!==generation.current||scope!==liveScope.current)return;
      pageScope.current=scope;
      setPage(prior=>({...result,rows:reset?result.rows:mergeHistory(prior?.rows??[],result.rows)}));
    } catch { if(token===generation.current)setError('Could not load history. Check your connection and retry.'); }
    finally {if(token===generation.current){lock.current=false;setLoading(false);}}
  }
  useEffect(()=>{
    const token=++generation.current;lock.current=false;setPage(null);setError('');
    if(focused&&foreground)void load(true,token);
    return()=>{generation.current++;lock.current=false;};
    // Every authoritative refresh invalidates older pages: hidden/deleted rows
    // cannot remain indefinitely in a concatenated local history cache.
  },[data,kind,date,revision,focused,foreground]);
  const soloRows:HistoryRow[] = !data.partner ? (kind==='moments'?data.moments:data.memoryEntries)
    .map(row=>({...row,localDate:momentDay(row.created_at,data.profile.timezone_name??'UTC')}))
    .filter(row=>!date || row.localDate===date) : [];
  const rows=data.partner?(focused&&foreground&&pageScope.current===scope?page?.rows??[]:[]):soloRows;
  const visibleRows=kind==='moments'&&filter!=='all'?rows.filter(row=>{
    const isLog='record' in row&&!!row.record || ('event_type' in row&&row.event_type==='adventure_record_saved');
    return filter==='logs'?isLog:!isLog;
  }):rows;
  const memories=rows.filter((row):row is Extract<HistoryRow,{body:string}>=>'body' in row);
  const editorData={...data,memoryEntries:editing?[...memories.filter(item=>item.id!==editing.id),editing]:memories};
  let lastDay='';
  return <>
    {kind==='memories'&&(data.partner?<MemoryComposer key={`${scope}:${editing?.id??'new'}`} data={editorData} entryId={editing?.id??null} onDone={()=>setEdit(null)}/>
      :<View style={s.card}><Text style={s.title}>{editing?'Edit your memory':'A little moment to keep'}</Text>
        <Text style={s.copy}>{data.memoryPrompts[0]?.prompt??'What would you like to remember today?'}</Text>
        <TextInput accessibilityLabel="Your memory" multiline maxLength={5000} value={soloDraft} onChangeText={setSoloDraft}
          placeholder="Start with one little detail…" style={[s.input,{minHeight:130,textAlignVertical:'top'}]}/>
        <Button title="Save memory" disabled={busy||!soloDraft.trim()} onPress={()=>{
          void runBurrowAction(`memory:${editing?.id??'new'}`,key=>saveMemoryRoomEntry(editing?.id??null,soloDraft,data.memoryPrompts[0]?.id??null,key))
            .then(ok=>{if(ok){setSoloDraft('');setEdit(null);}});
        }}/>
      </View>)}
    {kind==='moments'&&<><View style={s.momentsHeader}><View style={{flex:1}}><Text style={s.momentsTitle}>Moments</Text><Text style={s.momentsSubtitle}>Your days, in little moments</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel={calendarOpen?'Hide calendar':'Browse moments by date'} onPress={()=>setCalendarOpen(value=>!value)} style={s.calendarButton}><Text style={s.calendarIcon}>▦</Text></Pressable>
    </View><View style={s.filters}>{(['all','logs','interactions'] as const).map(value=><Pressable key={value} accessibilityRole="button" accessibilityState={{selected:filter===value}} onPress={()=>setFilter(value)} style={[s.filter,filter===value&&s.filterSelected]}><Text style={[s.filterText,filter===value&&s.filterTextSelected]}>{value[0].toUpperCase()+value.slice(1)}</Text></Pressable>)}</View></>}
    {(kind==='memories'||calendarOpen)&&<View style={s.card}>
      <Text style={s.title}>Browse your days</Text>
      <Text style={s.copy}>Dates follow {page?.timezone??data.profile.timezone_name??'your profile timezone'}.</Text>
      <HistoryCalendar today={data.localDate} selected={date} onSelect={value=>{setInput(value);setDate(value);setRevision(n=>n+1);}}/>
      <TextInput accessibilityLabel="History date YYYY-MM-DD" value={input} onChangeText={setInput} placeholder="YYYY-MM-DD" maxLength={10} style={s.input}/>
      <View style={s.row}><Button title="Go to date" onPress={()=>{
        if(!/^\d{4}-\d{2}-\d{2}$/.test(input)||!Number.isFinite(Date.parse(input))||new Date(input).toISOString().slice(0,10)!==input){setError('Enter a date as YYYY-MM-DD.');return;}
        setDate(input);setRevision(n=>n+1);
      }}/><Button title="All days" onPress={()=>{setInput('');setDate('');setRevision(n=>n+1);}}/></View>
    </View>}
    {visibleRows.map(row=>{
      const heading=row.localDate!==lastDay;lastDay=row.localDate;
      const memory='body' in row;const actor=memory?row.author_id:row.actor_id;
      const featured=memory||('record' in row&&!!row.record);
      const avatarUrl=actor===data.profile.id?data.profile.avatar_url:data.partner?.avatar_url;
      return <View key={row.id} style={[s.group,kind==='moments'&&s.timelineGroup]}>
        {heading&&<Text accessibilityRole="header" style={s.day}>{historyDayLabel(row.localDate,data.localDate)}</Text>}
        <View style={[s.card,kind==='moments'&&(featured?s.timelineFeatured:s.timelinePlain)]}>
          {kind==='moments'?<View style={s.actorRow}><View style={[s.timelineDot,{left:featured?-41:-26}]}/><View style={s.avatar}>{avatarUrl?<Image source={{uri:avatarUrl}} contentFit="cover" style={s.avatarImage}/>:<Text style={s.avatarInitial}>{(actor===data.profile.id?data.profile.display_name:data.partner?.display_name)?.trim().charAt(0).toUpperCase()||'♡'}</Text>}</View>
            <View style={{flex:1}}><Text style={[s.actorName,!featured&&s.actorNameLight]}>{actor===data.profile.id?'You':data.partner?.display_name??'Your person'}</Text><Text style={[s.timestamp,!featured&&s.timestampLight]}>{momentTime(row.created_at,page?.timezone??data.profile.timezone_name??'UTC')}</Text></View>
          </View>:<Text style={s.title}>{actor===data.profile.id?'You':data.partner?.display_name??'Your person'}{memory?'':` ${row.record&&!row.record.shared&&!!data.partner?'recorded a private day':eventDescription(row)}`}</Text>}
          {kind==='moments'&&<View style={s.momentActionRow}>{!featured&&<View style={s.eventBadge}><Text style={s.eventBadgeText}>{eventSymbol[row.event_type]??'♡'}</Text></View>}<Text style={[s.momentAction,!featured&&s.momentActionLight]}>{memory?'Saved a memory':row.record&&!row.record.shared&&!!data.partner?'Recorded a private day':eventDescription(row)}</Text></View>}
          {memory?<><Text selectable style={s.copy}>{row.body}</Text><MemoryPhotos data={editorData} entry={row}/>
            {actor===data.profile.id&&<View style={s.row}><Button title="Edit" disabled={busy} onPress={()=>{setEdit({scope,entry:row});if(!data.partner)setSoloDraft(row.body);}}/>
              <Button title="Delete" disabled={busy} onPress={()=>Alert.alert('Delete this memory?','It will disappear from your room.',[{text:'Cancel',style:'cancel'},{text:'Delete',style:'destructive',onPress:()=>{void runBurrowAction(`delete-memory:${row.id}`,()=>deleteMemoryRoomEntry(row.id));}}])}/></View>}
          </>:<>
            {row.record&&<>
              {!!row.record.items.length&&<View style={s.recordItems}>{row.record.items.slice(0,6).map(item=><View key={item.itemId} style={s.recordItem}>
                {ITEM_IMAGES[item.itemId]?<Image source={ITEM_IMAGES[item.itemId]} contentFit="contain" style={s.recordIcon}/>:<Text style={s.recordFallback}>✦</Text>}
                <Text numberOfLines={1} style={s.recordLabel}>{item.label}</Text>
              </View>)}</View>}
              <Text selectable style={s.copy}>{row.record.body}</Text>
              {row.record.items.filter(item=>item.memory).map(item=><Text selectable key={item.itemId} style={s.copy}>{item.memory}</Text>)}
              {actor===data.profile.id&&!!data.partner&&<Button title={row.record.shared?'Shared · stop sharing':'Private · share with my partner'} disabled={busy||!Number.isSafeInteger(row.record.version)} onPress={()=>{void runBurrowAction(`record-share:${row.record!.id}:${row.record!.version}:${!row.record!.shared}`,key=>apiClient.post('/api/vnext/command',{action:'set_record_sharing',recordId:row.record!.id,shared:!row.record!.shared,expectedVersion:row.record!.version,partnerId:data.partner?.id,pairVersion:data.pairVersion,idempotencyKey:key}));}}/>}
            </>}
            {!!row.payload.itemId&&<Text style={s.copy}>{data.catalog.find(item=>item.stable_id===row.payload.itemId)?.title??'A little discovery'}</Text>}
            {!row.record&&<Button title={eventAction(row.event_type).label} onPress={()=>router.push(eventAction(row.event_type).href)}/>}
          </>}
        </View>
      </View>;
    })}
    {error&&<View style={s.card}><Text accessibilityRole="alert" style={s.copy}>{error}</Text><Button title="Retry" disabled={loading} onPress={()=>void load(!page)}/></View>}
    {loading?<Text style={s.day}>Loading history…</Text>:!error&&!visibleRows.length?<View style={s.emptyState}><Text style={s.emptyTitle}>Your story starts here</Text><Text style={s.emptyCopy}>Adventures, little acts of care and memories will appear on this timeline.</Text><Button title="Start an adventure" onPress={()=>router.push('/(main)/burrow-detail?section=adventure' as Href)}/></View>:null}
    {page?.hasMore&&<Button title="Load older moments" disabled={loading} onPress={()=>void load(false)}/>}
    {page&&!page.hasMore&&rows.length>0&&<Text style={s.day}>You’ve reached the beginning.</Text>}
  </>;
}
const s=StyleSheet.create({
  card:{backgroundColor:'#FFF4E1',borderRadius:24,padding:20,gap:14},
  group:{gap:12},
  title:{fontSize:21,fontWeight:'700',color:'#553521'},
  copy:{fontSize:16,lineHeight:23,color:'#79563E'},
  day:{fontSize:19,color:'#FFF4E1',fontWeight:'800',marginTop:12},
  momentsHeader:{flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:4,paddingTop:12,paddingBottom:8},
  momentsTitle:{fontSize:34,fontWeight:'900',color:'#FFF4E1'},
  momentsSubtitle:{fontSize:16,color:'#F9D9AE'},
  calendarButton:{width:48,height:48,borderRadius:14,backgroundColor:'#FFF4E1',alignItems:'center',justifyContent:'center'},
  calendarIcon:{fontSize:30,lineHeight:36,color:'#A45C37'},
  filters:{flexDirection:'row',borderRadius:24,borderWidth:1,borderColor:'#E8D5C2',padding:3,marginTop:4,marginBottom:9},
  filter:{flex:1,paddingVertical:10,alignItems:'center',borderRadius:20},
  filterSelected:{backgroundColor:'#FFF9F0'},
  filterText:{color:'#FFF3E5',fontSize:15},
  filterTextSelected:{color:'#683B2A',fontWeight:'800'},
  timelineGroup:{marginLeft:17,paddingLeft:21,borderLeftWidth:2,borderLeftColor:'#F9ECDD'},
  timelineFeatured:{backgroundColor:'#FFF9F0',borderRadius:18,padding:15,gap:10},
  timelinePlain:{backgroundColor:'transparent',padding:0,gap:6},
  timelineDot:{position:'absolute',top:17,width:11,height:11,borderRadius:6,backgroundColor:'#FFF9F0'},
  actorRow:{flexDirection:'row',alignItems:'center',gap:10},
  avatar:{width:42,height:42,borderRadius:21,backgroundColor:'#A86B50',alignItems:'center',justifyContent:'center',overflow:'hidden'},
  avatarImage:{width:'100%',height:'100%'},
  avatarInitial:{fontSize:19,fontWeight:'800',color:'#FFF8EF'},
  actorName:{fontSize:16,color:'#5C3225',fontWeight:'800'},
  actorNameLight:{color:'#FFF8EF'},
  timestamp:{fontSize:12,color:'#947968'},
  timestampLight:{color:'#F4DAC8'},
  momentAction:{color:'#49291D',fontSize:17,fontWeight:'700',lineHeight:23},
  momentActionRow:{flexDirection:'row',alignItems:'center',gap:10},
  momentActionLight:{color:'#FFF8EF'},
  eventBadge:{width:37,height:37,borderRadius:19,backgroundColor:'#FFF9EF',alignItems:'center',justifyContent:'center'},
  eventBadgeText:{fontSize:20,color:'#C95E43'},
  recordItems:{flexDirection:'row',flexWrap:'wrap',gap:7,paddingVertical:9,borderBottomWidth:1,borderBottomColor:'#E7DCCF'},
  recordItem:{width:52,alignItems:'center',gap:2},
  recordIcon:{width:38,height:38},
  recordFallback:{fontSize:27,color:'#C46140'},
  recordLabel:{fontSize:9,color:'#5F493C',textAlign:'center'},
  emptyState:{backgroundColor:'#FFF9F0',borderRadius:22,padding:20,gap:12,marginTop:16},
  emptyTitle:{fontSize:22,fontWeight:'800',color:'#553521'},
  emptyCopy:{fontSize:15,lineHeight:22,color:'#79563E'},
  row:{flexDirection:'row',gap:10},
  input:{borderWidth:1,borderColor:'#AA8668',borderRadius:12,padding:12,color:'#553521'},
  button:{flexShrink:1,backgroundColor:'#2F8D72',padding:14,borderRadius:16},
  buttonText:{color:'#FFF4E1',fontSize:16,fontWeight:'700'},
});
