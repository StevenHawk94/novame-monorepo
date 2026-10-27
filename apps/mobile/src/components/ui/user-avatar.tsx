import {useEffect,useState,useSyncExternalStore} from 'react';
import {Text,View,type StyleProp,type ViewStyle} from 'react-native';
import { Image } from 'expo-image';

import {initialAvatar,uploadedAvatarUri,subscribeAvatarIdentity,avatarIdentityRevision} from '@/lib/avatar';
import {localProfileAvatarUri,subscribeLocalProfileAvatar} from '@/lib/profile-avatar-local';

/**
 * Circular user avatar: the uploaded photo when the user actually set one
 * or a native name initial on a stable, pair-distinct background.
 * Legacy bundled-avatar IDs never enter the image loader.
 */
export function UserAvatar({
  userId,
  name,otherUserId,style,
  avatarUrl,
  isDefaultAvatar,
  size = 46,
}: {
  userId: string | null | undefined;
  name?:string|null;otherUserId?:string|null;style?:StyleProp<ViewStyle>;
  avatarUrl?: string | null;
  isDefaultAvatar?: boolean | null;
  size?: number;
}) {
  useSyncExternalStore(subscribeAvatarIdentity,avatarIdentityRevision,avatarIdentityRevision);
  const local=useSyncExternalStore(subscribeLocalProfileAvatar,()=>localProfileAvatarUri(userId,avatarUrl),()=>null);
  const [failedLocal,setFailedLocal]=useState(false);
  useEffect(()=>setFailedLocal(false),[local]);
  const uri=(!failedLocal?local:null)??uploadedAvatarUri(avatarUrl,isDefaultAvatar),[failed,setFailed]=useState(false);
  useEffect(()=>setFailed(false),[uri]);
  const fallback=initialAvatar(userId,name,otherUserId);
  return <View accessibilityLabel={name?`${name} avatar`:'Profile avatar'} style={[{width:size,height:size,borderRadius:size/2,overflow:'hidden',alignItems:'center',justifyContent:'center',backgroundColor:fallback.backgroundColor},style]}>
    {uri&&!failed?<Image source={{uri}} cachePolicy="memory-disk" contentFit="cover" contentPosition="center" onError={()=>local&&uri===local?setFailedLocal(true):setFailed(true)} style={{width:'100%',height:'100%'}}/>
      :<Text maxFontSizeMultiplier={1.2} style={{fontSize:size*.44,lineHeight:size*.58,fontWeight:'700',color:fallback.color}}>{fallback.initial}</Text>}
  </View>;
}
