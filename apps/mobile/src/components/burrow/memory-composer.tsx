import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { MajorUpdateBootstrap } from '@/lib/app-major-update-api';
import { dailyMemoryPrompt } from '@/lib/memory-prompt';
import { clearMemoryDraft, copyMemoryJobToDraft, forgetBlockedMemoryJob, queueMemoryDraft, readMemoryLocal, retryMemoryJobs, saveMemoryDraft, useMemoryLocalRevision, type MemoryDraft } from '@/lib/burrow-memory-local';

function Button({title,onPress,disabled=false}:{title:string;onPress:()=>void;disabled?:boolean}) {
  return <Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={[styles.button,disabled&&{opacity:.5}]}><Text style={styles.buttonText}>{title}</Text></Pressable>;
}
const messages:Record<string,string>={
  local_data_unavailable:'Local memories could not be read. They have not been replaced. Please restart and try again.',
  queue_full:'You have 20 pending saves. Wait for them to sync before saving another.',
  entry_pending:'This memory already has a pending save. Your new draft is kept on this device.',
  draft_exists:'There is already a new-memory draft. Save or discard it before copying this text.',
};
export function MemoryComposer({data,entryId,onDone}:{data:MajorUpdateBootstrap;entryId:string|null;onDone:()=>void}) {
  useMemoryLocalRevision();
  const [error,setError]=useState('');
  const [unsaved,setUnsaved]=useState<MemoryDraft|null>(null);
  if(!data.partner)return null;
  const scope={userId:data.profile.id,partnerId:data.partner.id,pairVersion:data.pairVersion};
  let local:ReturnType<typeof readMemoryLocal>;
  try{local=readMemoryLocal(scope);}catch{return <View style={styles.card}><Text accessibilityRole="alert">{messages.local_data_unavailable}</Text></View>;}
  const entry=data.memoryEntries.find(item=>item.id===entryId);
  const prompt=dailyMemoryPrompt(data.memoryPrompts,data.localDate);
  const saved=local.drafts[entryId??'new'];
  const draft=unsaved??saved??{entryId,body:entry?.body??'',promptId:entry?.prompt_id??prompt?.id??null,expectedUpdatedAt:entry?.updated_at??null,revision:''};
  const attempt=(fn:()=>void)=>{try{fn();setError('');}catch(e){const code=e instanceof Error?e.message:'';setError(messages[code]??'Could not save on this device. Keep this screen open and try again.');}};
  return <>
    <View style={styles.card}>
      <Text style={styles.title}>{entryId?'Edit your memory':'A little moment to keep'}</Text>
      <Text style={styles.text}>{data.memoryPrompts.find(p=>p.id===draft.promptId)?.prompt??'What would you like to remember together?'}</Text>
      <TextInput accessibilityLabel="Your memory" multiline maxLength={5000} value={draft.body} onChangeText={body=>{
        const next={...draft,body};setUnsaved(next);
        attempt(()=>{saveMemoryDraft(scope,next);setUnsaved(null);});
      }} placeholder="Start with one little detail…" placeholderTextColor="#9D8470" style={styles.input}/>
      <Text style={styles.text}>{draft.body.length} / 5000 · {unsaved?'Not saved on device':saved?'Draft saved on this device':'Only Save sends your words'}</Text>
      <Text style={styles.text}>Drafts stay here until you tap Save. Pending saves retry when connected. Add photos after your memory appears below.</Text>
      {error?<Text accessibilityRole="alert" style={styles.text}>{error}</Text>:null}
      <Button title="Save memory" disabled={!draft.body.trim()||!!entryId&&!entry} onPress={()=>attempt(()=>{
        const persisted=unsaved||!saved?saveMemoryDraft(scope,draft):saved;
        queueMemoryDraft(scope,persisted);setUnsaved(null);onDone();
      })}/>
      {!!saved&&<Button title="Discard local draft" onPress={()=>Alert.alert('Discard this draft?','This removes only the draft on this device, not a saved memory.',[{text:'Keep draft',style:'cancel'},{text:'Discard',style:'destructive',onPress:()=>attempt(()=>{clearMemoryDraft(scope,entryId);setUnsaved(null);})}])}/>}
      {entryId&&<Button title="Back to new memory · keep draft" onPress={onDone}/>}
    </View>
    {!!local.jobs.length&&<View style={styles.card}>
      <Text style={styles.title}>Pending saves · {local.jobs.length}</Text>
      <Text style={styles.text}>These are saved on this device, not yet confirmed in your shared room. Signing out removes local drafts and pending saves.</Text>
      {local.jobs.map(job=><View key={job.id} style={styles.pending}>
        <Text style={styles.text} numberOfLines={3}>{job.draft.body}</Text>
        <Text style={styles.text}>{job.blocked?`Needs review (${job.error}). The original was not overwritten.`:job.error?'Waiting for connection. Safe to retry.':'Waiting for server confirmation…'}</Text>
        {job.blocked&&<>
          <Button title="Copy text to a new draft" onPress={()=>attempt(()=>{copyMemoryJobToDraft(scope,job.id);onDone();})}/>
          <Text style={styles.text}>Review the room first: saving this copy creates a separate memory.</Text>
          <Button title="Remove pending save" onPress={()=>Alert.alert('Remove pending text?','Copy any text you want to keep first. This does not delete a server memory.',[{text:'Keep',style:'cancel'},{text:'Remove',style:'destructive',onPress:()=>attempt(()=>forgetBlockedMemoryJob(scope,job.id))}])}/>
        </>}
      </View>)}
      {local.jobs.some(j=>!j.blocked)&&<Button title="Retry pending saves" onPress={()=>attempt(()=>retryMemoryJobs(scope))}/>}
    </View>}
  </>;
}
const styles=StyleSheet.create({
  card:{backgroundColor:'#FFF5E5',borderRadius:24,padding:20,gap:12,marginBottom:16},
  title:{fontSize:23,fontWeight:'700',color:'#563B27'},text:{fontSize:16,color:'#64402C',lineHeight:23},
  input:{minHeight:150,color:'#563B27',fontSize:17,textAlignVertical:'top'},
  button:{backgroundColor:'#73462D',padding:14,borderRadius:16,alignItems:'center'},buttonText:{color:'#FFF5E5',fontSize:16,fontWeight:'600'},
  pending:{borderTopWidth:1,borderColor:'#DDC6AC',paddingTop:12,gap:10},
});
