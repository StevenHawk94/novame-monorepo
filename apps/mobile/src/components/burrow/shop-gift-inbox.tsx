import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import {AppModal as Modal} from '@/components/layout/app-modal';
import { useIsFocused } from '@react-navigation/native';
import type { MajorUpdateBootstrap, MajorUpdateCatalogItem } from '@/lib/app-major-update-api';
import { useNotificationContentReady } from '@/lib/burrow-attention';
import { notificationScope } from '@/lib/notification-content-version';
import { pendingShopGifts, shopGiftItem } from '@/lib/shop-gift-model';
import { claimShopGiftLocally } from '@/lib/burrow-store';
import { registerOverlay } from '@/lib/overlay-presence';
import { preparedShopGiftIds } from '@/lib/shop-gift-preparation';

function GiftCard({data,gift,item,artwork}:{data:MajorUpdateBootstrap;gift:MajorUpdateBootstrap['gifts'][number];item:MajorUpdateCatalogItem;artwork:ReactNode}) {
  const [replace,setReplace]=useState(false),[error,setError]=useState('');
  const tapped=useRef(false);
  const replaceable=['decor','outfit'].includes(item.item_type)&&!!item.metadata.slot&&(!item.status||item.status==='active');
  return <View style={s.card} accessibilityViewIsModal>
    <Text style={s.title}>{`${data.partner?.display_name?.trim()||'Your partner'} sent you a gift`}</Text>
    <View style={s.art}>{artwork}</View>
    <Text style={s.name}>{item.title}</Text>
    {!!error&&<Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    <Pressable accessibilityRole="button" accessibilityLabel="Claim gift" onPress={()=>{
      if(tapped.current)return;tapped.current=true;
      try{claimShopGiftLocally(gift.id,replace);}catch{tapped.current=false;setError('Could not save your claim. Please try again.');}
    }} style={({pressed})=>[s.claim,pressed&&{transform:[{translateY:3}],opacity:.85}]}>
      <Text style={s.claimText}>Claim</Text>
    </Pressable>
    {replaceable&&<Pressable accessibilityRole="checkbox" accessibilityState={{checked:replace}} accessibilityLabel="Also replace"
      onPress={()=>setReplace(value=>!value)} style={s.checkRow}>
      <View style={[s.check,replace&&s.checked]}>{replace&&<Text style={s.tick}>✓</Text>}</View>
      <Text style={s.checkText}>Also replace</Text>
    </Pressable>}
  </View>;
}
export function ShopGiftInbox({data,artwork}:{data:MajorUpdateBootstrap;artwork:(item:MajorUpdateCatalogItem,size:number)=>ReactNode}) {
  const focused=useIsFocused(),ready=useNotificationContentReady(data,'gifts');
  const [active,setActive]=useState(AppState.currentState==='active');
  const {height}=useWindowDimensions();
  useEffect(()=>{const sub=AppState.addEventListener('change',state=>setActive(state==='active'));return()=>sub.remove();},[]);
  const ids=ready?new Set(preparedShopGiftIds(data)):new Set<string>();
  const gift=ready?pendingShopGifts(data).find(row=>ids.has(row.id)):null;
  const item=gift?shopGiftItem(data,gift.item_id):null;
  const visible=focused&&active&&!!gift&&!!item;
  useEffect(()=>{if(visible)return registerOverlay({});},[visible]);
  if(!focused||!active||!gift||!item)return null;
  return <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={()=>{}}>
    <View style={s.backdrop}>
      <ScrollView bounces={false} contentContainerStyle={s.viewport} style={{maxHeight:height-64}}>
        <GiftCard key={`${notificationScope(data)}:${gift.id}`} data={data} gift={gift} item={item} artwork={artwork(item,150)}/>
      </ScrollView>
    </View>
  </Modal>;
}
const s=StyleSheet.create({
  backdrop:{flex:1,backgroundColor:'rgba(0,0,0,.65)',justifyContent:'center',paddingHorizontal:16,paddingVertical:32},
  viewport:{flexGrow:1,justifyContent:'center'},
  card:{backgroundColor:'#FFF9EF',borderRadius:26,paddingHorizontal:22,paddingTop:36,paddingBottom:16,alignItems:'center',width:'100%',maxWidth:520,alignSelf:'center'},
  title:{fontSize:22,fontWeight:'800',color:'#21140F',textAlign:'center'},
  art:{marginTop:24,alignItems:'center',justifyContent:'center'},name:{fontSize:17,color:'#21140F',textAlign:'center',marginTop:12},
  claim:{backgroundColor:'#68321B',borderRadius:12,minHeight:58,width:'100%',marginTop:36,alignItems:'center',justifyContent:'center'},
  claimText:{color:'#FFF',fontSize:23,fontWeight:'800'},checkRow:{flexDirection:'row',alignItems:'center',justifyContent:'center',minHeight:44,marginTop:12,gap:10},
  check:{width:22,height:22,borderRadius:6,borderWidth:2,borderColor:'#B5A99B',alignItems:'center',justifyContent:'center'},
  checked:{backgroundColor:'#FF7C21',borderColor:'#FF7C21'},tick:{fontSize:19,lineHeight:20,color:'#FFF',fontWeight:'900'},checkText:{fontSize:18,color:'#21140F'},
  error:{fontSize:14,color:'#9E3925',textAlign:'center',marginTop:12},
});
