import { useLocalSearchParams } from 'expo-router';
import { BurrowScreen } from '@/components/burrow/burrow-screen';

export default function HomeScreen() {
  const { care } = useLocalSearchParams<{ care?: string }>();
  return <BurrowScreen section="home" asTab homeIntent={care} />;
}
