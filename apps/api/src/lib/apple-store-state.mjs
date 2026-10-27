import {AppStoreServerAPIClient,SignedDataVerifier,Environment,Status} from '@apple/app-store-server-library'

// Public Apple Root CA G3, downloaded from Apple's Certificate Authority.
// This is a trust anchor, not a key or a signature-verification escape hatch.
const ROOT=`-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517
IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA
MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4
at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM
6BgD56KyKA==
-----END CERTIFICATE-----`
export const APPLE_BUNDLE='com.novame.app'
export const STORE_PRODUCTS=Object.freeze({
 'novame.plus.monthly':{cycle:'monthly',seats:'solo'},'novame.plus.yearly':{cycle:'yearly',seats:'solo'},
 'novame.plusduo.monthly':{cycle:'monthly',seats:'duo'},'novame.plusduo.yearly':{cycle:'yearly',seats:'duo'},
})
export const storeFailure=(code,status=503)=>{throw Object.assign(Error(code),{status})}
const verifiers=new Map()
function verifier(environment){
 if(![Environment.PRODUCTION,Environment.SANDBOX].includes(environment))storeFailure('invalid_store_environment',401)
 const appId=Number(process.env.APPLE_APP_ID)
 if(!Number.isSafeInteger(appId)||appId<1)storeFailure('apple_verification_not_configured')
 if(!verifiers.has(environment))verifiers.set(environment,new SignedDataVerifier([Buffer.from(ROOT)],true,environment,APPLE_BUNDLE,appId))
 return verifiers.get(environment)
}
function hint(jws,notification=false){
 if(typeof jws!=='string'||jws.length>64000)storeFailure('invalid_store_signature',401)
 try{
  const untrusted=JSON.parse(Buffer.from(jws.split('.')[1],'base64url').toString('utf8'))
  // Only chooses which verifier to use; no unverified field grants authority.
  return notification ? untrusted.data?.environment??untrusted.summary?.environment : untrusted.environment
 }catch{storeFailure('invalid_store_signature',401)}
}
export async function verifyAppleTransaction(jws){
 const v=verifier(hint(jws))
 try{return await v.verifyAndDecodeTransaction(jws)}catch{storeFailure('invalid_store_signature',401)}
}
export async function verifyAppleNotification(jws){
 const v=verifier(hint(jws,true))
 try{return await v.verifyAndDecodeNotification(jws)}catch{storeFailure('invalid_store_signature',401)}
}
class BoundedAppleClient extends AppStoreServerAPIClient{
 constructor(key,keyId,issuer,bundle,environment){super(key,keyId,issuer,bundle,environment);this.base=environment===Environment.SANDBOX?'https://api.storekit-sandbox.apple.com':'https://api.storekit.apple.com'}
 makeFetchRequest(path,query,method,body,headers){
  const suffix=query.toString()
  return fetch(`${this.base}${path}${suffix?'?'+suffix:''}`,{method,headers,body,signal:AbortSignal.timeout(12000)})
 }
}
export function appleClient(environment){
 if(![Environment.PRODUCTION,Environment.SANDBOX].includes(environment))storeFailure('invalid_store_environment',401)
 const key=process.env.APPLE_IAP_PRIVATE_KEY?.replace(/\\n/g,'\n'),keyId=process.env.APPLE_IAP_KEY_ID,issuer=process.env.APPLE_IAP_ISSUER_ID
 if(!key||!keyId||!issuer)storeFailure('apple_verification_not_configured')
 return new BoundedAppleClient(key,keyId,issuer,APPLE_BUNDLE,environment)
}
export async function currentAppleTransaction(initial,client=appleClient(initial.environment)){
 const response=await client.getTransactionInfo(String(initial.transactionId))
 const tx=await verifyAppleTransaction(response.signedTransactionInfo)
 if(tx.transactionId!==initial.transactionId||tx.productId!==initial.productId||tx.environment!==initial.environment
  ||tx.bundleId!==APPLE_BUNDLE)storeFailure('store_app_mismatch',401)
 return tx
}
export async function assertAppleOwner(db,transaction,user){
 const binding=await db.from('store_credential_bindings').select('user_id').eq('store','apple')
  .eq('credential',transaction.originalTransactionId).maybeSingle()
 if(binding.error)storeFailure('credential_lookup_pending')
 if(binding.data&&binding.data.user_id!==user)storeFailure('purchase_account_conflict',409)
 if(!binding.data&&!transaction.appAccountToken)storeFailure('purchase_account_conflict',409)
 if(transaction.appAccountToken?.toLowerCase()!==user.toLowerCase()&&!binding.data)storeFailure('purchase_account_conflict',409)
}
/** A valid historic JWS is only a lookup credential, never current entitlement. */
export async function currentAppleSubscription(initial,expectedUser,client=appleClient(initial.environment)){
 if(!STORE_PRODUCTS[initial.productId]||initial.type!=='Auto-Renewable Subscription'||initial.bundleId!==APPLE_BUNDLE
  ||!/^\d+$/.test(initial.originalTransactionId??''))storeFailure('invalid_store_transaction',400)
 if(initial.appAccountToken&&initial.appAccountToken.toLowerCase()!==expectedUser.toLowerCase())storeFailure('purchase_account_conflict',409)
 const observedAt=new Date().toISOString()
 const snapshot=await client.getAllSubscriptionStatuses(initial.originalTransactionId)
 if(snapshot.bundleId!==APPLE_BUNDLE||snapshot.environment!==initial.environment
  ||(snapshot.appAppleId!=null&&snapshot.appAppleId!==Number(process.env.APPLE_APP_ID))
  ||(initial.environment===Environment.PRODUCTION&&snapshot.appAppleId==null))storeFailure('store_app_mismatch',401)
 const rows=[]
 for(const group of snapshot.data??[])for(const row of group.lastTransactions??[]){
  if(row.originalTransactionId!==initial.originalTransactionId)continue
  if(![Status.ACTIVE,Status.EXPIRED,Status.BILLING_RETRY,Status.BILLING_GRACE_PERIOD,Status.REVOKED].includes(row.status))storeFailure('incomplete_store_response')
  const tx=await verifier(initial.environment).verifyAndDecodeTransaction(row.signedTransactionInfo)
  if(tx.originalTransactionId!==initial.originalTransactionId||!STORE_PRODUCTS[tx.productId]||tx.type!=='Auto-Renewable Subscription')storeFailure('invalid_store_transaction',400)
  if(tx.appAccountToken&&tx.appAccountToken.toLowerCase()!==expectedUser.toLowerCase())storeFailure('purchase_account_conflict',409)
  const renewal=row.signedRenewalInfo?await verifier(initial.environment).verifyAndDecodeRenewalInfo(row.signedRenewalInfo):null
  if(renewal&&renewal.originalTransactionId!==tx.originalTransactionId)storeFailure('invalid_renewal',401)
  if(!Number.isFinite(tx.expiresDate)||!Number.isFinite(tx.signedDate))storeFailure('incomplete_store_response')
  const grace=row.status===Status.BILLING_GRACE_PERIOD&&Number.isFinite(renewal?.gracePeriodExpiresDate)?renewal.gracePeriodExpiresDate:null
  const until=grace??tx.expiresDate
  const state=tx.revocationDate||row.status===Status.REVOKED?'revoked'
   :until>Date.now()&&[Status.ACTIVE,Status.BILLING_GRACE_PERIOD].includes(row.status)?grace?'grace_period':'active'
   :row.status===Status.BILLING_RETRY?'on_hold':'expired'
  rows.push({store:'apple',environment:tx.environment==='Sandbox'?'sandbox':'production',credential:tx.originalTransactionId,
   transactionId:String(tx.transactionId),productId:tx.productId,periodEnd:new Date(until).toISOString(),state,
   observedAt,eventAt:new Date(tx.signedDate).toISOString(),...STORE_PRODUCTS[tx.productId]})
 }
 if(rows.length!==1)storeFailure('subscription_state_unavailable')
 return rows[0]
}
