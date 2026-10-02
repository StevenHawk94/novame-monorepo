import { Redirect } from 'expo-router';
import { useMajorUpdateEnabled } from '@/lib/use-major-update';
export default function ShopTab(){return <Redirect href={useMajorUpdateEnabled()?"/(main)/burrow-detail?section=shop":"/(main)/(tabs)"}/>;}
