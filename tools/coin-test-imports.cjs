// Native/transport seams for older isolated component tests. Real registry,
// queue, runtime and controller behavior have dedicated tests; never mock them
// when the test explicitly supplies an implementation.
module.exports=(load,imports)=>{
 const motion=imports['@/lib/burrow-motion']??load('apps/mobile/src/lib/burrow-motion.ts');
 const layout=load('apps/mobile/src/lib/coin-wallet-layout.ts',{'./burrow-motion':motion});
 const store=imports['./coin-reward-store']??{};
 const send=async(op,ticket)=>{const epoch=imports['./session-lifecycle']?.sessionEpoch?.();try{
  const wire=imports['./api'].apiClient.post(op.path,op.payload),result=await (imports['./async-lifecycle']?.withDeadline??(p=>p))(wire,20000);
  if(epoch!==imports['./session-lifecycle']?.sessionEpoch?.())throw Error('session_changed');
  if(result.error)throw Error(result.error);
  if(op.path==='/api/vnext/release-room'&&(!result.status||result.status.partnerId!==op.payload.partnerId||result.status.pairVersion!==op.payload.pairVersion))throw Error('pair_changed');
  if(ticket)store.settleCoinReward?.(ticket,result);return result;
 }catch(error){if(ticket)store.failCoinReward?.(ticket,error);throw error;}};
 return {
  './coin-wallet':{CoinWallet:'CoinWallet'},
  './coin-wallet-face':{CoinWalletFace:'CoinWalletFace'},
  '@/lib/coin-wallet-layout':layout,
  './coin-wallet-context':{CoinWalletContext:{Provider:'WalletProvider'},useWalletMotion:()=>null},
  '@/lib/coin-wallet-registry':{useCoinWalletRegistry:()=>({slot:null,portal:null}),claimCoinWalletPortal:()=>()=>{}},
  '@/components/layout/adaptive-app-frame':{getAdaptiveFrameMetrics:width=>({width})},
  './coin-command-outbox':{
   coinOperations:{subscribeSettled:()=>()=>{},pending:()=>[]},
   submitCoinCommand:(action,payload)=>send({path:'/api/vnext/command',payload:{action,...payload}},store.commandCoinReward?.(action,payload)),
   submitCoinOperation:op=>send(op,store.beginCoinReward?.(op.id,op.key,op.amount,op.deferred)),
   enqueueCoinOperation:op=>send(op,store.beginCoinReward?.(op.id,op.key,op.amount,op.deferred)),
  },
  '@/lib/coin-command-outbox':{coinOperations:{resume(){},has:()=>false,subscribe:()=>()=>{}}},
 };
};
