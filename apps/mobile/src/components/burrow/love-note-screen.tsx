import {useEffect,useRef,useState} from 'react';
import { ActivityIndicator, BackHandler, KeyboardAvoidingView, Platform, ScrollView, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import {router} from 'expo-router';
import {Feather,MaterialIcons} from '@expo/vector-icons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {type MajorUpdateBootstrap} from '@/lib/app-major-update-api';
import {attentionScope,markBurrowUpdatesSeen,unreadBurrowUpdateIds,useBurrowAttention} from '@/lib/burrow-attention';
import {useLoveNotes} from '@/lib/use-love-notes';
import {loveNoteBody,loveNoteDate,loveNoteKey,loveNoteSections,notesForTab,oldestUnreadLoveNote,type LoveNote,type LoveNoteTab} from '@/lib/love-note-model';
import {keepBurrowTextDraft,readBurrowTextDraft,removeBurrowTextDraft} from '@/lib/burrow-text-drafts';
import {enqueueLoveNote,recoverLoveNote} from '@/lib/burrow-store';
import {sessionEpoch} from '@/lib/session-lifecycle';
import {afterUiSettles} from '@/lib/ui-idle';
import {dismissToRetainedTab} from '@/lib/retained-tab-navigation';
import {BurrowBackButton} from './burrow-back-button';

function Header({history=false,canOpenHistory=false,onBack}:{history?:boolean;canOpenHistory?:boolean;onBack?:()=>void}){
  const insets=useSafeAreaInsets();
  return <View style={[styles.header,{paddingTop:insets.top+10}]}>
    <BurrowBackButton onPress={onBack??(()=>router.back())}/>
    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.8} style={styles.headerTitle}>{history?'Love Note History':'Love Note'}</Text>
    {canOpenHistory?<Pressable accessibilityRole="button" accessibilityLabel="Love Note History" onPress={()=>router.push('/(main)/love-note-history')} style={styles.headerAction}><MaterialIcons name="history" size={32} color="#4C2B22"/></Pressable>:<View style={styles.headerAction}/>}
  </View>;
}
function Action({label,onPress,disabled=false,spinning=false,acknowledged=false}:{label:string;onPress:()=>void;disabled?:boolean;spinning?:boolean;acknowledged?:boolean}){
  return <Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={({pressed})=>[styles.action,disabled&&styles.actionDisabled,pressed&&!disabled&&{opacity:.85}]}>
    {spinning?<ActivityIndicator accessibilityLabel="Sending love note" color="#FFFAF2"/>:<>{!acknowledged&&<Feather name="send" size={23} color="#FFFAF2"/>}<Text style={styles.actionText}>{label}</Text></>}
  </Pressable>;
}
const writeBack=()=>router.push({pathname:'/(main)/room-interaction',params:{kind:'letter',compose:'1'}});

export function LoveNoteScreen({data,compose=false,noteId,autoFocusReady=false}:{data:MajorUpdateBootstrap;compose?:boolean;noteId?:string;autoFocusReady?:boolean}){
  const scope=attentionScope(data),insets=useSafeAreaInsets();
  const unread=unreadBurrowUpdateIds(data,'letters');
  // Composing needs no history request. Freeze read intent so acknowledging
  // an incoming note does not cancel its pagination or change the visible page.
  const [readHistory]=useState(()=>!!noteId||(!compose&&unread.length>0));
  const notes=useLoveNotes(data,{enabled:readHistory});
  useBurrowAttention(data);
  // Capture entry intent once. Acknowledging a letter must not replace its
  // reading page with the composer; arrivals must not overwrite a typed draft.
  const [selection,setSelection]=useState<string|null|undefined>(()=>noteId??(compose?null:oldestUnreadLoveNote(notes.rows,unread,notes.loaded&&!notes.hasMore)?.id??(unread.length?undefined:null)));
  const note=notes.rows.find(row=>row.id===selection);
  // A received letter is a normal native page: swipe pops its original route,
  // without interception or a History detour. Explicit History details still
  // pop back to the History page that opened them.
  const closeRead=()=>{if(router.canGoBack())router.back();else dismissToRetainedTab('/(main)/(tabs)');};
  const draftScope=`${data.profile.id}:${data.pairVersion??'solo'}`;
  const [body,setBody]=useState(()=>readBurrowTextDraft(draftScope,'letter')?.body??recoverLoveNote(data)?.body??'');
  const [sent,setSent]=useState(false),[error,setError]=useState<string|null>(null);
  const [spinning,setSpinning]=useState(false);
  const input=useRef<TextInput|null>(null),feedbackTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const request=useRef(false),mounted=useRef(true),current=useRef(scope);current.current=scope;
  const success=useRef<{scope:string;epoch:number}|null>(null),closing=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;if(feedbackTimer.current!==null)clearTimeout(feedbackTimer.current);};},[]);
  useEffect(()=>{
    if(!autoFocusReady||!notes.focused||selection!==null)return;
    // Native autoFocus on mount overlaps the card slide with keyboard-driven
    // layout. Use one focus owner after the existing transition scheduler has
    // released the UI, not a guessed animation-length timeout or network wait.
    const epoch=sessionEpoch();
    return afterUiSettles(()=>{
      if(mounted.current&&current.current===scope&&epoch===sessionEpoch()&&!input.current?.isFocused())input.current?.focus();
    },{delayMs:0});
  },[autoFocusReady,notes.focused,selection,scope]);
  useEffect(()=>{
    if(selection!==undefined)return;
    const next=oldestUnreadLoveNote(notes.rows,unread,notes.loaded&&!notes.hasMore);
    if(next)setSelection(next.id);
    else if(!unread.length)setSelection(null);
  },[selection,notes.rows,unread.join('|'),notes.loaded,notes.hasMore]);
  const received=!!note&&note.author_id===data.partner?.id;
  useEffect(()=>{
    if(note&&received&&notes.focused)markBurrowUpdatesSeen(data,'letters',[loveNoteKey(note)]);
  },[scope,notes.focused,note?.id,note?.updated_at,received]);
  // A cold detail link or unread metadata can point beyond the bootstrap page.
  // Walk available pages silently until that specific body is found.
  useEffect(()=>{
    if(selection!==null&&!note&&notes.loaded&&notes.hasMore&&!notes.loading&&!notes.failed)void notes.load(true);
  },[selection,!!note,notes.loaded,notes.hasMore,notes.loading,notes.failed,notes.load]);
  function send(){
    if(!body.trim()||request.current||sent)return;
    let draft;
    try{draft=keepBurrowTextDraft(draftScope,'letter',body);}
    catch{setError('Could not keep your draft. Free device storage before sending.');return;}
    request.current=true;setError(null);
    const epoch=sessionEpoch();
    try{
      // One second of local button feedback, never a wait for the cloud receipt.
      enqueueLoveNote(data,body,draft.key);
      try{removeBurrowTextDraft(draftScope,'letter',draft.key);}catch{}
      if(!mounted.current||current.current!==scope||epoch!==sessionEpoch())return;
      const token={scope,epoch};success.current=token;setSent(true);setSpinning(true);
      feedbackTimer.current=setTimeout(()=>{
        feedbackTimer.current=null;
        if(!mounted.current||current.current!==token.scope||token.epoch!==sessionEpoch()||success.current!==token)return;
        setBody('');setSpinning(false);request.current=false;
      },1000);
    }catch{request.current=false;setError('Could not keep your note for sending. Your words are still here. Please try again.');}
  }
  function closeSent(){
    if(closing.current||!mounted.current||!success.current||success.current.scope!==current.current||success.current.epoch!==sessionEpoch())return;
    closing.current=true;setSent(false);
    if(feedbackTimer.current!==null)clearTimeout(feedbackTimer.current);feedbackTimer.current=null;
    success.current=null;
    // Return to the retained Home even when composing from a history/detail
    // Write Back route; popping one screen would reopen another Love Note.
    dismissToRetainedTab('/(main)/(tabs)');
  }
  useEffect(()=>{
    if(!sent||success.current?.scope!==scope||success.current.epoch!==sessionEpoch())return;
    const back=BackHandler.addEventListener('hardwareBackPress',()=>{closeSent();return true;});
    return()=>{back.remove();};
  },[sent,scope]);
  const name=data.partner?.display_name?.trim()||'your person';
  return <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined} style={styles.root}>
    <View style={styles.root}>
    {/* Stable native editor parent; inline feedback never adds a touch-blocking overlay. */}
    <View style={styles.root} collapsable={false}>
    <Header canOpenHistory={selection===null} onBack={!compose&&!noteId&&selection!==null?closeRead:undefined}/>
    {selection!==null?<View style={[styles.readPage,{paddingBottom:Math.max(insets.bottom,20)}]}>
      {note?<>
        <View style={styles.from}><Text style={styles.fromTitle}>{received?'From':'To'} {name} ❤️</Text><Text style={styles.date}>{loveNoteDate(note.created_at,data.profile.timezone_name,true)}</Text></View>
        <ScrollView bounces={false} overScrollMode="never" style={styles.paper} contentContainerStyle={styles.paperContent}><Text selectable style={styles.body}>{loveNoteBody(note)}</Text></ScrollView>
        {received&&unread.some(key=>key!==loveNoteKey(note))&&<Pressable accessibilityRole="button" onPress={()=>setSelection(oldestUnreadLoveNote(notes.rows,unread.filter(key=>key!==loveNoteKey(note)),notes.loaded&&!notes.hasMore)?.id)} style={styles.retry}><Text style={styles.nextNote}>Next Note</Text></Pressable>}
        <Action label={received?'Write Back':'Write Another'} onPress={writeBack}/>
      </>:<View style={styles.unavailable}>
        {notes.loading||(!notes.failed&&(!notes.loaded||notes.hasMore))?<ActivityIndicator color="#4C2B22"/>:<><Text style={styles.helper}>{notes.failed?'Couldn’t load your note. Please try again.':'This note is no longer available.'}</Text>{notes.failed&&<Pressable accessibilityRole="button" onPress={()=>void notes.load(notes.hasMore)} style={styles.retry}><Text style={styles.helper}>Retry</Text></Pressable>}<Pressable accessibilityRole="button" onPress={writeBack} style={styles.retry}><Text style={styles.helper}>Write a Love Note</Text></Pressable></>}
      </View>}
    </View>:<View style={[styles.composePage,{paddingBottom:Math.max(insets.bottom,20)}]}>
      <Text style={styles.to}>To <Text style={{color:'#4C2B22'}}>{name} ❤️</Text></Text>
      <TextInput ref={input} accessibilityLabel="Love note" multiline maxLength={500} value={body} textAlignVertical="top" placeholder="Write something from your heart..." placeholderTextColor="#79685A" style={[styles.paper,styles.input]} onChangeText={text=>{
        // Keep the keyboard up. Only the short accepted-feedback stage freezes input.
        if(request.current||closing.current)return;
        success.current=null;setBody(text);setSent(false);setError(null);
        try{keepBurrowTextDraft(draftScope,'letter',text);}catch{setError('Draft could not be saved on this device.');}
      }}/>
      <View style={styles.counter}><Text style={styles.helper}>500 characters max</Text><Text style={styles.helper}>{body.length} / 500</Text></View>
      {error&&<Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <Action label={sent?(data.partner?'Love Note Sent ✓':'Love Note Saved ✓'):data.partner?'Send Love Note':'Save Love Note'} onPress={send} disabled={sent||!body.trim()} spinning={spinning} acknowledged={sent}/>
    </View>}
    </View>
    </View>
  </KeyboardAvoidingView>;
}

export function LoveNoteHistoryScreen({data}:{data:MajorUpdateBootstrap}){
  const notes=useLoveNotes(data),insets=useSafeAreaInsets();
  useBurrowAttention(data);
  const unread=new Set(unreadBurrowUpdateIds(data,'letters'));
  const [tab,setTab]=useState<LoveNoteTab>('received');
  const rows=notesForTab(data,notes.rows,tab),name=data.partner?.display_name?.trim()||'your person';
  function open(note:LoveNote){router.push({pathname:'/(main)/love-note-detail',params:{id:note.id}});}
  return <View style={styles.root}>
    <Header history/>
    <View style={styles.historyTop}>
      <View style={styles.tabs}>{(['received','sent'] as const).map(value=><Pressable key={value} accessibilityRole="tab" accessibilityState={{selected:tab===value}} onPress={()=>setTab(value)} style={[styles.tab,tab===value&&styles.selectedTab]}><Text style={[styles.tabText,tab===value&&styles.selectedTabText]}>{value==='received'?'Received':'Sent'}</Text></Pressable>)}</View>
      <Text style={styles.historyCaption}>{tab==='received'?`Little notes from ${name} ❤️`:`Little notes you sent to ${name} ❤️`}</Text>
    </View>
    <SectionList sections={loveNoteSections(rows,data.profile.timezone_name)} keyExtractor={row=>row.id} stickySectionHeadersEnabled={false} bounces={false} overScrollMode="never" contentContainerStyle={[styles.historyList,{paddingBottom:insets.bottom+24}]} showsVerticalScrollIndicator={false}
      renderSectionHeader={({section})=><Text style={styles.month}>{section.title}</Text>}
      renderItem={({item})=><Pressable accessibilityRole="button" accessibilityLabel={`${tab==='received'?'Read received':'Read sent'} note, ${loveNoteDate(item.created_at,data.profile.timezone_name)}`} onPress={()=>open(item)} style={({pressed})=>[styles.historyCard,pressed&&{backgroundColor:'#FFF2E4'}]}>
        <View style={[styles.noteIcon,tab==='sent'&&styles.sentIcon]}><Feather name={tab==='received'?'mail':'send'} size={26} color="#4C2B22"/></View>
        <View style={styles.cardContent}><View style={styles.metadata}><Text style={styles.cardDate}>{loveNoteDate(item.created_at,data.profile.timezone_name)}</Text>{tab==='received'&&unread.has(loveNoteKey(item))&&<Text style={styles.newLabel}>● New</Text>}</View><Text numberOfLines={2} style={styles.preview}>{loveNoteBody(item).replace(/\s+/g,' ').trim()}</Text></View>
        <Feather name="chevron-right" size={23} color="#4C2B22"/>
      </Pressable>}
      ListEmptyComponent={<View style={styles.empty}><Text style={styles.helper}>{notes.loading?'Loading notes…':tab==='received'?'No received notes yet.':'No sent notes yet.'}</Text></View>}
      ListFooterComponent={<View style={styles.historyFooter}>{notes.failed&&<Text accessibilityRole="alert" style={styles.error}>Couldn’t load more notes. Please try again.</Text>}{(notes.hasMore||notes.failed)&&<Pressable disabled={notes.loading} accessibilityRole="button" onPress={()=>void notes.load(notes.hasMore)} style={styles.retry}><Text style={styles.helper}>{notes.loading?'Loading…':notes.failed?'Retry':'Load more'}</Text></Pressable>}</View>}/>
  </View>;
}

const styles=StyleSheet.create({
  root:{flex:1,backgroundColor:'#FFFAF2'},header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:18,paddingBottom:16,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:'#DDD6CB'},headerTitle:{flex:1,textAlign:'center',fontSize:23,fontWeight:'800',color:'#3F271B',paddingHorizontal:6},headerAction:{width:44,height:44,alignItems:'center',justifyContent:'center'},
  composePage:{flex:1,paddingHorizontal:18,paddingTop:16,gap:15},to:{fontSize:20,color:'#7B6253'},paper:{flex:1,borderWidth:1.2,borderColor:'#BFA68C',borderRadius:9,backgroundColor:'#FFFCF8'},input:{paddingHorizontal:20,paddingTop:22,paddingBottom:20,fontSize:18,lineHeight:27,color:'#3F271B'},counter:{flexDirection:'row',justifyContent:'space-between'},helper:{fontSize:13,color:'#7B6253',lineHeight:20},action:{minHeight:60,borderRadius:32,backgroundColor:'#4C2B22',flexDirection:'row',justifyContent:'center',alignItems:'center',gap:14,paddingHorizontal:16},actionDisabled:{backgroundColor:'#9C8980'},actionText:{fontSize:17,fontWeight:'800',color:'#FFFAF2'},error:{fontSize:14,color:'#A13B24',lineHeight:20},
  readPage:{flex:1,paddingHorizontal:18,paddingTop:20,gap:16},from:{alignItems:'center',gap:5,marginBottom:4},fromTitle:{fontSize:21,fontWeight:'800',color:'#3F271B'},date:{fontSize:15,color:'#7B6253'},paperContent:{padding:20},body:{fontSize:18,lineHeight:27,color:'#3F271B'},unavailable:{flex:1,alignItems:'center',justifyContent:'center',gap:14},retry:{padding:14,alignItems:'center'},nextNote:{fontSize:16,fontWeight:'700',color:'#4C2B22'},
  historyTop:{paddingHorizontal:18,paddingTop:20,gap:15},tabs:{flexDirection:'row',gap:8},tab:{flex:1,borderRadius:30,minHeight:50,backgroundColor:'#F9E6D1',alignItems:'center',justifyContent:'center'},selectedTab:{backgroundColor:'#4C2B22'},tabText:{fontSize:17,fontWeight:'700',color:'#4C2B22'},selectedTabText:{color:'#FFFAF2'},historyCaption:{fontSize:16,lineHeight:23,color:'#7B6253'},historyList:{paddingHorizontal:18},month:{fontSize:21,fontWeight:'800',color:'#3F271B',marginTop:24,marginBottom:14},historyCard:{borderWidth:1.2,borderColor:'#BFA68C',borderRadius:10,flexDirection:'row',alignItems:'center',padding:12,gap:12,marginBottom:10,minHeight:90},noteIcon:{width:46,height:46,borderRadius:14,backgroundColor:'#FAEAD8',alignItems:'center',justifyContent:'center'},sentIcon:{backgroundColor:'transparent'},cardContent:{flex:1,gap:5},metadata:{flexDirection:'row',flexWrap:'wrap',justifyContent:'space-between',gap:6},cardDate:{fontSize:13,color:'#7B6253'},newLabel:{fontSize:12,color:'#4C2B22',fontWeight:'600'},preview:{fontSize:15,lineHeight:22,color:'#3F271B'},empty:{paddingTop:32,alignItems:'center'},historyFooter:{gap:10,paddingVertical:12},
});
