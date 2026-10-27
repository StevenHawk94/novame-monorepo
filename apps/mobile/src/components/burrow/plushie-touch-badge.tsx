import {usePlushieTouchBadge} from '@/lib/plushie-touch-store';
import {UpdateBadge} from './update-badge';
import type {StyleProp,ViewStyle} from 'react-native';
/** Small subscriber: preparation/read updates do not rerender the room. */
export function PlushieTouchBadge({base=0,size,style}:{base?:number;size?:number;style?:StyleProp<ViewStyle>}){const count=usePlushieTouchBadge();return <UpdateBadge count={Math.max(base,count)} size={size} style={style??{right:0,top:0}}/>;}
