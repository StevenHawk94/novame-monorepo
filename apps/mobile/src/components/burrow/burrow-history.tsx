import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { deleteMemoryRoomEntry, type MajorUpdateBootstrap } from '@/lib/app-major-update-api';
import { runBurrowAction } from '@/lib/burrow-store';
import { fetchBurrowHistory, historyDayLabel, mergeHistory, type HistoryPage, type HistoryKind, type HistoryRow } from '@/lib/burrow-history';
import { MemoryComposer } from './memory-composer';
import { MemoryPhotos } from './memory-photos';
import { HistoryCalendar } from './history-calendar';
import { apiClient } from '@/lib/api';

function Button({title,onPress,disabled=false}:{title:string;onPress:()=>void;disabled?:boolean}) {
  return <Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={[s.button,disabled&&{opacity:.5}]}><Text style={s.buttonText}>{title}</Text></Pressable>;
}
const eventCopy: Record<string,string> = {affection_sent:'sent a little love',room_need_refilled:'left a little care',gift_sent:'sent a gift',gift_claimed:'opened a gift',adventure_completed:'returned from an adventure',friend_discovered:'met a new friend',adventure_record_saved:'shared a day',memory_created:'saved a memory',room_media_updated:'personalized a room',room_photo_updated:'updated a photo',game_played:'played a game together',toy_interacted:'played with the dolls',room_decor_changed:'decorated the room'};
const affectionLabel: Record<string,string> = {hug:'hug',kiss:'kiss',cuddle:'cuddle',spicy:'spicy moment',miss_you:'miss-you note',gratitude:'thank-you'};
const decorSlotLabel: Record<string,string> = {rug:'carpet',vase:'flowers',cabinet:'dresser',shelf:'bookshelf',cushion:'cushion',frame:'photo frame',music_player:'radio',light_string:'string lights',couple_doll:'dolls',dresser_plant:'plant',shelf_decor:'decoration'};
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
export function BurrowHistory({data,kind,busy}:{data:MajorUpdateBootstrap;kind:HistoryKind;busy:boolean}) {
  const [page,setPage]=useState<HistoryPage|null>(null);
  const [date,setDate]=useState('');const [input,setInput]=useState('');
  const [calendarOpen,setCalendarOpen]=useState(false);
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
  const rows=focused&&foreground&&pageScope.current===scope?page?.rows??[]:[];
  const memories=rows.filter((row):row is Extract<HistoryRow,{body:string}>=>'body' in row);
  const editorData={...data,memoryEntries:editing?[...memories.filter(item=>item.id!==editing.id),editing]:memories};
  let lastDay='';
  return <>
    {kind==='memories'&&<MemoryComposer key={`${scope}:${editing?.id??'new'}`} data={editorData} entryId={editing?.id??null} onDone={()=>setEdit(null)}/>}
    {kind==='moments'&&<View style={s.momentsHeader}><View style={{flex:1}}><Text style={s.momentsTitle}>Our Moments</Text><Text style={s.momentsSubtitle}>Little pieces of our days</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel={calendarOpen?'Hide calendar':'Browse moments by date'} onPress={()=>setCalendarOpen(value=>!value)} style={s.calendarButton}><Text style={s.calendarIcon}>▦</Text></Pressable>
    </View>}
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
    {rows.map(row=>{
      const heading=row.localDate!==lastDay;lastDay=row.localDate;
      const memory='body' in row;const actor=memory?row.author_id:row.actor_id;
      return <View key={row.id} style={s.group}>
        {heading&&<Text accessibilityRole="header" style={s.day}>{historyDayLabel(row.localDate,data.localDate)}</Text>}
        <View style={s.card}>
          {kind==='moments'?<View style={s.actorRow}><View style={s.avatar}><Text style={s.avatarInitial}>{(actor===data.profile.id?data.profile.display_name:data.partner?.display_name)?.trim().charAt(0).toUpperCase()||'♡'}</Text></View>
            <View style={{flex:1}}><Text style={s.title}>{actor===data.profile.id?'You':data.partner?.display_name??'Your person'}</Text><Text style={s.copy}>{memory?'Saved a memory':row.record&&!row.record.shared?'Recorded a private day':eventDescription(row)}</Text></View>
            <Text style={s.timestamp}>{momentTime(row.created_at,page?.timezone??data.profile.timezone_name??'UTC')}</Text>
          </View>:<Text style={s.title}>{actor===data.profile.id?'You':data.partner?.display_name??'Your person'}{memory?'':` ${row.record&&!row.record.shared?'recorded a private day':eventDescription(row)}`}</Text>}
          {memory?<><Text selectable style={s.copy}>{row.body}</Text><MemoryPhotos data={editorData} entry={row}/>
            {actor===data.profile.id&&<View style={s.row}><Button title="Edit" disabled={busy} onPress={()=>setEdit({scope,entry:row})}/>
              <Button title="Delete" disabled={busy} onPress={()=>Alert.alert('Delete this memory?','It will disappear from both of your rooms.',[{text:'Cancel',style:'cancel'},{text:'Delete',style:'destructive',onPress:()=>{void runBurrowAction(`delete-memory:${row.id}`,()=>deleteMemoryRoomEntry(row.id));}}])}/></View>}
          </>:<>
            {row.record&&<>
              <Text selectable style={s.copy}>{row.record.body}</Text>
              {row.record.items.map(item=><View key={item.itemId}><Text style={s.copy}>{item.label}</Text>{!!item.memory&&<Text selectable style={s.copy}>{item.memory}</Text>}</View>)}
              {actor===data.profile.id&&<Button title={row.record.shared?'Shared · stop sharing':'Private · share with my partner'} disabled={busy||!Number.isSafeInteger(row.record.version)} onPress={()=>{void runBurrowAction(`record-share:${row.record!.id}:${row.record!.version}:${!row.record!.shared}`,key=>apiClient.post('/api/vnext/command',{action:'set_record_sharing',recordId:row.record!.id,shared:!row.record!.shared,expectedVersion:row.record!.version,partnerId:data.partner?.id,pairVersion:data.pairVersion,idempotencyKey:key}));}}/>}
            </>}
            {!!row.payload.itemId&&<Text style={s.copy}>{data.catalog.find(item=>item.stable_id===row.payload.itemId)?.title??'A little discovery'}</Text>}
            {!row.record&&<Button title={row.event_type==='memory_created'?'Open Memories Room':row.event_type==='affection_sent'?'Send love back':'Open collection'} onPress={()=>router.push(`/(main)/burrow-detail?section=${row.event_type==='memory_created'?'memories_room':row.event_type==='affection_sent'?'affection':'collection'}` as Href)}/>}
          </>}
        </View>
      </View>;
    })}
    {error&&<View style={s.card}><Text accessibilityRole="alert" style={s.copy}>{error}</Text><Button title="Retry" disabled={loading} onPress={()=>void load(!page)}/></View>}
    {loading?<Text style={s.day}>Loading history…</Text>:!error&&!rows.length?<Text style={s.day}>No moments on this page yet.</Text>:null}
    {page?.hasMore&&<Button title="Load older moments" disabled={loading} onPress={()=>void load(false)}/>}
    {page&&!page.hasMore&&rows.length>0&&<Text style={s.day}>You’ve reached the beginning.</Text>}
  </>;
}
const s=StyleSheet.create({card:{backgroundColor:'#FFF4E1',borderRadius:24,padding:20,gap:14},group:{gap:12},title:{fontSize:21,fontWeight:'700',color:'#553521'},copy:{fontSize:16,lineHeight:23,color:'#79563E'},day:{fontSize:19,color:'#FFF4E1',fontWeight:'700'},momentsHeader:{flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:8,paddingVertical:5},momentsTitle:{fontSize:30,fontWeight:'900',color:'#FFF4E1'},momentsSubtitle:{fontSize:16,color:'#F9D9AE'},calendarButton:{width:54,height:54,borderRadius:17,backgroundColor:'#FFF4E1',alignItems:'center',justifyContent:'center'},calendarIcon:{fontSize:34,lineHeight:40,color:'#A45C37'},actorRow:{flexDirection:'row',alignItems:'center',gap:12},avatar:{width:46,height:46,borderRadius:23,backgroundColor:'#F3D4AA',alignItems:'center',justifyContent:'center'},avatarInitial:{fontSize:21,fontWeight:'800',color:'#8B4A2C'},timestamp:{fontSize:12,color:'#947968'},row:{flexDirection:'row',gap:10},input:{borderWidth:1,borderColor:'#AA8668',borderRadius:12,padding:12,color:'#553521'},button:{flexShrink:1,backgroundColor:'#2F8D72',padding:14,borderRadius:16},buttonText:{color:'#FFF4E1',fontSize:16,fontWeight:'700'}});
