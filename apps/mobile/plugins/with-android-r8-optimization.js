/**
 * Keep Metro resources and Expo Modules bridge metadata safe in Android
 * release builds.
 *
 * Do not replace Expo's default `proguard-android.txt` with Android's fully
 * optimized configuration. Expo Modules SDK 54 converts React Native maps to
 * Kotlin Records at runtime; the extra optimization pass can rewrite that
 * type machinery even when the individual module classes are kept. The
 * result is release-only failures across unrelated modules (for example
 * expo-image SourceMap and expo-crypto DigestOptions conversion).
 *
 * Minification, obfuscation and resource shrinking remain enabled by
 * expo-build-properties. This plugin only supplies the safety rules and
 * Metro resource keep file that those supported defaults require.
 */
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const RULES_START = '# burrow-r8-safety:start';
const RULES_END = '# burrow-r8-safety:end';
const R8_SAFETY_RULES = `${RULES_START}
# Expo Modules reads Kotlin generic signatures and annotations to convert
# React Native maps into Records/Either values. These attributes and converter
# packages must survive release minification.
-keepattributes Signature,InnerClasses,EnclosingMethod,*Annotation*
-keep class expo.modules.kotlin.records.** { *; }
-keep class expo.modules.kotlin.types.** { *; }
-keep class expo.modules.kotlin.sharedobjects.** { *; }

# Local Metro images use expo-image and expo-asset native bridge records.
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

const withAndroidR8Optimization = (config) => withAndroidR8SafetyFiles(config);

module.exports = withAndroidR8Optimization;
module.exports.R8_SAFETY_RULES = R8_SAFETY_RULES;
module.exports.RESOURCE_KEEP_XML = RESOURCE_KEEP_XML;
module.exports.upsertMarkedBlock = upsertMarkedBlock;
