import { Redirect, useLocalSearchParams } from 'expo-router';
import { AFFECTION_TYPES, type AffectionType } from '@novame/domain';
import { AffectionDetailScreen } from '@/components/burrow/affection-detail-screen';
import { useMajorUpdateEnabled } from '@/lib/use-major-update';

export default function AffectionDetailRoute() {
  const enabled = useMajorUpdateEnabled();
  const { type } = useLocalSearchParams<{ type?: string }>();
  if (!enabled || !AFFECTION_TYPES.includes(type as AffectionType))
    return <Redirect href="/(main)/burrow-detail?section=affection"/>;
  return <AffectionDetailScreen key={type} type={type as AffectionType}/>;
}
