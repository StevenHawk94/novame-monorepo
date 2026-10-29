import { Redirect } from 'expo-router';

/** Retired AI feature: keep old deep links safe, without submitting consent,
 * forwarding an arbitrary next URL, or starting any AI processing. */
export default function RetiredAiConsent() {
  return <Redirect href="/(main)/(tabs)" />;
}
