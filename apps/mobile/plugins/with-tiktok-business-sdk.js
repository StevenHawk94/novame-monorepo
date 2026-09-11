/**
 * Injects TikTok App Events SDK credentials at native build time.
 *
 * Values intentionally use non-EXPO_PUBLIC environment variables, so they do
 * not enter the JavaScript bundle. Like every mobile SDK credential they are
 * still present in the signed binary and must be treated as client credentials,
 * never as a server-side authorization secret.
 */
const {
  withInfoPlist,
} = require('expo/config-plugins');

const IOS_KEYS = {
  TIKTOK_IOS_APP_ID: 'BurrowTikTokAppId',
  TIKTOK_IOS_TIKTOK_APP_ID: 'BurrowTikTokBusinessAppId',
  TIKTOK_IOS_ACCESS_TOKEN: 'BurrowTikTokAccessToken',
};

function readCredentials(keys) {
  return Object.entries(keys).map(([environmentName, nativeName]) => ({
    environmentName,
    nativeName,
    value: process.env[environmentName]?.trim() ?? '',
  }));
}

function assertCompleteForEas(platform, credentials) {
  if (process.env.EAS_BUILD_PLATFORM !== platform) return;
  const missing = credentials
    .filter(({ value }) => !value)
    .map(({ environmentName }) => environmentName);
  if (missing.length > 0) {
    throw new Error(
      `Missing TikTok ${platform} build credentials: ${missing.join(', ')}`,
    );
  }
}

const withTikTokBusinessSdk = (config) => {
  return withInfoPlist(config, (config) => {
    const credentials = readCredentials(IOS_KEYS);
    assertCompleteForEas('ios', credentials);
    credentials.forEach(({ nativeName, value }) => {
      config.modResults[nativeName] = value;
    });
    return config;
  });
};

module.exports = withTikTokBusinessSdk;
module.exports.IOS_KEYS = IOS_KEYS;
module.exports.assertCompleteForEas = assertCompleteForEas;
