const {deferred}=require('./lifecycle-test-utils.cjs');
module.exports=function confirmationMock({manual=false}={}){
 const offers=[],successes=[],approval=deferred();
 return {offers,successes,approval,imports:{'@/lib/use-coin-purchase-confirmation':{useCoinPurchaseConfirmation:()=>({
  isCurrent:()=>true,confirm:offer=>{offers.push(offer);return manual?approval.promise:Promise.resolve(true);},success:name=>successes.push(name),
 })}}};
};
