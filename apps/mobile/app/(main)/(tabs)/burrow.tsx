import { Redirect } from 'expo-router';
import { useMajorUpdateEnabled } from '@/lib/use-major-update';
import { BurrowScreen } from '@/components/burrow/burrow-screen';
export default function BurrowTab(){return useMajorUpdateEnabled()?<BurrowScreen section="burrow" asTab/>:<Redirect href="/(main)/(tabs)"/>;}
