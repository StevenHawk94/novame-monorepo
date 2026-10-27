const {test}=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./lifecycle-test-utils.cjs');
test('modular-header plugin removes its unused Recaptcha declaration, preserves Google auth and is idempotent',()=>{
 let source="target 'Burrow' do\n  use_expo_modules!\n  pod 'RecaptchaInterop', :modular_headers => true\nend\n";
 const plugin=load('apps/mobile/plugins/with-ios-modular-headers.js',{
  'expo/config-plugins':{withDangerousMod:(config,[_platform,run])=>run(config)},
  fs:{readFileSync:()=>source,writeFileSync:(_path,value)=>{source=value;}},path:require('node:path'),
 });
 const config={modRequest:{platformProjectRoot:'/isolated-ios'}};
 plugin(config);assert.doesNotMatch(source,/RecaptchaInterop/);
 assert.match(source,/pod 'GoogleUtilities', :modular_headers => true/);
 assert.match(source,/use_expo_modules!/);
 const once=source;plugin(config);assert.equal(source,once);
});
