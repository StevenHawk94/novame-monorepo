/** Compatibility entry point; one builder owns every Tap Your Day asset map. */
const { execFileSync } = require('node:child_process');
const path = require('node:path');
execFileSync(process.execPath, [path.join(__dirname, 'build-item-icon-assets.mjs'), ...process.argv.slice(2)], { stdio: 'inherit' });
