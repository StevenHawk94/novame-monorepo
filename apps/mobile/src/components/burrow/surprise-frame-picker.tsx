import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenOverlay } from '@/components/ui/screen-overlay';
import { hasSeenSurpriseGuide, acknowledgeSurpriseGuide } from '@/lib/surprise-guide';
import { SURPRISE_FRAME_OPTIONS, surpriseFrameName } from '@/lib/surprise-frame-assets';
import type { SurpriseFrame } from '@/lib/surprise-api';
import { Image } from './burrow-image';
import { CoinLabel } from './coin-ui';
import { SurprisePortrait } from './surprise-art';
import { SurprisePlaybackOverlay } from './surprise-playback-overlay';
import { ShopItemPrice } from './shop-item-price';
import { prepareSurprisePreview, useSurprisePreview } from '@/lib/surprise-preview';
import { compareShopOffers } from '@/lib/shop-offer-order';

export function SurpriseFramePicker({userId,frame,photoUri,locked,continueTitle,onSelect,onContinue,offers,hasPlus=false}:{
  userId:string;frame:SurpriseFrame;photoUri?:string;locked?:boolean;continueTitle:string;
  onSelect:(frame:SurpriseFrame)=>void;onContinue:()=>void;
  offers?:Record<string,{price:number;plus_only:boolean}>;
  hasPlus?:boolean;
}){
  const insets=useSafeAreaInsets(),window=useWindowDimensions();
  const previewSize=Math.min(230,window.width*.58,Math.max(110,window.height*.28));
  const thumbnailSize=Math.min(88,(Math.min(window.width,520)-60)/3-3);
  const [guide,setGuide]=useState(()=>!hasSeenSurpriseGuide(userId));
  const [quickPreview,setQuickPreview]=useState(false);
  const [previewError,setPreviewError]=useState(false);
  const portrait=useSurprisePreview(frame,undefined,undefined,quickPreview),previewRequest=useRef(0),previewFrame=useRef(frame);previewFrame.current=frame;
  useEffect(()=>{return()=>{previewRequest.current++;};},[]);
  async function preview(){
    if(AppState.currentState!=='active')return;
    setPreviewError(false);
    const request=++previewRequest.current,selected=frame;
    try{await prepareSurprisePreview(selected);if(request===previewRequest.current&&selected===previewFrame.current&&AppState.currentState==='active')setQuickPreview(true);}catch{if(request===previewRequest.current)setPreviewError(true);}
  }
  useEffect(()=>{previewRequest.current++;setQuickPreview(false);setPreviewError(false);},[frame]);
  useEffect(()=>{const app=AppState.addEventListener('change',state=>{if(state!=='active'){previewRequest.current++;setQuickPreview(false);}});return()=>app.remove();},[]);
  useEffect(()=>{
    if(!quickPreview)return;
    const timer=setTimeout(()=>setQuickPreview(false),3000);
    const app=AppState.addEventListener('change',state=>{if(state!=='active')setQuickPreview(false);});
    return()=>{clearTimeout(timer);app.remove();};
  },[quickPreview]);
  const dismissGuide=()=>{acknowledgeSurpriseGuide(userId);setGuide(false);};
  return <View style={s.root}>
    <View style={s.preview}>
      <Text style={s.hint}>Tap the head for a quick preview</Text>
      {previewError&&<Text accessibilityRole="alert" style={s.hint}>Preview could not load. Tap to try again.</Text>}
      <Pressable accessibilityRole="button" accessibilityLabel="Quick surprise preview" onPress={()=>void preview()}>
        <SurprisePortrait frame={frame} uri={photoUri} size={previewSize}/>
      </Pressable>
      <Text accessibilityRole="header" style={s.heading}>Choose your frame</Text>
    </View>
    {/* Only this region scrolls. The preview and CTA stay in view. */}
    <FlatList style={s.list} contentContainerStyle={s.grid} columnWrapperStyle={s.gridRow} numColumns={3}
      initialNumToRender={3} maxToRenderPerBatch={2} windowSize={3}
      data={SURPRISE_FRAME_OPTIONS.filter(option=>offers?.[option.id])
        .sort((a,b)=>compareShopOffers(offers![a.id],offers![b.id]))} keyExtractor={option=>option.id}
      ListEmptyComponent={!offers?<ActivityIndicator color="#FFF8EC" accessibilityLabel="Loading frame prices"/>:null}
      showsVerticalScrollIndicator bounces={false} overScrollMode="never"
      renderItem={({item:option})=><Pressable accessibilityRole="button"
        accessibilityLabel={`${surpriseFrameName(option.id)} frame`} accessibilityState={{selected:frame===option.id}}
        disabled={!!locked} onPress={()=>onSelect(option.id)} style={({pressed})=>[s.frame,frame===option.id&&s.selected,pressed&&{opacity:.8}]}>
        <Image source={option.source} contentFit="contain" style={{width:thumbnailSize,height:thumbnailSize}}/>
        {frame===option.id&&<View style={s.check}><Feather name="check" size={12} color="#FFFFFF"/></View>}
        <Text style={s.label}>{surpriseFrameName(option.id)}</Text>
        <View style={s.offer}><ShopItemPrice item={offers![option.id]}
          hasPlus={hasPlus} owned={false} fontSize={14} numberColor="#FFFFFF"/></View>
      </Pressable>}/>
    <View style={[s.footer,{paddingBottom:insets.bottom+12}]}>
      {offers?.[frame]?.plus_only&&!hasPlus?<View style={s.footerOffer}><ShopItemPrice item={offers[frame]} hasPlus={false} owned={false} fontSize={12}/>
        <Text style={s.price}>Preview & replay are free</Text></View>
      :offers?.[frame]?<CoinLabel iconSize={14} style={s.price}>{`{coin} ${offers[frame].price} per send · Preview & replay are free`}</CoinLabel>:<Text style={s.price}>Choose an available frame</Text>}
      <Pressable accessibilityRole="button" accessibilityLabel={continueTitle} onPress={onContinue}
        disabled={!offers?.[frame]} style={({pressed})=>[s.button,(pressed||!offers?.[frame])&&{opacity:.8}]}><Text style={s.buttonText}>{continueTitle}</Text></Pressable>
    </View>
    {quickPreview&&<SurprisePlaybackOverlay visible frame={frame} portraitUri={portrait} playing closeLabel="Close quick preview"
      onClose={()=>setQuickPreview(false)}/>}
    <ScreenOverlay visible={guide} transparent onRequestClose={dismissGuide}>
      <View style={[s.scrim,{paddingTop:insets.top+20,paddingBottom:insets.bottom+20}]}>
        <View style={[s.guide,{maxHeight:window.height-insets.top-insets.bottom-40}]}>
          <ScrollView style={{flexShrink:1}} contentContainerStyle={s.guideCopy}>
            <View style={s.guideTitleRow}><Text accessibilityRole="header" style={s.guideTitle}>How it works:</Text><Feather name="star" size={32} color="#D99B38"/></View>
            <Text style={s.steps}>1. Choose a frame{'\n'}2. Add your face{'\n'}3. Record your voice</Text>
            <Text style={s.guideText}>We’ll turn it into a surprise for your person.</Text>
          </ScrollView>
          <Pressable accessibilityRole="button" accessibilityLabel="OK" onPress={dismissGuide} style={s.guideButton}><Text style={s.guideButtonText}>OK</Text></Pressable>
        </View>
      </View>
    </ScreenOverlay>
  </View>;
}
const s=StyleSheet.create({
  root:{flex:1,width:'100%',maxWidth:520,alignSelf:'center'},
  preview:{alignItems:'center',paddingHorizontal:20,paddingBottom:12,gap:8,flexShrink:0},
  hint:{fontSize:15,lineHeight:22,textAlign:'center',color:'#FFF0DA'},
  heading:{fontSize:23,fontWeight:'700',color:'#FFF0DA',textAlign:'center'},
  list:{flex:1,minHeight:0},grid:{paddingHorizontal:20,paddingVertical:8,gap:10},gridRow:{justifyContent:'space-between',gap:10},
  frame:{width:'31%',alignItems:'center',borderWidth:1.5,borderColor:'transparent',borderRadius:17,paddingBottom:8,backgroundColor:'#c69063'},
  selected:{borderColor:'#FFFFFF'},check:{position:'absolute',right:5,top:5,backgroundColor:'#4A2917',borderRadius:12,padding:4},
  label:{color:'#FFFFFF',fontSize:13,lineHeight:18,textAlign:'center',paddingHorizontal:3},
  offer:{minHeight:28,justifyContent:'center',alignItems:'center',marginTop:2},footerOffer:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10},
  footer:{paddingTop:10,paddingHorizontal:20,gap:8,flexShrink:0},price:{fontSize:11,lineHeight:16,textAlign:'center',color:'#FFFFFF'},
  button:{backgroundColor:'#FFF0DA',minHeight:56,borderRadius:30,alignItems:'center',justifyContent:'center',paddingHorizontal:20},
  buttonText:{fontWeight:'700',fontSize:18,color:'#4A2917',textAlign:'center'},
  scrim:{flex:1,justifyContent:'center',alignItems:'center',paddingHorizontal:28,backgroundColor:'#180B09A6'},
  guide:{width:'100%',maxWidth:390,backgroundColor:'#FFF8EC',borderRadius:30,padding:28,gap:24},guideCopy:{gap:22},
  guideTitleRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},guideTitle:{fontSize:25,fontWeight:'800',color:'#19120E',flexShrink:1},
  steps:{fontSize:18,lineHeight:28,color:'#251A13'},guideText:{fontSize:15,lineHeight:22,color:'#251A13'},
  guideButton:{backgroundColor:'#4A2917',borderRadius:17,minHeight:48,width:'75%',alignSelf:'center',alignItems:'center',justifyContent:'center'},guideButtonText:{color:'#FFF8EC',fontSize:16,fontWeight:'700'},
});
