import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, TurboModuleRegistry, View, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BURROW_ART, burrowArtForItem } from '@/lib/burrow-art-assets';
import { roomSlots } from '@/lib/burrow-presentation';
import { interactBurrowToy, refillRoomNeed, saveMemoryRoomEntry } from '@/lib/app-major-update-api';
import { runBurrowAction, useBurrow } from '@/lib/burrow-store';
import { roomPhotoFailureCode, roomPhotoFailureMessage, TOY_PHOTO_DAILY_LIMIT_MESSAGE, TOY_PHOTO_DAILY_LIMIT_TITLE } from '@/lib/room-photo-errors';
import { BurrowBackButton } from '@/components/burrow/burrow-back-button';
import { FeedInteraction, WaterInteraction } from '@/components/burrow/care-interaction';
import { InteractiveDoll, type DollAction } from '@/components/burrow/interactive-doll';
import type { LocalizedToy as LocalizedToyComponent } from '@/components/burrow/localized-toy';
import { pickRoomPhoto, RoomPhotoEditor, uploadRoomPhoto } from '@/components/burrow/room-photo';

type Kind='toy'|'food'|'water'|'frame'|'letter';
const kinds:Kind[]=['toy','food','water','frame','letter'];
// Metro reload cannot add a native module to an already-installed dev app.
// Keep that binary launchable until it is rebuilt with Skia.
let LocalizedToy:typeof LocalizedToyComponent|null=null;
if(Platform.OS==='web'||(globalThis as {SkiaApi?:unknown}).SkiaApi||TurboModuleRegistry.get('RNSkiaModule')){
  try{LocalizedToy=require('@/components/burrow/localized-toy').LocalizedToy;}
  catch{LocalizedToy=null;}
}

function Button({label,onPress,disabled=false,secondary=false}:{label:string;onPress:()=>void;disabled?:boolean;secondary?:boolean}){
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({pressed})=>[styles.button,secondary&&styles.secondary,(disabled||pressed)&&{opacity:.6}]}><Text style={[styles.buttonText,secondary&&{color:'#4C2B1E'}]}>{label}</Text></Pressable>;
}

export default function RoomInteractionScreen(){
  const params=useLocalSearchParams<{kind?:string}>();
  const kind=kinds.includes(params.kind as Kind)?params.kind as Kind:'toy';
  const {data,loading}=useBurrow();
  const insets=useSafeAreaInsets();
  const {width,height}=useWindowDimensions();
  const [photoMode,setPhotoMode]=useState<'camera'|'library'|null>(null);
  const [photoChoiceOpen,setPhotoChoiceOpen]=useState(false);
  const [photoChangeUsed,setPhotoChangeUsed]=useState(false);
  const [action,setAction]=useState<DollAction>();
  const [showToyInfluence,setShowToyInfluence]=useState(false);
  const [completed,setCompleted]=useState(false);
  const [retry,setRetry]=useState(0);
  const [error,setError]=useState<string|null>(null);
  const [letter,setLetter]=useState('');
  const [saving,setSaving]=useState(false);
  const [photoSaving,setPhotoSaving]=useState(false);
  const slots=useMemo(()=>data?roomSlots(data,data.profile.id):{},[data]);
  const toy=burrowArtForItem(slots.couple_doll,'couple_dolls')??BURROW_ART.couple_dolls[0];
  const flower=burrowArtForItem(slots.vase,'vases')??BURROW_ART.vases[0];
  const toyPhoto=data?.roomPhotos?.find(photo=>photo.ownerId===data.profile.id&&photo.kind==='doll');
  const toyPhotoChangeUsed=!!data?.dollChangeUsed||photoChangeUsed;
  const size=Math.min(width-34,Math.max(270,Math.min(height*.51,500)));
  const [left,top,right,bottom]=toy.bounds;
  const scale=Math.min(size/(right-left),size/(bottom-top));
  const artStyle={position:'absolute' as const,left:(size-(right-left)*scale)/2-left*scale,top:(size-(bottom-top)*scale)/2-top*scale,width:toy.width*scale,height:toy.height*scale};
  useEffect(()=>{setCompleted(false);setError(null);setRetry(0);setPhotoMode(null);},[kind]);
  useEffect(()=>setPhotoChangeUsed(false),[data?.profile.id,data?.localDate]);
  function finishCare(which:'food'|'water'){
    if(!data)return;
    setCompleted(true);setError(null);
    // Completion is visible immediately; the server authoritatively checks the
    // need in the background, then a silent refresh reconciles the room.
    void runBurrowAction(`${which}:${data.profile.id}`,key=>refillRoomNeed(data.profile.id,which,key),{silent:true}).then(ok=>{
      if(!ok){setCompleted(false);setRetry(n=>n+1);setError('That did not save. Please try again.');}
    });
  }
  function recordToy(kind?:'squeeze'|'punch'){
    if(!data)return;
    if(kind)setAction(previous=>({kind,token:(previous?.token??0)+1}));
    void runBurrowAction(`toy:${data.profile.id}:${data.localDate}`,key=>interactBurrowToy(key),{silent:true});
  }
  function openToyPhotoChoice(){
    if(toyPhotoChangeUsed){Alert.alert(TOY_PHOTO_DAILY_LIMIT_TITLE,TOY_PHOTO_DAILY_LIMIT_MESSAGE);return;}
    setPhotoChoiceOpen(true);
  }
  async function openPhotoLibrary(){
    if(!data||photoSaving)return;
    if(toyPhotoChangeUsed){Alert.alert(TOY_PHOTO_DAILY_LIMIT_TITLE,TOY_PHOTO_DAILY_LIMIT_MESSAGE);return;}
    setPhotoSaving(true);setError(null);
    try{
      const asset=await pickRoomPhoto('library');
      if(asset){await uploadRoomPhoto(data,data.profile.id,'doll',asset);setPhotoChangeUsed(true);}
    }catch(failure){
      if(roomPhotoFailureCode(failure)==='daily_limit_reached'){
        setPhotoChangeUsed(true);
        Alert.alert(TOY_PHOTO_DAILY_LIMIT_TITLE,TOY_PHOTO_DAILY_LIMIT_MESSAGE);
      }else setError(roomPhotoFailureMessage(failure,'The photo could not be saved. Please choose it again.'));
    }
    finally{setPhotoSaving(false);}
  }
  function selectPhoto(source:'camera'|'library'){
    setPhotoChoiceOpen(false);
    if(toyPhotoChangeUsed){Alert.alert(TOY_PHOTO_DAILY_LIMIT_TITLE,TOY_PHOTO_DAILY_LIMIT_MESSAGE);return;}
    setTimeout(()=>{if(source==='camera')setPhotoMode('camera');else void openPhotoLibrary();},320);
  }
  function saveLetter(){
    if(!letter.trim()||saving)return;
    const text=letter.trim();
    setSaving(true);setCompleted(true);setError(null);
    void runBurrowAction('love-letter',key=>saveMemoryRoomEntry(null,`💌 ${text}`,null,key),{silent:true}).then(ok=>{
      setSaving(false);
      if(!ok){setCompleted(false);setError('Your letter is still here. Check your connection and try saving again.');}
    });
  }
  const title={toy:'Toy',food:'Feed your bunny',water:'Water your plant',frame:'Photo Frame',letter:'Love Note'}[kind];
  if(!data)return <View style={styles.root}><View style={{paddingTop:insets.top+15,paddingHorizontal:18}}><BurrowBackButton onPress={()=>router.back()}/></View><View style={styles.center}>{loading?<ActivityIndicator color="#5C3D2B"/>:<Text style={styles.caption}>Your room could not load. Please try again.</Text>}</View></View>;
  if(kind==='frame')return <View style={[styles.root,{paddingTop:insets.top}]}><RoomPhotoEditor embedded data={data} ownerId={data.profile.id} kind="frame" onClose={()=>router.back()}/></View>;
  return <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined} style={styles.root} keyboardVerticalOffset={0}>
    <View style={[styles.header,{paddingTop:insets.top+12}]}><BurrowBackButton onPress={()=>router.back()}/><Text style={styles.headerTitle}>{title}</Text>{kind==='toy'?<Pressable accessibilityRole="button" accessibilityLabel="Change toy photo" onPress={openToyPhotoChoice} style={styles.headerAction}><Feather name="camera" size={25} color="#4C2B22"/></Pressable>:kind==='letter'?<View style={styles.headerAction}><Feather name="mail" size={26} color="#4C2B22"/></View>:<View style={{width:44}}/>}</View>
    {kind==='toy'?<View style={styles.toyPage}>
      <Text style={styles.title}>{toyPhoto?'Ready to play':'Add your face to play'}</Text>
      {LocalizedToy?<LocalizedToy asset={toy} photo={toyPhoto} size={size} artStyle={artStyle} action={action}
        showInfluence={showToyInfluence} onInteract={()=>recordToy()}/>
        :<InteractiveDoll asset={toy} photo={toyPhoto} style={{width:size,height:size,alignSelf:'center'}} artStyle={artStyle} action={action} onInteract={()=>recordToy()}/>}
      <View style={styles.toyButtons}>{toyPhoto?<><Button label="✋  Squeeze" onPress={()=>recordToy('squeeze')}/><Button label="✊  Punch" onPress={()=>recordToy('punch')}/></>:<Button label={photoSaving?'Saving photo…':'📷  Upload / Take Photo'} disabled={photoSaving} onPress={openToyPhotoChoice}/>}</View>
      {!LocalizedToy&&<Text style={styles.caption}>Rebuild the development app to enable local Toy deformation.</Text>}
      {toyPhoto&&LocalizedToy&&<Pressable accessibilityRole="button" accessibilityLabel="显示影响范围"
        accessibilityState={{selected:showToyInfluence}} onPress={()=>setShowToyInfluence(value=>!value)} style={styles.influenceToggle}>
        <Text style={styles.caption}>{showToyInfluence?'Hide influence area':'Show influence area'}</Text>
      </Pressable>}
      {!toyPhoto&&<Text style={styles.caption}>Align your face inside the toy.</Text>}
    </View>:kind==='food'?<FeedInteraction key={retry} complete={completed} onComplete={()=>finishCare('food')}/>
      :kind==='water'?<WaterInteraction key={retry} flower={flower} complete={completed} onComplete={()=>finishCare('water')}/>
      :<View style={styles.letterPage}>
        <Text style={styles.recipient}>To <Text style={{color:'#4C2B22'}}>{data.partner?.display_name??'my person'}</Text> ❤️</Text>
        <TextInput accessibilityLabel="Love note" multiline value={letter} onChangeText={setLetter} maxLength={500} placeholder="Write something from your heart…" placeholderTextColor="#A79082" style={styles.letterInput} textAlignVertical="top"/>
        <View style={styles.letterCounter}><Text style={styles.counterText}>500 characters max</Text><Text style={styles.counterText}>{letter.length} / 500</Text></View>
        <Pressable accessibilityRole="button" accessibilityState={{disabled:saving||completed||!letter.trim()}} disabled={saving||completed||!letter.trim()} onPress={()=>{Keyboard.dismiss();saveLetter();}} style={[styles.letterSend,(saving||completed||!letter.trim())&&{opacity:.6}]}><Feather name="send" size={23} color="#FFF"/><Text style={styles.buttonText}>{saving?'Sending…':completed?'Saved ✓':data.partner?'Send Love Note':'Save Love Note'}</Text></Pressable>
      </View>}
    {error&&<Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    <View style={{height:insets.bottom}}/>
    <Modal transparent visible={photoChoiceOpen} animationType="fade" presentationStyle="overFullScreen" onRequestClose={()=>setPhotoChoiceOpen(false)}><View style={styles.choiceScrim}><Pressable style={StyleSheet.absoluteFillObject} onPress={()=>setPhotoChoiceOpen(false)}/><View style={styles.choiceCard}><Text style={styles.choiceTitle}>Choose a photo</Text><Text style={styles.caption}>Put your face inside the toy.</Text><Pressable accessibilityRole="button" onPress={()=>selectPhoto('camera')} style={styles.choiceButton}><Text style={styles.buttonText}>Take Photo</Text></Pressable><Pressable accessibilityRole="button" onPress={()=>selectPhoto('library')} style={[styles.choiceButton,styles.choiceButtonSecondary]}><Text style={[styles.buttonText,{color:'#4C2B22'}]}>Photo Library</Text></Pressable><Pressable onPress={()=>setPhotoChoiceOpen(false)} style={styles.choiceCancel}><Text style={styles.counterText}>Cancel</Text></Pressable></View></View></Modal>
    {photoMode&&<RoomPhotoEditor key={`${kind}:${photoMode}:${data.profile.id}`} data={data} ownerId={data.profile.id} kind="doll" toyAsset={toy} initialSource={photoMode} captureOnly onSaved={()=>setPhotoChangeUsed(true)} onDailyLimit={()=>setPhotoChangeUsed(true)} onChooseLibrary={()=>{setPhotoMode(null);setTimeout(()=>void openPhotoLibrary(),320);}} onClose={()=>setPhotoMode(null)}/>}
  </KeyboardAvoidingView>;
}

const styles=StyleSheet.create({
  root:{flex:1,backgroundColor:'#FFFAF2'},center:{flex:1,justifyContent:'center',alignItems:'center'},
  header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:18,paddingBottom:12,borderBottomWidth:1,borderBottomColor:'#E9DED2'},
  headerTitle:{fontSize:23,fontWeight:'800',color:'#3F271B'},headerAction:{width:44,height:44,alignItems:'center',justifyContent:'center'},title:{fontSize:24,fontWeight:'800',color:'#3F271B',textAlign:'center'},caption:{fontSize:15,color:'#8B796B',textAlign:'center',lineHeight:22},
  toyPage:{flex:1,justifyContent:'space-around',paddingHorizontal:20,paddingBottom:24},toyButtons:{flexDirection:'row',gap:12},
  influenceToggle:{alignSelf:'center',paddingVertical:5,paddingHorizontal:12},
  button:{flex:1,minHeight:54,borderRadius:26,backgroundColor:'#4C2B1E',alignItems:'center',justifyContent:'center',paddingHorizontal:18},secondary:{backgroundColor:'#F5DDC1'},buttonText:{fontSize:17,fontWeight:'800',color:'#FFF9F0',textAlign:'center'},
  letterPage:{flex:1,paddingHorizontal:18,paddingTop:30,paddingBottom:18,gap:15},recipient:{fontSize:22,color:'#9D6F5C'},
  letterInput:{flex:1,backgroundColor:'#FFFCF7',borderWidth:1.3,borderColor:'#CB9876',borderRadius:9,padding:20,fontSize:20,lineHeight:29,color:'#3F271B'},
  letterCounter:{flexDirection:'row',justifyContent:'space-between'},counterText:{fontSize:14,color:'#9D6F5C'},letterSend:{minHeight:62,borderRadius:35,backgroundColor:'#4C2B22',flexDirection:'row',alignItems:'center',justifyContent:'center',gap:13},
  choiceScrim:{flex:1,justifyContent:'center',paddingHorizontal:28,backgroundColor:'#21120BCC'},choiceCard:{backgroundColor:'#FFFAF2',padding:24,borderRadius:26,gap:14},choiceTitle:{fontSize:23,fontWeight:'800',color:'#4C2B22',textAlign:'center'},choiceButton:{height:54,borderRadius:28,backgroundColor:'#4C2B22',alignItems:'center',justifyContent:'center'},choiceButtonSecondary:{backgroundColor:'#F5DDC1'},choiceCancel:{alignItems:'center',padding:10},
  error:{textAlign:'center',color:'#A43B27',padding:12},
});
