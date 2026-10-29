import {useCallback,useRef,useState} from 'react';
import { AppState, FlatList, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import {AppModal as Modal} from '@/components/layout/app-modal';
import {router,useFocusEffect} from 'expo-router';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Image} from '@/components/burrow/burrow-image';
import {BurrowBackButton} from '@/components/burrow/burrow-back-button';
import {useBurrow} from '@/lib/burrow-store';
import {apiClient} from '@/lib/api';
import {withDeadline} from '@/lib/async-lifecycle';
import {sessionEpoch,subscribeSessionIdentity} from '@/lib/session-lifecycle';

type Photo={id:string;createdAt:string;url:string;expiresAt:number};
type Cursor={createdAt:string;id:string};
type Page={items:Photo[];hasPlus:boolean;nextCursor:Cursor|null};
const cache=new Map<string,Page>();
subscribeSessionIdentity(()=>cache.clear());
const visible=(items:Photo[],paid:boolean)=>items.filter(item=>paid||Date.parse(item.createdAt)>=Date.now()-7*86400000);
export default function FramePhotoHistory(){
 const {data}=useBurrow(),insets=useSafeAreaInsets(),{width}=useWindowDimensions();
 const owner=data?.profile.id??'',paid=!!data?.hasPlus;
 const [page,setPage]=useState<Page>(()=>cache.get(owner)??{items:[],hasPlus:paid,nextCursor:null});
 const [pageOwner,setPageOwner]=useState(owner);
 const [selected,setSelected]=useState<Photo|null>(null),[error,setError]=useState('');
 const [more,setMore]=useState(false);
 const renewals=useRef(new Set<string>());
 const renewalAttempts=useRef(new Map<string,number>());
 useFocusEffect(useCallback(()=>{
  let alive=true;const epoch=sessionEpoch();
  renewalAttempts.current.clear();
  setPage(cache.get(owner)??{items:[],hasPlus:paid,nextCursor:null});setPageOwner(owner);setSelected(null);setError('');
  let fetching=false;
  const refresh=()=>{
   if(fetching||AppState.currentState!=='active')return;fetching=true;
   void withDeadline(apiClient.get<Page>('/api/vnext/room-photo?mode=history')).then(result=>{
    if(!alive||epoch!==sessionEpoch())return;
    setPage(previous=>{
     // Updating signed URLs must not collapse a paginated list while scrolling.
     const oldest=result.items.at(-1)?.createdAt;
     const older=oldest?visible(previous.items,result.hasPlus).filter(item=>Date.parse(item.createdAt)<Date.parse(oldest)):[];
     const next=older.length?{...result,items:[...result.items,...older],nextCursor:previous.nextCursor}:result;
     cache.set(owner,next);return next;
    });setError('');
   }).catch(()=>{if(alive&&epoch===sessionEpoch())setError('History could not refresh. Reopen this page to retry.');}).finally(()=>{fetching=false;});
  };
  refresh();const timer=setInterval(refresh,60_000),app=AppState.addEventListener('change',state=>{if(state==='active')refresh();});
  return()=>{alive=false;clearInterval(timer);app.remove();};
 },[owner,paid]));
 async function renewPhoto(photo:Photo){
  if(renewals.current.has(photo.id)||(renewalAttempts.current.get(photo.id)??0)>=2)return;
  renewalAttempts.current.set(photo.id,(renewalAttempts.current.get(photo.id)??0)+1);
  renewals.current.add(photo.id);const epoch=sessionEpoch();
  try{
   // A normal owner-scoped history page includes this photo; clients never
   // submit a private Storage path or grant access by guessing a photo ID.
   const before=new Date(Date.parse(photo.createdAt)+1).toISOString();
   const next=await withDeadline(apiClient.get<Page>(`/api/vnext/room-photo?mode=history&before=${encodeURIComponent(before)}&beforeId=ffffffff-ffff-4fff-8fff-ffffffffffff`));
   if(epoch!==sessionEpoch())return;
   setPage(previous=>{const result={...previous,hasPlus:next.hasPlus,items:previous.items.map(item=>next.items.find(fresh=>fresh.id===item.id)??item)};cache.set(owner,result);return result;});
  }catch{if(epoch===sessionEpoch())setError('This photo could not load. Reopen History to retry.');}
  finally{renewals.current.delete(photo.id);}
 }
 async function loadMore(){
  if(more||!page.nextCursor)return;setMore(true);const epoch=sessionEpoch(),cursor=page.nextCursor;
  try{const next=await withDeadline(apiClient.get<Page>(`/api/vnext/room-photo?mode=history&before=${encodeURIComponent(cursor.createdAt)}&beforeId=${cursor.id}`));
   if(epoch!==sessionEpoch())return;
   setPage(previous=>{const result={...next,items:[...previous.items,...next.items.filter(item=>!previous.items.some(old=>old.id===item.id))]};cache.set(owner,result);return result;});
  }catch{if(epoch===sessionEpoch())setError('Could not load more photos. Try again.');}finally{if(epoch===sessionEpoch())setMore(false);}
 }
 const items=pageOwner===owner?visible(page.items,paid&&page.hasPlus):[],size=(Math.min(width,600)-52)/3;
 return <View style={[s.root,{paddingTop:insets.top+12}]}>
  <View style={s.header}><BurrowBackButton onPress={()=>router.back()}/><Text style={s.title}>Photo History</Text><View style={{width:44}}/></View>
  {!(paid&&page.hasPlus)&&<View style={s.banner}><Text style={s.copy}>Photos older than 7 days are hidden. Join Plus to unlock unlimited photo history!</Text>
   <Pressable accessibilityRole="button" style={s.join} onPress={()=>router.push('/(main)/(modals)/subscription-paywall')}><Text style={s.joinText}>Join Plus</Text></Pressable>
   <Text style={s.note}>Free photos older than 30 days are deleted, except the current photo in your frame. Deleted photos cannot be restored.</Text></View>}
  {error!==''&&<Text accessibilityRole="alert" style={s.copy}>{error}</Text>}
  <FlatList data={items} numColumns={3} keyExtractor={item=>item.id} contentContainerStyle={[s.grid,{paddingBottom:insets.bottom+20}]} columnWrapperStyle={{gap:10}}
   renderItem={({item})=><Pressable accessibilityRole="button" accessibilityLabel={`Photo from ${new Date(item.createdAt).toLocaleDateString()}`} onPress={()=>setSelected(item)} style={{width:size,gap:6}}>
    <Image source={{uri:item.url,cacheKey:item.id}} onError={()=>void renewPhoto(item)} cachePolicy="memory" contentFit="cover" style={{width:size,height:size/0.693,borderRadius:12}}/>
    <Text style={s.date}>{new Date(item.createdAt).toLocaleDateString()}</Text></Pressable>}
   ListEmptyComponent={<Text style={[s.copy,{marginTop:40,textAlign:'center'}]}>Your saved frame photos will appear here.</Text>}
   ListFooterComponent={page.nextCursor?<Pressable disabled={more} style={s.join} onPress={()=>void loadMore()}><Text style={s.joinText}>{more?'Loading more…':'More photos'}</Text></Pressable>:null}/>
  <Modal visible={!!selected} transparent animationType="fade" onRequestClose={()=>setSelected(null)}><View style={s.preview}>
   <Pressable accessibilityLabel="Close photo" accessibilityRole="button" style={[s.close,{top:insets.top+16}]} onPress={()=>setSelected(null)}><Text style={s.joinText}>Close</Text></Pressable>
   {selected&&pageOwner===owner&&<Image source={{uri:selected.url,cacheKey:selected.id}} cachePolicy="memory" contentFit="contain" style={{width:'100%',height:'80%'}}/>}
  </View></Modal>
 </View>;
}
const s=StyleSheet.create({root:{flex:1,backgroundColor:'#FFF9EF'},header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:18,paddingBottom:18},title:{fontSize:24,fontWeight:'800',color:'#4C2B22'},banner:{marginHorizontal:16,marginBottom:20,padding:18,gap:14,borderRadius:20,backgroundColor:'#F3E8D8'},copy:{color:'#4C2B22',fontSize:16,lineHeight:23,paddingHorizontal:16},note:{color:'#806A5B',fontSize:12,lineHeight:18},join:{alignSelf:'center',backgroundColor:'#66341F',borderRadius:25,paddingHorizontal:30,paddingVertical:12,marginVertical:8},joinText:{color:'#FFF9EF',fontSize:17,fontWeight:'700'},grid:{paddingHorizontal:16,gap:18,maxWidth:600,alignSelf:'center',width:'100%'},date:{color:'#806A5B',fontSize:11,textAlign:'center'},preview:{flex:1,backgroundColor:'#000E',justifyContent:'center'},close:{position:'absolute',right:22,zIndex:1,padding:12}});
