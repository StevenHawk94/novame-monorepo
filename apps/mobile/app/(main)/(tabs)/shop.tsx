import { Redirect } from 'expo-router';
import { useMajorUpdateEnabled } from '@/lib/use-major-update';
import { BurrowScreen } from '@/components/burrow/burrow-screen';
export default function ShopTab(){return useMajorUpdateEnabled()?<BurrowScreen section="shop" asTab/>:<Redirect href="/(main)/(tabs)"/>;}
