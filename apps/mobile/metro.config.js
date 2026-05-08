/**
 * metro.config.js for @novame/mobile
 *
 * Monorepo + pnpm:
 *   - watchFolders: monorepo root so Metro sees packages/* changes
 *   - nodeModulesPaths: project + monorepo root (pnpm hoists some deps to root)
 *   - unstable_enableSymlinks: pnpm uses symlinks for workspace packages
 *   - unstable_enablePackageExports: packages/core uses subpath exports
 */
const { getDefaultConfig } = require('expo/metro-config');
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

module.exports = config;
