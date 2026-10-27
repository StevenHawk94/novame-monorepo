// Isolated QA capability fixture ONLY. The renderer, clocks and haptic adapter
// remain real. This does not claim a simulator has physical haptics or 200MiB.
export {touchInitialQuality,testTouchVibration,touchVibrationVerified,confirmTouchVibration} from '../apps/mobile/src/lib/touch-note-runtime';
export const touchCapabilities=async()=>({availableBytes:200*1024*1024,lowMemory:false,hasVibrator:true,systemHaptics:'unknown'});
