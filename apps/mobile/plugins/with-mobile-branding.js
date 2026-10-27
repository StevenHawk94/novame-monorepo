// Native folders are omitted from EAS uploads. Optimize the freshly generated
// platform assets after ALL Expo mods so clean cloud builds cannot regress.
const { withFinalizedMod } = require('expo/config-plugins');
const { optimizeNativeBranding,writeAndroidIcons,validateBrandingColors } = require('./branding-assets.cjs');
module.exports = config => {
  // Android requires layers, but its background is not a separate design option.
  validateBrandingColors(config);
  for (const platform of ['ios', 'android']) config = withFinalizedMod(config, [platform, async mod => {
    if(platform==='android')await writeAndroidIcons(mod.modRequest.projectRoot,mod);
    await optimizeNativeBranding(mod.modRequest.projectRoot, platform);
    return mod;
  }]);
  return config;
};
