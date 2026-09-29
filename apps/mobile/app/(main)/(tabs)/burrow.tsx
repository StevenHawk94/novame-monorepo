import { Redirect } from 'expo-router';
import { BurrowScreen } from '@/components/burrow/burrow-screen';
import { useMajorUpdateEnabled } from '@/lib/use-major-update';
export default function BurrowTab(){return useMajorUpdateEnabled()?<BurrowScreen section="burrow"/>:<Redirect href="/(main)/(tabs)"/>;}
