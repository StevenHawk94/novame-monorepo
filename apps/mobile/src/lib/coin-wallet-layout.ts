import {formatAnimatedCoins} from './burrow-motion';
export const homeWalletFontSize=(width:number,height:number)=>36*Math.min(width/900,height/1600);
/** Home proportions, shared by every wallet. No six-digit empty reservation. */
export function coinNumberWidth(balance:number,fontSize:number){
  'worklet';
  const text=formatAnimatedCoins(balance);
  return 2+[...text].reduce((width,char)=>width+(char===','?.30:char==='-'?.43:.65)*fontSize,0);
}
export function coinWalletMetrics(fontSize=18){
  'worklet';
  const iconSize=fontSize*5/3;
  const height=iconSize+fontSize*.39,touchHeight=Math.max(48,height);
  // The supplied 225px coin canvas has a ~191px visible circle. Match the
  // orange disc to that visible diameter, not its transparent image padding.
  return {fontSize,iconSize,addSize:iconSize*.85,gap:fontSize*.22,padding:fontSize*.28,height,touchHeight,touchInset:(touchHeight-height)/2};
}
export function coinWalletWidth(balance:number,fontSize=18,showAdd=true){
  'worklet';
  const m=coinWalletMetrics(fontSize);
  // Equal icon tracks keep the number optically centered between the visible
  // coin and plus, despite the coin asset's transparent canvas padding.
  return m.padding*2+m.iconSize*(showAdd?2:1)+m.gap*(showAdd?2:1)+coinNumberWidth(balance,fontSize);
}
