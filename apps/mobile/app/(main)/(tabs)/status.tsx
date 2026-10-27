import { Redirect } from "expo-router";

/** Old Insights links return Home without fetching Connection data. */
export default function RetiredInsightsScreen() {
  return <Redirect href="/(main)/(tabs)" />;
}
