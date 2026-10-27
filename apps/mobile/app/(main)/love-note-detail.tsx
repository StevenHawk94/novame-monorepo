import {ActivityIndicator,StyleSheet,Text,View} from 'react-native';
import {router,useLocalSearchParams} from 'expo-router';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useBurrow} from '@/lib/burrow-store';
import {attentionScope} from '@/lib/burrow-attention';
import {LoveNoteScreen} from '@/components/burrow/love-note-screen';
import {BurrowBackButton} from '@/components/burrow/burrow-back-button';

export default function LoveNoteDetail(){
  const {id}=useLocalSearchParams<{id?:string}>(),{data,loading}=useBurrow(),insets=useSafeAreaInsets();
  if(data&&id)return <LoveNoteScreen key={`${attentionScope(data)}:${id}`} data={data} noteId={id}/>;
  return <View style={styles.root}><View style={{paddingTop:insets.top+10,paddingHorizontal:18}}><BurrowBackButton onPress={()=>router.back()}/></View><View style={styles.center}>{loading?<ActivityIndicator color="#4C2B22"/>:<Text>This note could not load. Please try again.</Text>}</View></View>;
}
const styles=StyleSheet.create({root:{flex:1,backgroundColor:'#FFFAF2'},center:{flex:1,alignItems:'center',justifyContent:'center'}});
