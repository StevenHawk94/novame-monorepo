const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./lifecycle-test-utils.cjs');

for (const cached of [false, true]) for (const enabled of [false, true]) {
  test(`Burrow paints immediately without remote rollout (cached=${cached}, old flag=${enabled})`, async () => {
    const experiences=[];
    const flag=load('apps/mobile/src/lib/use-major-update.ts', {
      './home-entry-readiness': { setHomeEntryExperience: value=>experiences.push(value) },
      './app-config-api': {
        getCachedConfig: ()=>({app_major_update_enabled:enabled}), hasCachedConfig:()=>cached,
        fetchAppConfig: ()=>{throw Error('Retired UI must not await a rollout fetch');},
      },
    });
    assert.equal(flag.useMajorUpdateEnabled(),true);
    assert.equal(flag.useMajorUpdateReady(),true);
    await flag.refreshMajorUpdateFlag({force:true});
    assert.deepEqual(experiences,['burrow']);
  });
}
