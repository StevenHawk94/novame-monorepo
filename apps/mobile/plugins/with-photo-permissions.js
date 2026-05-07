/**
 * with-photo-permissions.js
 *
 * Local Expo config plugin that injects NSPhotoLibraryUsageDescription
 * and NSCameraUsageDescription into the iOS Info.plist.
 *
 * Why we need this:
 *   - expo-image-picker's official config plugin uses
 *     IOSConfig.Permissions.createPermissionsPlugin which is wrapped
 *     in createRunOncePlugin -- when expo-audio (loaded earlier in the
 *     plugins array) already registers NSMicrophoneUsageDescription,
 *     the runOnce check skips the entire image-picker plugin call,
 *     including the NSPhoto / NSCamera keys it would add.
 *   - app.json's `ios.infoPlist` field has a long-standing prebuild
 *     bug where keys are silently ignored (see expo/expo#35016 and
 *     expo/expo-cli#3935). Multiple SDK versions affected.
 *   - Expo official recommendation for reliable Info.plist edits is
 *     `withInfoPlist` (https://docs.expo.dev/config-plugins/...).
 *     This plugin uses that API directly, no runOnce wrapper, so it
 *     works regardless of any other plugin's state.
 *
 * Stage 3.10.2 -- needed for Account Management overlay's avatar upload.
 */
const { withInfoPlist } = require('expo/config-plugins');

const withPhotoPermissions = (config) => {
  return withInfoPlist(config, (config) => {
    config.modResults.NSPhotoLibraryUsageDescription =
      'NovaMe needs access to your photos to set a custom profile picture.';
    config.modResults.NSCameraUsageDescription =
      'NovaMe needs camera access to take a profile picture.';
    return config;
  });
};

module.exports = withPhotoPermissions;
