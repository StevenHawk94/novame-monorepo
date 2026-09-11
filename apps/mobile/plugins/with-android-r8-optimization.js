/**
 * Use Android's optimized default R8 configuration for release builds.
 *
 * Expo SDK 54 generates `proguard-android.txt`, which enables shrinking and
 * obfuscation when minification is turned on but disables R8's optimization
 * pass. Google Play's DEX requirements score shrinking, obfuscation, and
 * optimization separately, so release builds should use the optimized
 * Android default instead.
 *
 * This plugin only writes generated Android Gradle/ProGuard/resource files.
 * It has no iOS mod and no iOS effect.
 */
const { withAppBuildGradle, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const DEFAULT_RULES = /getDefaultProguardFile\((['"])proguard-android\.txt\1\)/g;
const OPTIMIZED_RULES =
  'getDefaultProguardFile("proguard-android-optimize.txt")';
const OPTIMIZED_RULES_PATTERN =
  /getDefaultProguardFile\((['"])proguard-android-optimize\.txt\1\)/g;

const RULES_START = '# burrow-r8-safety:start';
const RULES_END = '# burrow-r8-safety:end';
const R8_SAFETY_RULES = `${RULES_START}
# Expo SDK 54 registers native module definitions and image source records at
# runtime. Full-mode optimization may inline or rewrite these classes even
# though their resource files remain in the AAB, leaving numeric Metro assets
# impossible to resolve in Play release builds. Keep only the affected bridge
# packages until the Expo/React Native toolchain can move to an AGP version
# with the newer integrated resource shrinker.
-keep class expo.modules.image.** { *; }
-keep class expo.modules.asset.** { *; }

# Expo TaskManager persists consumer class names and recreates consumers with
# reflection. Keep the stable name and the exact reflective constructor while
# still allowing R8 to optimize the implementation.
-keep,allowoptimization class * implements expo.modules.interfaces.taskManager.TaskConsumerInterface {
  public <init>(android.content.Context, expo.modules.interfaces.taskManager.TaskManagerUtilsInterface);
  public static int VERSION;
}
${RULES_END}`;

const RESOURCE_KEEP_XML = `<?xml version="1.0" encoding="utf-8"?>
<!--
  Metro local assets are looked up by generated resource name at runtime
  (Resources.getIdentifier), which the Android resource shrinker cannot prove
  statically. Keep only Metro-generated application assets; ordinary Android
  and dependency resources remain eligible for shrinking.
-->
<resources xmlns:tools="http://schemas.android.com/tools"
    tools:keep="@drawable/assets_*,@raw/assets_*" />
`;

function upsertMarkedBlock(contents, block) {
  const start = contents.indexOf(RULES_START);
  const end = contents.indexOf(RULES_END);
  if (start >= 0 && end >= start) {
    return `${contents.slice(0, start)}${block}${contents.slice(end + RULES_END.length)}`;
  }
  return `${contents.trimEnd()}\n\n${block}\n`;
}

const withAndroidR8SafetyFiles = (config) =>
  withDangerousMod(config, [
    'android',
    (config) => {
      const appRoot = path.join(config.modRequest.platformProjectRoot, 'app');
      const proguardPath = path.join(appRoot, 'proguard-rules.pro');
      if (!fs.existsSync(proguardPath)) {
        throw new Error(`Android ProGuard rules not found at ${proguardPath}`);
      }

      const currentRules = fs.readFileSync(proguardPath, 'utf8');
      fs.writeFileSync(
        proguardPath,
        upsertMarkedBlock(currentRules, R8_SAFETY_RULES),
      );

      const rawResourceDir = path.join(appRoot, 'src', 'main', 'res', 'raw');
      fs.mkdirSync(rawResourceDir, { recursive: true });
      fs.writeFileSync(
        path.join(rawResourceDir, 'burrow_r8_keep.xml'),
        RESOURCE_KEEP_XML,
      );
      return config;
    },
  ]);

const withAndroidR8Optimization = (config) => {
  config = withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') {
      throw new Error(
        'with-android-r8-optimization expects android/app/build.gradle to use Groovy',
      );
    }

    const source = config.modResults.contents;
    const defaultMatches = source.match(DEFAULT_RULES) ?? [];
    const optimizedMatches = source.match(OPTIMIZED_RULES_PATTERN) ?? [];

    if (defaultMatches.length === 1 && optimizedMatches.length === 0) {
      config.modResults.contents = source.replace(DEFAULT_RULES, OPTIMIZED_RULES);
      return config;
    }
    if (defaultMatches.length === 0 && optimizedMatches.length === 1) {
      return config;
    }
    throw new Error(
      'Expected exactly one Android default ProGuard rule; '
        + `found default=${defaultMatches.length}, optimized=${optimizedMatches.length}`,
    );
  });
  return withAndroidR8SafetyFiles(config);
};

module.exports = withAndroidR8Optimization;
module.exports.R8_SAFETY_RULES = R8_SAFETY_RULES;
module.exports.RESOURCE_KEEP_XML = RESOURCE_KEEP_XML;
module.exports.upsertMarkedBlock = upsertMarkedBlock;
