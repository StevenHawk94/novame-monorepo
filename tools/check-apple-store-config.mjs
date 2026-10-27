// Run via `vercel env run -e production -- node ...`. Never prints key values.
import {createPrivateKey} from 'node:crypto';
import {appleClient} from '../apps/api/src/lib/apple-store-state.mjs';
const names=['APPLE_APP_ID','APPLE_IAP_PRIVATE_KEY','APPLE_IAP_KEY_ID','APPLE_IAP_ISSUER_ID'];
const result={present:Object.fromEntries(names.map(n=>[n,!!process.env[n]]))};
try{
 if(!Object.values(result.present).every(Boolean))throw Error('missing_configuration');
 const key=createPrivateKey(process.env.APPLE_IAP_PRIVATE_KEY.replace(/\\n/g,'\n'));
 result.validPrivateKey=key.asymmetricKeyType==='ec'&&key.asymmetricKeyDetails?.namedCurve==='prime256v1';
 result.validKeyId=/^[A-Z0-9]{10}$/.test(process.env.APPLE_IAP_KEY_ID);
 result.validIssuer=/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(process.env.APPLE_IAP_ISSUER_ID);
 result.validAppId=/^[1-9]\d+$/.test(process.env.APPLE_APP_ID);
 if(!result.validPrivateKey||!result.validKeyId||!result.validIssuer||!result.validAppId)throw Error('invalid_configuration_format');
 result.connectivity={};
 for(const env of ['Production','Sandbox']){
  try{await appleClient(env).getAllSubscriptionStatuses('1000000000000000');result.connectivity[env]={authenticated:true};}
  catch(e){
   // A read of a synthetic, nonexistent credential cannot grant or cancel a
   // subscription. Apple returning 404 confirms signature authentication.
   result.connectivity[env]={httpStatus:e.httpStatusCode??null,apiError:e.apiError??null,authenticated:e.httpStatusCode===404};
  }
 }
 if(Object.values(result.connectivity).some(v=>!v.authenticated))process.exitCode=1;
}catch{result.configurationCheckFailed=true;process.exitCode=1;}
console.log(JSON.stringify(result,null,2));
