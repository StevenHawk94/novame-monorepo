/**
 * Permission helpers — single concern: microphone for recording.
 *
 * Wraps expo-audio's `requestRecordingPermissionsAsync` /
 * `getRecordingPermissionsAsync` plus React Native's `Linking.openSettings`
 * to provide a uniform "ask, then if denied direct user to Settings" flow.
 *
 * PermissionResponse shape (verified from
 * expo-modules-core/PermissionsInterface.d.ts):
 *   - status: 'granted' | 'denied' | 'undetermined'
 *   - granted: boolean (convenience)
 *   - canAskAgain: boolean (false => system won't show prompt again,
 *                            user must go to Settings)
 *   - expires: 'never' | number
 *
 * Notes:
 *   - On iOS, after the user denies once, `canAskAgain` becomes false and
 *     the only path to re-grant is the Settings app.
 *   - On Android, denial behaviour depends on the version and whether
 *     the user ticked "Don't ask again".
 *   - We do NOT show alerts here — that's the caller's UI concern.
 */

import { Linking } from 'react-native';
import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
} from 'expo-audio';

export type MicPermissionResult = {
  granted: boolean;
  /**
   * If `granted` is false and `canAskAgain` is also false, the user must
   * be directed to the system Settings app — calling `request` again
   * will silently return denied without prompting.
   */
  canAskAgain: boolean;
};

/**
 * Check current mic permission state without prompting.
 * Used to decide whether to call `request` or jump straight to a
 * settings-redirect dialog.
 */
export async function getMicPermission(): Promise<MicPermissionResult> {
  const res = await getRecordingPermissionsAsync();
  return { granted: res.granted, canAskAgain: res.canAskAgain };
}

/**
 * Request mic permission. On first ever call, this triggers the system
 * dialog. On subsequent calls after a denial, behaviour depends on
 * `canAskAgain`:
 *   - true: system dialog shown again
 *   - false: returns denied silently — caller must show a "go to
 *            Settings" UI and call `openAppSettings` on user tap.
 */
export async function requestMicPermission(): Promise<MicPermissionResult> {
  const res = await requestRecordingPermissionsAsync();
  return { granted: res.granted, canAskAgain: res.canAskAgain };
}

/**
 * Open the system Settings app on the page for this app, where the
 * user can toggle the microphone permission. Used when
 * `canAskAgain === false`.
 *
 * `Linking.openSettings()` is supported on iOS 8+ and Android.
 */
export async function openAppSettings(): Promise<void> {
  await Linking.openSettings();
}
