/** Presentation only: no answer, reward, or visit lifecycle writes. Native Text
 * supplies the heights; estimates must never decide whether prose is clipped. */
export type FriendTextPage = {
  title?: string; body?: string; options?: readonly string[]; action?: string;
  hint?: boolean; graphic?: boolean; align?: 'center'; welcome?:'adventure'|'visit';
};
export const FRIEND_TEXT = {size:18,minSize:16,line:26,gap:12,padding:20,hint:44,border:5,buttonPadding:22,optionPadding:23,minButton:48} as const;
/** Width is the actual reading column. Large system text can make an otherwise
 * normal phone compact too; bound scaling locally, never change App settings. */
export function friendTextSizing(width:number,height:number,fontScale=1) {
  const scale=Number.isFinite(fontScale)&&fontScale>0?fontScale:1;
  const compact=width/Math.max(1,scale)<300||height<600;
  return {size:compact?16:FRIEND_TEXT.size,minSize:compact?14:FRIEND_TEXT.minSize,
    maxFontSizeMultiplier:compact?1.1:0,fontScale:compact?Math.min(scale,1.1):scale};
}
export type FriendTextRole = 'title'|'body'|'button'|'option';
export function friendTextStyle(size:number,role:FriendTextRole='body') {
  const title=role==='title';
  return {fontSize:size+(title?2:0),lineHeight:size+8+(title?2:0),fontWeight:title||role==='button'?'700' as const:'600' as const,
    color:'#4F2C19',textAlign:role==='button'?'center' as const:'left' as const};
}
export function friendTextKey(text:string,role:FriendTextRole) {return JSON.stringify([role,text]);}
export function friendTextRuns(pages:readonly FriendTextPage[]) {
  const runs=new Map<string,{text:string;role:FriendTextRole}>();
  for(const p of pages)for(const [role,texts]of [['title',[p.title]],['body',[p.body]],['option',p.options??[]],['button',[p.action]]] as const)
    for(const text of texts)if(text)runs.set(friendTextKey(text,role),{text,role});
  return [...runs].map(([key,run])=>({key,...run}));
}
export function friendHintHeight(fontScale=1) {return Math.max(FRIEND_TEXT.hint,25+18*fontScale);}
export function friendTextPageHeight(page:FriendTextPage,heights:Readonly<Record<string,number>>,hintHeight:number=FRIEND_TEXT.hint) {
  const blocks:number[]=[];
  if(page.graphic)blocks.push(88);
  if(page.title)blocks.push(heights[friendTextKey(page.title,'title')]??0);
  if(page.body)blocks.push(heights[friendTextKey(page.body,'body')]??0);
  for(const option of page.options??[])blocks.push(Math.max(FRIEND_TEXT.minButton,(heights[friendTextKey(option,'option')]??0)+FRIEND_TEXT.optionPadding));
  if(page.action)blocks.push(Math.max(FRIEND_TEXT.minButton,(heights[friendTextKey(page.action,'button')]??0)+FRIEND_TEXT.buttonPadding));
  return blocks.reduce((sum,h)=>sum+h,0)+Math.max(0,blocks.length-1)*FRIEND_TEXT.gap+FRIEND_TEXT.padding*2
    +(page.hint?hintHeight:0)+FRIEND_TEXT.border;
}
export function friendPanelBudget(height:number) {
  return {base:Math.min(height*.48,Math.max(220,height*.4)),max:Math.max(1,Math.min(height*.58,height-140))};
}
export function fitFriendText(height:number,size:number,required:number,minSize:number=FRIEND_TEXT.minSize) {
  const budget=friendPanelBudget(height);
  return required<=budget.base+.5?{size,panelHeight:budget.base,ready:true}:
    size>minSize?{size:Math.max(minSize,size-1),panelHeight:budget.base,ready:false}:
      {size,panelHeight:Math.min(Math.max(budget.base,required),Math.max(budget.base,budget.max)),ready:true};
}
