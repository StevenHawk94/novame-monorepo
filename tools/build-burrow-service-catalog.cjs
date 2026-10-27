// Backward-compatible authoring entry. Never rewrite an already-applied migration.
require('./sync-shop-catalog.cjs').sync({check:process.argv.includes('--check')});
