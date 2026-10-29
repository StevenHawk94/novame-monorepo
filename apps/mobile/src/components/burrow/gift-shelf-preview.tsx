import {useEffect,useMemo,useRef,useState} from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {usePreventRemove} from '@react-navigation/native';
import type {MajorUpdateBootstrap} from '@/lib/app-major-update-api';
import {selectAdventureGift} from '@/lib/app-major-update-api';
import {confirmBurrowShelfGift,getBurrowSnapshot,runBurrowAction} from '@/lib/burrow-store';
import {sessionEpoch} from '@/lib/session-lifecycle';
import {giftCollectionModel} from '@/lib/adventure-gift-collection-model';
import {roomSlots} from '@/lib/burrow-presentation';
import {burrowArtForItem} from '@/lib/burrow-art-assets';
import {usePageBackGesture} from '@/lib/use-page-back-gesture';
import {HomeArtPreview} from './home-art-preview';
import {Image} from './burrow-image';

/** A local-only shelf draft. No unowned gifts or furniture controls enter here. */
export function GiftShelfPreview({data,initialItemId,onClose}:{data:MajorUpdateBootstrap;initialItemId?:string;onClose:()=>void}){
 const insets=useSafeAreaInsets(),{height}=useWindowDimensions();
 const owned=useMemo(()=>{
  const model=giftCollectionModel(data,data.profile.id);
  return model.categories.flatMap(group=>group.items.filter(item=>model.owned.has(item.stable_id)));
 },[data.catalog,data.inventory,data.friends,data.profile.id]);
 const saved=useMemo(()=>roomSlots(data,data.profile.id),[data]);
 const [selected,setSelected]=useState(initialItemId??saved.shelf_decor?.stable_id);
 const item=owned.find(item=>item.stable_id===selected),inUse=item?.stable_id===saved.shelf_decor?.stable_id;
 const [saving,setSaving]=useState(false),[done,setDone]=useState(false),[error,setError]=useState('');const locked=useRef(false),alive=useRef(true),closing=useRef(false),epoch=useRef(sessionEpoch()).current;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{if(done&&!saving&&!closing.current){closing.current=true;onClose();}},[done,saving,onClose]);
 const current=()=>{const latest=getBurrowSnapshot().data;return alive.current&&epoch===sessionEpoch()&&latest?.profile.id===data.profile.id&&latest.partner?.id===data.partner?.id&&latest.pairVersion===data.pairVersion;};
 usePreventRemove(saving,()=>{});usePageBackGesture(!saving);
 async function replace(){
  if(!item||inUse||locked.current||!current())return;
  locked.current=true;setSaving(true);setError('');
  try{const ok=await runBurrowAction('select-adventure-gift',()=>selectAdventureGift(item.stable_id),{silent:true});
   if(!current())return;
   if(ok){confirmBurrowShelfGift(data.profile.id,item.stable_id);setDone(true);}else setError('Could not update your shelf. Please try again.');
  }catch{if(current())setError('Could not update your shelf. Please try again.');}
  finally{if(alive.current){locked.current=false;setSaving(false);}}
 }
 return <View style={[s.root,{paddingTop:insets.top,paddingBottom:insets.bottom}]}>
  <View style={s.header}><Pressable accessibilityRole="button" accessibilityLabel="Cancel gift preview" disabled={saving} onPress={onClose}><Text style={s.text}>‹ Cancel</Text></Pressable>
   <Text style={s.title}>Decorate</Text><Pressable accessibilityRole="button" disabled={!item||inUse||saving} onPress={()=>void replace()} style={[s.replace,(!item||inUse||saving)&&{opacity:.45}]}><Text style={s.white}>{inUse?'In use':'Replace'}</Text></Pressable></View>
  <View style={{flex:1}}><HomeArtPreview timeZone={data.profile.timezone_name} ownerId={data.profile.id} photos={data.roomPhotos} away={false}
   slots={item?{...saved,shelf_decor:item}:saved} availableHeight={Math.max(200,height-insets.top-insets.bottom-290)}/></View>
  <Text style={s.label}>Gifts from Burrow Friends</Text>
  <FlatList horizontal directionalLockEnabled bounces={false} alwaysBounceVertical={false} showsHorizontalScrollIndicator={false} style={{flexGrow:0,height:164}}
   initialNumToRender={6} maxToRenderPerBatch={6} windowSize={5} getItemLayout={(_,index)=>({length:132,offset:index*132,index})}
   initialScrollIndex={Math.max(0,owned.findIndex(item=>item.stable_id===initialItemId))}
   contentContainerStyle={{paddingHorizontal:16,gap:12}} data={owned} keyExtractor={item=>item.stable_id} extraData={selected}
   renderItem={({item})=>{const art=burrowArtForItem(item);return <Pressable accessibilityRole="button" accessibilityLabel={`Preview ${item.title}`} accessibilityState={{selected:selected===item.stable_id}}
    disabled={saving} onPress={()=>{setSelected(item.stable_id);setError('');}} style={[s.card,selected===item.stable_id&&{borderColor:'#B94F29'}]}>
     {art&&<Image source={art.source} contentFit="contain" style={{width:90,height:100}}/>}<Text numberOfLines={2} style={s.item}>{item.title}</Text></Pressable>;}}/>
  {!!error&&<Text accessibilityRole="alert" style={s.error}>{error}</Text>}
 </View>;
}
const s=StyleSheet.create({root:{flex:1,backgroundColor:'#FFF8EC'},header:{height:72,paddingHorizontal:18,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},text:{fontSize:17,fontWeight:'700',color:'#4B2918'},title:{fontSize:23,fontWeight:'800',color:'#4B2918'},replace:{padding:12,borderRadius:14,backgroundColor:'#B94F29'},white:{fontWeight:'800',color:'#FFF8EC'},label:{fontSize:18,fontWeight:'800',color:'#4B2918',padding:16},card:{width:120,height:148,padding:8,alignItems:'center',borderWidth:2,borderColor:'#EADCCC',borderRadius:16},item:{textAlign:'center',fontWeight:'700',color:'#4B2918'},error:{color:'#A23824',padding:12}});
