import { Redirect } from 'expo-router';

/** Old day-guessing links open the current Game Room with its normal guards. */
export default function RetiredGuessScreen() {
  return <Redirect href="/(main)/game-room" />;
}
