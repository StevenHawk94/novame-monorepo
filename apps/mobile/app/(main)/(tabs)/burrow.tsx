import { Redirect } from 'expo-router';
import { useMajorUpdateEnabled } from '@/lib/use-major-update';
export default function BurrowTab(){return <Redirect href={useMajorUpdateEnabled()?"/(main)/burrow-detail?section=burrow":"/(main)/(tabs)"}/>;}
