import {StatusBar} from 'expo-status-bar';
import {useAppWindowGeometry} from '@/lib/app-viewport';

/** Letterbox margins are dark; ordinary phone status-bar styling is unchanged. */
export function AppStatusBar() {
  const geometry=useAppWindowGeometry();
  return <StatusBar style={geometry.left>0||geometry.top>0?'light':'dark'}/>;
}
