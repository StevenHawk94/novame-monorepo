import { Redirect, useLocalSearchParams } from 'expo-router';

/** Preserve preset journal links; the retired three-way picker is not mounted. */
export default function ReflectEntryScreen() {
  const params = useLocalSearchParams<{ presetPrompt?: string; sourceKit?: string }>();
  return typeof params.presetPrompt === 'string' && params.presetPrompt.length > 0
    ? <Redirect href={{ pathname: '/(main)/reflect-typing', params }} />
    : <Redirect href="/(main)/burrow-detail?section=adventure" />;
}
