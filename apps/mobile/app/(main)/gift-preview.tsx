import {router,useLocalSearchParams} from 'expo-router';
import {GiftShelfPreview} from '@/components/burrow/gift-shelf-preview';
import {useBurrow} from '@/lib/burrow-store';
export default function GiftPreview(){
 const {itemId}=useLocalSearchParams<{itemId?:string}>(),{data}=useBurrow();
 return data?<GiftShelfPreview key={`${data.profile.id}:${data.partner?.id??''}:${data.pairVersion??''}`} data={data} initialItemId={itemId} onClose={()=>router.back()}/>:null;
}
