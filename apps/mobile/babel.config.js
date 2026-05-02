/**
 * babel.config.js for @novame/mobile
 *
 * NativeWind v5: NO babel plugin needed (handled by metro config)
 * Reanimated v4: react-native-worklets/plugin MUST be last
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      'react-native-worklets/plugin', // must be last
    ],
  };
};
