import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import { usePreventRemove } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import type { MajorUpdateBootstrap, MajorUpdateCatalogItem } from '@/lib/app-major-update-api';
import { giftCollectionModel } from '@/lib/adventure-gift-collection-model';
import { burrowArtForItem } from '@/lib/burrow-art-assets';
import { Image } from './burrow-image';
import { BurrowBackButton } from './burrow-back-button';
import { usePageBackGesture } from '@/lib/use-page-back-gesture';

export function AdventureGiftCollection({data,ownerId,category,onOpenCategory,onBack,onSelect,onPreview,onClose=()=>{},embedded=false}:{
 data:MajorUpdateBootstrap;ownerId:string;category?:string;onOpenCategory:(category:string)=>void;onBack:()=>void;
 onSelect?:(item:MajorUpdateCatalogItem)=>Promise<boolean>|boolean|void;onPreview?:(item:MajorUpdateCatalogItem)=>void;onClose?:()=>void;embedded?:boolean;
}){
 const {width}=useWindowDimensions(),insets=useSafeAreaInsets();
 const [chosen,setChosen]=useState<string|null>(null);
 const [saving,setSaving]=useState(false),[confirmed,setConfirmed]=useState(false),[error,setError]=useState('');
 const alive=useRef(true),locked=useRef(false);
 const scope=`${ownerId}:${data.partner?.id??''}:${data.pairVersion??''}`,scopeRef=useRef(scope);scopeRef.current=scope;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{setChosen(null);setConfirmed(false);setError('');locked.current=false;setSaving(false);},[scope]);
 usePageBackGesture(!saving);
 usePreventRemove(saving,()=>{});
 const model=useMemo(()=>giftCollectionModel(data,ownerId),[data.catalog,data.inventory,data.friends,ownerId]);
 const group=model.categories.find(row=>row.name===category);
 const selected=group?.items.find(item=>item.stable_id===chosen&&model.owned.has(item.stable_id));
 const cardWidth=Math.min(430,width)-(embedded?42:26),cellWidth=(cardWidth-28-24)/3;
 const back=()=>{if(!saving)onBack();};
 async function place(){
  if(!selected||!onSelect||locked.current||confirmed)return;
  const token=scopeRef.current;locked.current=true;setSaving(true);setError('');
  try{const ok=await onSelect(selected);if(!alive.current||scopeRef.current!==token)return;
   if(ok===false)setError('Could not update your shelf. Please try again.');else setConfirmed(true);
  }catch{if(alive.current&&scopeRef.current===token)setError('Could not update your shelf. Please try again.');}
  finally{if(alive.current&&scopeRef.current===token){locked.current=false;setSaving(false);}}
 }
 function art(item:MajorUpdateCatalogItem|null){
  const asset=item?burrowArtForItem(item):null;
  return asset?<Image source={asset.source} contentFit="contain" allowDownscaling style={{width:'88%',height:'88%'}}/>:<Text maxFontSizeMultiplier={1.2} style={[s.question,{fontSize:cellWidth*.62}]}>?</Text>;
 }
 return <View style={[s.root,embedded&&{backgroundColor:'transparent'}]}>
   {!embedded&&<BurrowBackButton accessibilityLabel={group?'Back to gift categories':'Back to Home'} disabled={saving} onPress={back} style={[s.back,{top:insets.top+8}]}/>}
   <View style={[s.paper,{width:cardWidth,marginTop:embedded?0:insets.top+64,marginBottom:embedded?0:Math.max(insets.bottom,16)},embedded&&{paddingTop:4,backgroundColor:'transparent'}]}>
    {!embedded&&<View pointerEvents="none" style={s.tape}><Svg width="100%" height="100%" viewBox="0 0 130 52"><Path d="M7 0H123L130 5V8L125 13L130 18L125 23L130 28L125 33L130 38L125 43L130 48L125 52H5L0 47L5 42L0 37L5 32L0 27L5 22L0 17L5 12L0 7Z" fill="#CD805D"/></Svg></View>}
    {(!embedded||group)&&<View style={s.heading}><Text accessibilityRole="header" maxFontSizeMultiplier={1.25} style={s.title}>{group?.name??'Gifts from Burrow Friends'}</Text>
     {group&&<Text maxFontSizeMultiplier={1.25} style={s.subtitle}>From {group.friendName}</Text>}
    </View>}
    {group?<FlatList key={group.name} data={group.items} numColumns={3} keyExtractor={item=>item.stable_id} extraData={`${chosen}:${saving}`} initialNumToRender={12} maxToRenderPerBatch={9} windowSize={5}
     showsVerticalScrollIndicator={false} contentContainerStyle={s.grid} columnWrapperStyle={s.row} renderItem={({item})=>{
      const found=model.owned.has(item.stable_id),active=chosen===item.stable_id;
      return <Pressable accessibilityRole="button" accessibilityLabel={found?`Select ${item.title}`:'Undiscovered gift'} accessibilityState={{disabled:!found||!onSelect||saving,selected:active}} disabled={!found||!onSelect||saving} onPress={()=>{setChosen(item.stable_id);setError('');}} style={{width:cellWidth}}>
       <View style={[s.tile,{height:cellWidth*1.1},active&&s.selected]}>{art(found?item:null)}{active&&<View style={s.check}><Text style={s.checkText}>✓</Text></View>}</View>
       <Text maxFontSizeMultiplier={1.2} numberOfLines={2} style={[s.label,found&&s.foundLabel]}>{found?item.title:'???'}</Text>
      </Pressable>;
     }}/>:<FlatList key="categories" data={model.categories} numColumns={3} keyExtractor={row=>row.name} initialNumToRender={15} windowSize={5} showsVerticalScrollIndicator={false} contentContainerStyle={s.grid} columnWrapperStyle={s.row} renderItem={({item})=>
      <Pressable accessibilityRole="button" disabled={!item.count} accessibilityState={{disabled:!item.count}} accessibilityLabel={item.count?`Open ${item.name}, ${item.count} of ${item.total} collected`:`Undiscovered category, 0 of ${item.total} collected`} onPress={()=>{if(item.count)onOpenCategory(item.name);}} style={{width:cellWidth}}>
       <View style={[s.tile,{height:cellWidth*.94}]}>{art(item.found)}</View>
       <Text maxFontSizeMultiplier={1.2} numberOfLines={2} style={[s.label,s.foundLabel]}>{item.count?item.name:'???'}</Text><Text maxFontSizeMultiplier={1.2} style={s.count}>{item.count} / {item.total}</Text>
      </Pressable>}/>
    }
    {!!error&&<Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {selected&&onSelect&&<View style={{flexDirection:'row',gap:14}}>
      {onPreview&&<Pressable accessibilityRole="button" accessibilityLabel="Preview" disabled={saving||confirmed} onPress={()=>onPreview(selected)} style={[s.place,{flex:1},(saving||confirmed)&&{opacity:.7}]}><Text style={s.placeText}>Preview</Text></Pressable>}
      <Pressable accessibilityRole="button" accessibilityLabel="Replace" disabled={saving||confirmed} onPress={()=>void place()} style={[s.place,{flex:1,backgroundColor:'#FFC547'},saving&&{opacity:.7}]}>{saving?<ActivityIndicator color="#653721"/>:<Text maxFontSizeMultiplier={1.2} style={[s.placeText,{color:'#251307'}]}>Replace</Text>}</Pressable>
    </View>}
   </View>
   {confirmed&&<View style={s.scrim} accessibilityViewIsModal><View style={s.dialog}>
    <Text accessibilityRole="alert" style={s.message}>You’ve updated the gift on display{`\n`}in your room.</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Done" onPress={onClose} style={s.done}><Text style={s.placeText}>Done</Text></Pressable>
   </View></View>}
  </View>;
}
const s=StyleSheet.create({
 root:{flex:1,backgroundColor:'#874727',alignItems:'center'},back:{position:'absolute',left:18,zIndex:2},
 paper:{flex:1,backgroundColor:'#FFF4DA',borderRadius:24,paddingHorizontal:14,paddingTop:43,paddingBottom:16},tape:{position:'absolute',width:130,height:51,top:-28,alignSelf:'center',zIndex:1},heading:{alignItems:'center',paddingBottom:22,paddingHorizontal:4,minHeight:48},title:{fontSize:18,lineHeight:25,fontWeight:'800',color:'#110F0C',textAlign:'center'},subtitle:{fontSize:16,lineHeight:23,color:'#110F0C',textAlign:'center',marginTop:2},
 grid:{paddingBottom:12,rowGap:18},row:{gap:12},tile:{backgroundColor:'#EFDCC6',borderRadius:16,alignItems:'center',justifyContent:'center',borderWidth:2,borderColor:'transparent',overflow:'hidden'},selected:{borderColor:'#613B27',backgroundColor:'#FFF0C9'},question:{color:'#CEB69D',fontWeight:'700',textAlign:'center'},label:{fontSize:12,lineHeight:17,textAlign:'center',color:'#352112',marginTop:3,minHeight:17},foundLabel:{fontWeight:'700'},count:{fontSize:11,lineHeight:16,textAlign:'center',color:'#9B8267'},check:{position:'absolute',right:5,top:5,width:23,height:23,borderRadius:12,backgroundColor:'#603A25',alignItems:'center',justifyContent:'center'},checkText:{fontSize:16,color:'#FFFFFF',fontWeight:'800'},
 place:{height:44,marginTop:10,borderRadius:15,backgroundColor:'#653721',alignItems:'center',justifyContent:'center'},placeText:{fontSize:18,fontWeight:'700',color:'#FFF8EC',textAlign:'center'},error:{fontSize:12,lineHeight:17,color:'#922F29',textAlign:'center',paddingTop:8},scrim:{...StyleSheet.absoluteFillObject,backgroundColor:'rgba(0,0,0,.58)',alignItems:'center',justifyContent:'center',padding:20},dialog:{width:'100%',maxWidth:410,borderRadius:18,backgroundColor:'#FFF8EC',padding:18,paddingTop:42,shadowColor:'#553521',shadowOpacity:.35,shadowOffset:{width:0,height:4},shadowRadius:0},message:{fontSize:18,lineHeight:27,color:'#15110E',textAlign:'center',marginBottom:32},done:{height:50,borderRadius:10,backgroundColor:'#653721',alignItems:'center',justifyContent:'center',marginBottom:10},
});
