import { Redirect } from 'expo-router';
import { BurrowScreen } from '@/components/burrow/burrow-screen';
import { useMajorUpdateEnabled } from '@/lib/use-major-update';
export default function ShopTab(){return useMajorUpdateEnabled()?<BurrowScreen section="shop"/>:<Redirect href="/(main)/(tabs)"/>;}
