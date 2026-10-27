import {useCallback,useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {AppState,BackHandler,Keyboard,Platform,Pressable,ScrollView,StatusBar,StyleSheet,Text,TextInput,View} from 'react-native';
import {router} from 'expo-router';
import {useIsFocused} from '@react-navigation/native';
import {Feather} from '@expo/vector-icons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAppViewport} from '@/lib/app-viewport';
import {useBurrowSelector} from '@/lib/burrow-store';
import {usePartnerEntryGate} from '@/lib/use-partner-entry-gate';
import {usePageBackGesture} from '@/lib/use-page-back-gesture';
import {keepBurrowTextDraft,readBurrowTextDraft,rebaseBurrowTextDraft} from '@/lib/burrow-text-drafts';
import {acknowledgeJournal,cacheCoupleJournal,cachedCoupleJournal,configureJournal,discardRejectedJournal,enqueueJournal,
  fetchCoupleJournal,fetchCoupleJournalPage,journalJobs,localCoupleJournal,preparedCoupleJournalVersion,subscribeCoupleJournalCache,
  type CoupleJournalAnswer,type CoupleJournalPage} from '@/lib/couple-journal';
import {localJournalPageId} from '@/lib/couple-journal-questions';
import {dismissJournalHistoryReminder,hasJournalHistoryReminder,journalRenderedAttentionIds,markBurrowUpdatesSeen,subscribeAttention,
  attentionRevision,unreadBurrowUpdateIds} from '@/lib/burrow-attention';
import {notificationContentVersion} from '@/lib/notification-content-version';
import {sessionEpoch,sessionUserId} from '@/lib/session-lifecycle';
import {showBurrowToast} from '@/lib/burrow-toast';
import {ROOM_TITLE_STYLE} from '@/lib/room-header-typography';
import {AppModal} from '@/components/layout/app-modal';
import {UserAvatar} from '@/components/ui/user-avatar';
import {BurrowBackButton} from './burrow-back-button';
import {Image} from './burrow-image';
import {memoriesRoomLayout} from '@/lib/memories-room-layout';
const BACKGROUND=require('../../../assets/burrow-webp/memories-room.webp');
const serif=Platform.select({ios:'Georgia',default:'serif'});

export function CoupleJournalScreen({initialPageId,historyPage=false}:{initialPageId?:string;historyPage?:boolean}={}){
  // No wallet, decoration or quest subscription in this text-only domain.
  const data=useBurrowSelector(s=>s.data,(a,b)=>a?.profile===b?.profile&&a?.partner===b?.partner&&a?.pairVersion===b?.pairVersion
    &&a?.pairAccessVerified===b?.pairAccessVerified&&(!a||!b?a===b:notificationContentVersion(a,'journal')===notificationContentVersion(b,'journal')));
  usePartnerEntryGate(data);
  const focused=useIsFocused(),viewport=useAppViewport(),insets=useSafeAreaInsets();
  const [size,setSize]=useState({width:viewport.width,height:viewport.height});
  const {width,height}=size,layout=memoriesRoomLayout(width,height,viewport.fontScale??1);
  const scope=data?`${data.profile.id}:${data.pairVersion??'solo'}`:'',zone=data?.profile.timezone_name??'UTC';
  const currentScope=useRef(scope);currentScope.current=scope;
  const sequence=useRef(0),alive=useRef(true),loaded=useRef(''),seen=useRef(''),leaving=useRef(false),moreRequested=useRef('');
  const prepared=useSyncExternalStore(subscribeCoupleJournalCache,()=>cachedCoupleJournal(scope),()=>null);
  const snapshot=prepared??localCoupleJournal(scope,zone);
  useSyncExternalStore(subscribeAttention,attentionRevision,attentionRevision);
  const [view,setView]=useState<'today'|'history'|'detail'>(historyPage?'history':'today');
  const [selected,setSelected]=useState<string|null>(initialPageId??null),[index,setIndex]=useState(0);
  const [editor,setEditor]=useState<{pageId:string;body:string;expected:string|null}|null>(null);
  const [storedFull,setFull]=useState<CoupleJournalAnswer|null>(null),fullScope=useRef(scope);
  const full=fullScope.current===scope&&data?.profile.id===sessionUserId()?storedFull:null;
  const [error,setError]=useState(''),[loadingMore,setLoadingMore]=useState(false);
  const pages=snapshot?.history??[],chosen=editor?[snapshot?.today,...pages].find(p=>p?.id===editor.pageId):view==='detail'?[snapshot?.today,...pages].find(p=>p?.id===selected):snapshot?.today;
  const pageSize=layout.historyPageSize;
  const pageIndex=Math.min(index,Math.max(0,Math.ceil(pages.length/pageSize)-1));
  const version=data?notificationContentVersion(data,'journal'):'';
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;sequence.current++;};},[]);
  useEffect(()=>{setView(historyPage?'history':initialPageId&&snapshot?.today.id!==initialPageId?'detail':'today');setSelected(initialPageId??null);setEditor(null);setFull(null);setError('');setIndex(0);seen.current='';loaded.current='';moreRequested.current='';},[scope,historyPage,initialPageId]);
  const load=useCallback(async(more=false)=>{
    if(!scope)return;const before=more?snapshot?.nextBefore:undefined;if(more&&!before)return;
    const token=++sequence.current,epoch=sessionEpoch();if(more){moreRequested.current=before!;setLoadingMore(true);}
    try{
      const fresh=await fetchCoupleJournal(before??undefined,scope);
      if(!alive.current||currentScope.current!==scope||epoch!==sessionEpoch()||token!==sequence.current)return;
      const previous=localCoupleJournal(scope,zone);
      fresh.history=[...(more?previous?.history??[]:fresh.history),...(more?fresh.history:previous?.history??[])]
        .filter((p,i,all)=>all.findIndex(q=>p.id===q.id)===i);
      if(initialPageId&&initialPageId!==fresh.today.id&&!fresh.history.some(p=>p.id===initialPageId)){
        const page=await fetchCoupleJournalPage(initialPageId);
        if(!alive.current||currentScope.current!==scope||epoch!==sessionEpoch()||token!==sequence.current)return;
        fresh.history.push(page);
      }
      cacheCoupleJournal(scope,fresh);loaded.current=version;setError('');
    }catch{if(alive.current&&currentScope.current===scope&&token===sequence.current)setError('Could not sync. Your words are safe. Tap to retry.');}
    finally{if(alive.current&&token===sequence.current)setLoadingMore(false);}
  },[scope,zone,snapshot?.nextBefore,version,initialPageId]);
  useEffect(()=>{if(!focused||!data)return;configureJournal(data);
    if((loaded.current!==version&&preparedCoupleJournalVersion(scope)!==version)||!cachedCoupleJournal(scope))void load();
  },[focused,scope,version,load]);
  useEffect(()=>{if(focused)leaving.current=false;},[focused]);
  // Prepare the next index/body batch before making its arrow actionable.
  useEffect(()=>{if(focused&&view==='history'&&snapshot?.hasMore&&!loadingMore&&moreRequested.current!==snapshot.nextBefore&&(pageIndex+2)*pageSize>=pages.length)void load(true);
  },[focused,view,snapshot?.hasMore,snapshot?.nextBefore,loadingMore,pageIndex,pageSize,pages.length,load]);
  useEffect(()=>{if(!focused)return;const check=()=>{if(!cachedCoupleJournal(scope))void load();};
    const sub=AppState.addEventListener('change',s=>{if(s==='active')check();});
    const timer=setInterval(()=>{if(AppState.currentState==='active')check();},30000);
    return()=>{sub.remove();clearInterval(timer);};},[focused,scope,load]);
  // Only the displayed revision is read. History focus never reads Today.
  useEffect(()=>{if(!focused||!data||!chosen||view==='history'||full||editor)return;
    const ids=journalRenderedAttentionIds(data,chosen),revision=`${scope}:${chosen.id}:${chosen.answers.map(a=>`${a.id}:${a.updatedAt}`).join('|')}:${ids.join('|')}`;
    if(seen.current===revision)return;
    try{acknowledgeJournal(scope,chosen);markBurrowUpdatesSeen(data,'journal',ids);seen.current=revision;}catch{/* Keep unread if receipt persistence failed. */}
  },[focused,data,chosen,view,scope,full,editor]);
  // Drafting and background saving never lock the page's native exit.
  usePageBackGesture(view!=='detail'&&!full);
  const back=useCallback(()=>{Keyboard.dismiss();if(full){setFull(null);return;}
    if(view==='detail'){setView('history');setEditor(null);return;}
    if(view==='history'&&!historyPage){setView('today');setEditor(null);return;}
    if(leaving.current)return;leaving.current=true;
    if(router.canGoBack())router.back();else router.replace('/(main)/(tabs)/burrow');},[full,view,historyPage]);
  useEffect(()=>{if(!focused)return;const sub=BackHandler.addEventListener('hardwareBackPress',()=>{back();return true;});return()=>sub.remove();},[focused,back]);
  const edit=async(page:CoupleJournalPage)=>{
    const pending=journalJobs().find(j=>j.pageId===page.id);if(pending&&!pending.error){showBurrowToast('Your saved answer is syncing.');return;}
    let answer=page.answers.find(a=>a.authorId===data?.profile.id);
    if(pending?.error){try{const epoch=sessionEpoch(),fresh=await fetchCoupleJournalPage(page.id);
      if(currentScope.current!==scope||epoch!==sessionEpoch()||!alive.current)return;
      answer=fresh.answers.find(a=>a.authorId===data?.profile.id);
      const draft=readBurrowTextDraft(scope,page.id);if(draft)rebaseBurrowTextDraft(scope,page.id,draft.key,answer?.updatedAt??null);
      discardRejectedJournal(pending.key);
      const latest=localCoupleJournal(scope,zone);if(latest)cacheCoupleJournal(scope,{...latest,today:latest.today.id===fresh.id?fresh:latest.today,history:latest.history.map(p=>p.id===fresh.id?fresh:p)});
      setError('Review your draft before replacing the latest answer.');
    }catch{setError('Could not load the latest answer. Your draft is safe.');return;}}
    const draft=readBurrowTextDraft(scope,page.id)??readBurrowTextDraft(scope,localJournalPageId(page.date));
    setEditor({pageId:page.id,body:draft?.body??answer?.body??'',expected:draft?.expectedUpdatedAt??answer?.updatedAt??null});
  };
  const save=()=>{if(!editor||!chosen||editor.pageId!==chosen.id||!editor.body.trim()||!data)return;
    try{configureJournal(data);const draft=keepBurrowTextDraft(scope,chosen.id,editor.body,editor.expected);
      enqueueJournal(scope,chosen,editor.body,draft.expectedUpdatedAt,draft.key);
      Keyboard.dismiss();setEditor(null);setError('');showBurrowToast('Saved');
    }catch{setError('Could not keep this save. Your draft is still available; please try again.');}};
  const unread=new Set(data?unreadBurrowUpdateIds(data,'journal'):[]);
  const unreadPage=(page:CoupleJournalPage)=>!!data&&journalRenderedAttentionIds(data,page).some(id=>unread.has(id));
  const historyDot=!!data&&hasJournalHistoryReminder(data,pages.map(p=>p.id));
  const openHistory=()=>{Keyboard.dismiss();setEditor(null);setView('history');setIndex(0);if(data)dismissJournalHistoryReminder(data,pages.map(p=>p.id));};
  const card=(page:CoupleJournalPage,mine:boolean)=>{
    const person=mine?data?.profile:data?.partner;if(!person)return null;
    const answer=page.answers.find(a=>a.authorId===person.id),editing=mine&&editor?.pageId===page.id;
    const pending=mine?journalJobs().find(j=>j.pageId===page.id):null,name=person.display_name?.trim()||(mine?'You':'Your person');
    const draft=mine?readBurrowTextDraft(scope,page.id)??readBurrowTextDraft(scope,localJournalPageId(page.date)):null;
    return <View key={person.id} style={styles.card}>
      <View style={styles.cardHeading}><UserAvatar userId={person.id} name={name} avatarUrl={person.avatar_url} size={32}/><Text numberOfLines={1} style={styles.name}>{name}</Text>
        {mine&&!!answer&&!editing&&<Pressable accessibilityRole="button" accessibilityLabel="Edit your answer" onPress={()=>void edit(page)} hitSlop={12}><Feather name="edit-2" size={19} color="#8B735B"/></Pressable>}</View>
      <View style={styles.rule}/>
      {editing?<><TextInput accessibilityLabel="Your journal answer" multiline autoFocus maxLength={1500} scrollEnabled textAlignVertical="top"
        value={editor.body} placeholder="Write here..." placeholderTextColor="#978371" style={styles.input}
        onChangeText={body=>{setEditor({...editor,body});try{keepBurrowTextDraft(scope,page.id,body,editor.expected);}catch{setError('Draft could not be kept on this device. Please keep a copy.');}}}/>
        <View style={styles.actions}><Pressable accessibilityRole="button" onPress={()=>{Keyboard.dismiss();setEditor(null);}}><Text style={styles.cancel}>Cancel</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Save journal answer" disabled={!editor.body.trim()} onPress={save} style={[styles.save,!editor.body.trim()&&{opacity:.5}]}><Text style={styles.saveText}>Save</Text></Pressable></View></>
        :<Pressable accessibilityRole="button" accessibilityLabel={answer?'Read full answer':mine?'Write your answer':'Waiting for their words'} disabled={!answer&&!mine}
          onPress={()=>{if(answer){fullScope.current=scope;setFull(answer);}else void edit(page);}} style={styles.bodyArea}>
          <Text numberOfLines={4} ellipsizeMode="tail" style={[styles.body,!answer&&styles.placeholder]}>{answer?.body??(mine?(draft?.body?'Continue your draft…':'Write here...'):'Waiting for their words...')}</Text></Pressable>}
      {!!pending&&<Text style={styles.sync}>{pending.error?'Not shared yet. Tap Edit to review your saved draft.':'Saved on this device · syncing quietly'}</Text>}
    </View>;
  };
  const modalPerson=full?.authorId===data?.profile.id?data?.profile:data?.partner;
  return <View style={styles.root} onLayout={event=>{
    const {width,height}=event.nativeEvent.layout;
    if(width>0&&height>0)setSize(old=>old.width===width&&old.height===height?old:{width,height});
  }}><StatusBar barStyle="light-content"/>
    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}><Image source={BACKGROUND} contentFit="fill" style={StyleSheet.absoluteFillObject}/></View>
    <View pointerEvents="none" style={[styles.arrowMask,layout.arrowMask]}/>
    <ScrollView testID="memories-paper-content" style={[styles.paper,layout.page]}
      automaticallyAdjustContentInsets={false} contentInsetAdjustmentBehavior="never"
      automaticallyAdjustKeyboardInsets={Platform.OS==='ios'} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.paperContent}>
      {view==='history'?<><View style={styles.historyHeading}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous history page" disabled={!pageIndex} onPress={()=>setIndex(pageIndex-1)} style={!pageIndex&&{opacity:.25}}><Feather name="chevron-left" size={24} color="#633C20"/></Pressable>
        <Text style={styles.historyTitle}>HISTORY</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Next history page" disabled={(pageIndex+1)*pageSize>=pages.length}
          style={(pageIndex+1)*pageSize>=pages.length&&{opacity:.25}}
          onPress={()=>{if((pageIndex+1)*pageSize<pages.length)setIndex(pageIndex+1);}}><Feather name="chevron-right" size={24} color="#633C20"/></Pressable></View>
        {pages.slice(pageIndex*pageSize,(pageIndex+1)*pageSize).map(page=><Pressable key={page.id} accessibilityRole="button" accessibilityLabel={`Open page ${page.pageNumber}, ${page.question}`}
          style={styles.historyItem} onPress={()=>{setSelected(page.id);setView('detail');setEditor(null);}}>
          <View style={styles.historyRow}><Text style={styles.pageTag}>Page {page.pageNumber}</Text>{unreadPage(page)&&<View testID={`journal-unread-${page.id}`} style={styles.dot}/>}</View>
          <Text numberOfLines={2} style={styles.historyQuestion}>{page.question}</Text></Pressable>)}
        {!pages.length&&<Text testID="journal-history-empty" style={styles.empty}>No history yet</Text>}</>:chosen?<>
        <Text style={styles.marker}>PAGE {chosen.pageNumber}  ·  {view==='today'&&chosen.id===snapshot?.today.id?'TODAY':chosen.date}</Text>
        <View style={styles.heartRow}><View style={styles.line}/><Text style={styles.heart}>♥</Text><View style={styles.line}/></View>
        <Text style={styles.question}>{chosen.question}</Text>{card(chosen,true)}{!chosen.private&&card(chosen,false)}
      </>:<Text style={styles.empty}>Your journal is preparing. You can go back at any time.</Text>}
      {!!error&&<Pressable accessibilityRole="button" onPress={()=>void load(view==='history'&&!!snapshot?.hasMore)}><Text style={styles.error}>{error}</Text></Pressable>}
    </ScrollView>
    {view!=='history'&&<Text pointerEvents="none" style={[styles.footer,{bottom:insets.bottom+18}]}>New page and question will be ready next day{'\n'}after both sides finish their writing.</Text>}
    <View style={[styles.topBar,{top:insets.top+12}]}><BurrowBackButton light accessibilityLabel="Back" onPress={back}/><Text pointerEvents="none" style={[styles.topTitle,ROOM_TITLE_STYLE]}>Memories Room</Text>
      {view==='today'?<Pressable accessibilityRole="button" accessibilityLabel="Open journal history" style={styles.historyButton} onPress={openHistory}><Feather name="clock" size={26} color="#FFF0DA"/>{historyDot&&<View style={[styles.dot,styles.historyDot]}/>}</Pressable>:<View/>}</View>
    <AppModal visible={!!full} transparent animationType="fade" onRequestClose={()=>setFull(null)}>
      <View style={styles.modalBackdrop}><Pressable accessibilityRole="button" accessibilityLabel="Close full answer" onPress={()=>setFull(null)} style={StyleSheet.absoluteFillObject}/>
        <View style={[styles.modalCard,{maxHeight:height*.8}]}><View style={styles.cardHeading}><UserAvatar userId={full?.authorId} name={modalPerson?.display_name} avatarUrl={modalPerson?.avatar_url} size={36}/><Text style={styles.name}>{modalPerson?.display_name??'Your person'}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close answer" onPress={()=>setFull(null)} hitSlop={12}><Feather name="x" size={24} color="#633C20"/></Pressable></View>
          <Text style={styles.date}>{full?.updatedAt?new Date(full.updatedAt).toLocaleDateString():''}</Text><ScrollView><Text selectable style={styles.fullBody}>{full?.body}</Text></ScrollView>
        </View></View></AppModal>
  </View>;
}
const styles=StyleSheet.create({
  paper:{position:'absolute',overflow:'hidden'},paperContent:{paddingBottom:16},arrowMask:{position:'absolute',backgroundColor:'#3D2517',borderRadius:4},
  root:{flex:1,backgroundColor:'#3D2517'},topBar:{position:'absolute',left:16,right:16,height:44,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},topTitle:{position:'absolute',left:0,right:0,textAlign:'center',color:'#FFF6EB',fontWeight:'600'},historyButton:{width:44,height:44,alignItems:'center',justifyContent:'center'},
  marker:{fontSize:10,letterSpacing:3,color:'#81715F',textAlign:'center'},heartRow:{flexDirection:'row',alignItems:'center',gap:24,marginVertical:16},line:{flex:1,height:1,backgroundColor:'#DCCBBB'},heart:{color:'#FF9FBB',fontSize:31},question:{fontFamily:serif,fontSize:21,lineHeight:27,color:'#38271E',textAlign:'center',marginTop:8,marginBottom:26},
  card:{borderWidth:1,borderColor:'#E5D5C0',borderRadius:12,padding:12,marginTop:12,backgroundColor:'rgba(255,250,241,.33)'},cardHeading:{flexDirection:'row',alignItems:'center',gap:10},name:{flex:1,color:'#231B18',fontSize:16,fontWeight:'600'},rule:{height:1,backgroundColor:'#E2D4C2',marginTop:8,marginBottom:9},
  bodyArea:{minHeight:76},body:{fontSize:15,lineHeight:22,color:'#34271F'},placeholder:{color:'#978371'},input:{height:108,fontSize:15,lineHeight:22,color:'#34271F',padding:0},actions:{flexDirection:'row',alignItems:'center',justifyContent:'flex-end',gap:18,marginTop:8},cancel:{color:'#775746'},save:{backgroundColor:'#59392C',borderRadius:10,paddingHorizontal:18,paddingVertical:9},saveText:{color:'#FFF8EC',fontWeight:'700'},sync:{fontSize:10,color:'#80634E',marginTop:6},
  historyHeading:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:24},historyTitle:{fontSize:17,fontWeight:'700',color:'#211914'},historyItem:{padding:14,backgroundColor:'#DFCDBB',borderRadius:14,marginBottom:14,minHeight:83},historyRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},pageTag:{alignSelf:'flex-start',backgroundColor:'#663B1D',color:'#FFF',fontSize:13,fontWeight:'700',paddingHorizontal:7,paddingVertical:4,borderRadius:5},historyQuestion:{fontSize:14,lineHeight:20,color:'#211914',marginTop:8},
  dot:{width:9,height:9,borderRadius:5,backgroundColor:'#EB4863'},historyDot:{position:'absolute',top:5,right:5},footer:{position:'absolute',left:40,right:25,textAlign:'center',color:'#FFF7EB',fontSize:12,lineHeight:18},empty:{color:'#5F4839',textAlign:'center',marginTop:50},error:{color:'#A23C2B',fontSize:12,marginTop:14,textAlign:'center'},modalBackdrop:{flex:1,backgroundColor:'rgba(47,28,12,.6)',alignItems:'center',justifyContent:'center',padding:24},modalCard:{width:'100%',maxWidth:560,borderRadius:15,backgroundColor:'#FCF8F1',padding:24},fullBody:{fontSize:17,lineHeight:25,color:'#211914',paddingVertical:16},date:{color:'#705840',fontSize:12,textAlign:'right',marginTop:10},
});
