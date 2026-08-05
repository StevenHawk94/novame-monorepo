import { requireOptionalNativeModule } from 'expo';

type WidgetSyncNative = {
  syncLatestFriendReflect(payloadJson: string): Promise<boolean>;
};

// Null in Expo Go / Android / before the next native build — callers no-op.
const WidgetSync = requireOptionalNativeModule<WidgetSyncNative>('WidgetSync');

export async function nativeSyncLatestFriendReflect(payloadJson: string): Promise<boolean> {
  if (!WidgetSync) return false;
  try {
    return await WidgetSync.syncLatestFriendReflect(payloadJson);
  } catch {
    return false;
  }
}
