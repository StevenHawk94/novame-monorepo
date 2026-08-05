/**
 * NovaMe home-screen widget target (@bacons/apple-targets).
 * Generated into the Xcode project on every `expo prebuild -p ios`,
 * so the gitignored ios/ folder can keep being disposable.
 */
/** @type {import('@bacons/apple-targets').Config} */
module.exports = {
  type: 'widget',
  name: 'NovaMeWidget',
  icon: '../../assets/icon.png',
  deploymentTarget: '17.0',
  appleTeamId: 'VFUC7899NP',
  entitlements: {
    'com.apple.security.application-groups': ['group.com.novame.app'],
  },
};
