const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');

// Android Keystore keys cannot be restored to another installation. Restore
// neither the encrypted vault nor a pre-migration plaintext session. Everything
// else keeps Android's normal backup rules; this does not clear local data.
const excludes = '<exclude domain="sharedpref" path="SecureStore"/>\n    <exclude domain="file" path="mmkv/"/>\n    <exclude domain="database" path="RKStorage"/>';
const backup = `<?xml version="1.0" encoding="utf-8"?>\n<full-backup-content>\n    ${excludes}\n</full-backup-content>\n`;
const extraction = `<?xml version="1.0" encoding="utf-8"?>\n<data-extraction-rules>\n  <cloud-backup>\n    ${excludes}\n  </cloud-backup>\n  <device-transfer>\n    ${excludes}\n  </device-transfer>\n</data-extraction-rules>\n`;
module.exports = config => {
  config = withAndroidManifest(config, mod => {
    const app = mod.modResults.manifest.application[0].$;
    app['android:fullBackupContent'] = '@xml/burrow_storage_backup';
    app['android:dataExtractionRules'] = '@xml/burrow_storage_extraction';
    return mod;
  });
  return withDangerousMod(config, ['android', async mod => {
    const directory = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/res/xml');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'burrow_storage_backup.xml'), backup);
    await fs.writeFile(path.join(directory, 'burrow_storage_extraction.xml'), extraction);
    return mod;
  }]);
};
