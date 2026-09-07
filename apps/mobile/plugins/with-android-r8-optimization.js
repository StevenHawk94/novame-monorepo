/**
 * Use Android's optimized default R8 configuration for release builds.
 *
 * Expo SDK 54 generates `proguard-android.txt`, which enables shrinking and
 * obfuscation when minification is turned on but disables R8's optimization
 * pass. Google Play's DEX requirements score shrinking, obfuscation, and
 * optimization separately, so release builds should use the optimized
 * Android default instead.
 *
 * This mod only touches android/app/build.gradle. It has no iOS effect.
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const DEFAULT_RULES = /getDefaultProguardFile\((['"])proguard-android\.txt\1\)/g;
const OPTIMIZED_RULES =
  'getDefaultProguardFile("proguard-android-optimize.txt")';

const withAndroidR8Optimization = (config) =>
  withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') {
      throw new Error(
        'with-android-r8-optimization expects android/app/build.gradle to use Groovy',
      );
    }

    const source = config.modResults.contents;
    const matches = source.match(DEFAULT_RULES) ?? [];

    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one proguard-android.txt release rule, found ${matches.length}`,
      );
    }

    config.modResults.contents = source.replace(DEFAULT_RULES, OPTIMIZED_RULES);
    return config;
  });

module.exports = withAndroidR8Optimization;
