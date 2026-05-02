/**
 * metro.config.js for @novame/mobile
 *
 * Monorepo + pnpm isolated install:
 *   - watchFolders: monorepo root so Metro sees packages/* changes
 *   - nodeModulesPaths: project + monorepo root (pnpm hoists some deps to root)
 *   - unstable_enableSymlinks: pnpm uses symlinks for workspace packages
 *   - unstable_enablePackageExports: packages/core uses subpath exports
 *
 * NativeWind v5:
 *   - withNativewind(config) — no second arg in v5 (auto-detects global.css)
 */
const { getDefaultConfig } = require('expo/metro-config');
const { withNativewind } = require('nativewind/metro');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

config.resolver.unstable_enableSymlinks = true;
config.resolver.unstable_enablePackageExports = true;

module.exports = withNativewind(config);
