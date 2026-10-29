import {createContext,useContext,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import {FRIEND_TEXT,fitFriendText,friendHintHeight,friendTextSizing,friendTextPageHeight,friendTextRuns,friendTextStyle,type FriendTextPage} from '@/lib/friend-text-layout';
import {AdventureReveal} from './adventure-reveal';
import {BackIcon} from './burrow-back-button';

export const FriendTextContext=createContext({size:18,width:300,height:280,hintHeight:44,maxFontSizeMultiplier:0,heights:{} as Readonly<Record<string,number>>});

/** Measure only this prepared conversation, not the whole catalogue or another
 * live page. All possible replies are measured before the first page appears. */
export function FriendTextMeasure({pages,width,height,fontScale,onReady}:{pages:readonly FriendTextPage[];width:number;height:number;fontScale:number;
  onReady:(fit:{size:number;panelHeight:number;hintHeight:number;heights:Record<string,number>})=>void}) {
  const signature=JSON.stringify([pages,width,height,fontScale]);
  return <Measure key={signature} pages={pages} width={width} height={height} fontScale={fontScale} onReady={onReady}/>;
}
function Measure({pages,width,height,fontScale,onReady}:Parameters<typeof FriendTextMeasure>[0]) {
  const sizing=friendTextSizing(width,height,fontScale);
  const [size,setSize]=useState<number>(sizing.size),runs=useMemo(()=>friendTextRuns(pages),[pages]);
  const measured=useRef<{size:number;heights:Record<string,number>}>({size,heights:{}}),finished=useRef(false);
  if(measured.current.size!==size)measured.current={size,heights:{}};
  const complete=(key:string,value:number)=>{
    if(finished.current||measured.current.size!==size)return;
    measured.current.heights[key]=value;
    if(Object.keys(measured.current.heights).length!==runs.length)return;
    const hintHeight=friendHintHeight(sizing.fontScale);
    const required=Math.max(0,...pages.map(p=>friendTextPageHeight(p,measured.current.heights,hintHeight)));
    const fit=fitFriendText(height,size,required,sizing.minSize);
    if(!fit.ready){setSize(fit.size);return;}
    finished.current=true;onReady({...fit,hintHeight,heights:measured.current.heights});
  };
  // Empty pages do not gate entry (the loading/empty state still stays usable).
  if(!runs.length)return null;
  return <View testID="friend-text-measure" pointerEvents="none" accessible={false} accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants" style={s.measure}>
    {runs.map(run=><Text key={`${size}:${run.key}`} maxFontSizeMultiplier={sizing.maxFontSizeMultiplier} style={[friendTextStyle(size,run.role),{position:'absolute',width:width-(run.role==='option'?31:run.role==='button'?30:0)}]}
      onLayout={e=>complete(run.key,e.nativeEvent.layout.height)}>{run.text}</Text>)}
  </View>;
}

/** One reading column and one vertical budget for every friend screen. The
 * continue hint has its own footer and never offsets the prose's centre. */
export function FriendTextPanel({page,onAdvance,onAction,onChoice,disabled=false,onVisible,error,graphic}:{page:FriendTextPage;
  onAdvance?:()=>void;onAction?:()=>void;onChoice?:(index:number)=>void;disabled?:boolean;onVisible?:()=>void;error?:string|null;graphic?:ReactNode}) {
  const metrics=useContext(FriendTextContext);
  // Only these two entry cards use the illustrated welcome composition.
  // Keep the shared conversation measurement and every dialogue/choice intact.
  if(page.welcome)return <FriendWelcomePanel key={`${page.welcome}:${metrics.width}:${metrics.height}`} page={page} onAction={onAction} disabled={disabled} error={error}/>;
  const textProps={maxFontSizeMultiplier:metrics.maxFontSizeMultiplier};
  const proseStyle=(title=false)=>({...friendTextStyle(metrics.size,title?'title':'body'),...(page.align==='center'?{textAlign:'center' as const}:{})});
  const overflow=friendTextPageHeight(page,metrics.heights,metrics.hintHeight)>metrics.height+.5;
  const button=(label:string,press:(()=>void)|undefined,option=false,index=0)=><Pressable key={index} accessibilityRole="button"
    disabled={disabled} accessibilityState={{disabled}} onPress={press} testID={option?`friend-option-${index}`:'friend-action'}
    style={({pressed})=>[s.button,option&&s.option,pressed&&s.pressed,disabled&&s.disabled]}>
    <Text {...textProps} style={[friendTextStyle(metrics.size,option?'option':'button'),!option&&s.actionText]}>{label}</Text>
  </Pressable>;
  const contents=<View style={s.fill} testID="friend-text-panel">
    <ScrollView bounces={false} showsVerticalScrollIndicator={overflow} style={s.fill}
      contentContainerStyle={s.content}>
      <View testID="friend-dialogue-block" style={[s.block,{width:metrics.width}]}>
        {graphic&&<View style={page.align==='center'?s.centerGraphic:undefined}>{graphic}</View>}
        {page.title&&<Text {...textProps} style={proseStyle(true)}>{page.title}</Text>}
        {page.body&&<Text {...textProps} testID="friend-prose" style={proseStyle()}>{page.body}</Text>}
        {page.options?.map((label,index)=>button(label,()=>onChoice?.(index),true,index))}
        {page.action&&button(page.action,onAction)}
        {error&&<Text {...textProps} accessibilityRole="alert" style={[s.error,page.align==='center'&&s.centerText]}>{error}</Text>}
      </View>
    </ScrollView>
    {overflow&&<Text {...textProps} style={s.overflow}>Scroll to read more ↓</Text>}
    {page.hint&&<View style={[s.hint,{height:metrics.hintHeight}]} pointerEvents="none"><View style={s.chevron}><BackIcon color="#C45A37"/></View><Text {...textProps} style={s.note}>Tap to continue</Text></View>}
  </View>;
  return <AdventureReveal delay={90} style={s.fill} onVisible={onVisible}>
    {onAdvance?<Pressable accessibilityRole="button" accessibilityLabel="Tap to continue" disabled={disabled} onPress={onAdvance} style={s.fill}>{contents}</Pressable>:contents}
  </AdventureReveal>;
}

function FriendWelcomePanel({page,onAction,disabled,error}:{page:FriendTextPage;onAction?:()=>void;disabled:boolean;error?:string|null}) {
  const metrics=useContext(FriendTextContext),visit=page.welcome==='visit';
  const [size,setSize]=useState(metrics.width<300?16:18),[heights,setHeights]=useState<Record<string,number>>({});
  const generation=useRef(size);generation.current=size;
  const padding=metrics.height<250?16:24,gap=visit?14:24,badgeHeight=visit?32:0;
  const complete=['title','body','action'].every(key=>Number.isFinite(heights[key]));
  const required=(heights.title??0)+(heights.body??0)+Math.max(48,(heights.action??0)+24)+badgeHeight+padding*2+gap*(visit?3:2);
  const available=metrics.height-FRIEND_TEXT.border,overflow=complete&&required>available+.5&&size<=14;
  const ready=complete&&(required<=available+.5||size<=14);
  useEffect(()=>{
    if(complete&&required>available+.5&&size>14){setHeights({});setSize(value=>value-1);}
  },[complete,required,available,size]);
  const measured=(key:string,height:number)=>{if(generation.current===size)setHeights(old=>old[key]===height?old:{...old,[key]:height});};
  const textProps={maxFontSizeMultiplier:1.1};
  return <AdventureReveal delay={90} style={s.fill}>
    <ScrollView bounces={false} style={s.fill} showsVerticalScrollIndicator={overflow} contentContainerStyle={w.scroll}>
      <View key={size} testID="friend-welcome-panel" style={[w.content,{width:metrics.width,minHeight:available,paddingVertical:padding,gap,opacity:ready?1:0}]}>
        {visit&&<View testID="friend-visitor-badge" style={w.badge}><Text {...textProps} style={w.badgeText}>VISITOR</Text></View>}
        <Text {...textProps} onLayout={event=>measured('title',event.nativeEvent.layout.height)} style={[w.title,{fontSize:size+8,lineHeight:size+18}]}>{page.title}</Text>
        <Text {...textProps} testID="friend-welcome-prose" onLayout={event=>measured('body',event.nativeEvent.layout.height)} style={[w.body,{fontSize:size,lineHeight:size+8}]}>{page.body}</Text>
        <Pressable testID="friend-action" accessibilityRole="button" disabled={disabled} accessibilityState={{disabled}} onPress={onAction}
          style={({pressed})=>[w.button,{width:visit?'100%':'78%'},!visit&&w.adventureButton,pressed&&s.pressed,disabled&&s.disabled]}>
          <Text {...textProps} onLayout={event=>measured('action',event.nativeEvent.layout.height)} style={[w.action,{fontSize:size+2,lineHeight:size+10},!visit&&w.adventureAction]}>{page.action}</Text>
        </Pressable>
        {error&&<Text {...textProps} accessibilityRole="alert" style={[s.error,s.centerText]}>{error}</Text>}
      </View>
    </ScrollView>
    {overflow&&<Text {...textProps} style={s.overflow}>Scroll to read more ↓</Text>}
  </AdventureReveal>;
}
const w=StyleSheet.create({
  scroll:{flexGrow:1},content:{alignSelf:'center',alignItems:'center',justifyContent:'space-evenly'},
  title:{width:'100%',fontWeight:'800',color:'#4F2C19',textAlign:'center'},
  body:{width:'100%',fontWeight:'400',color:'#4F2C19',textAlign:'center'},
  badge:{height:32,minWidth:94,paddingHorizontal:18,borderRadius:18,alignItems:'center',justifyContent:'center',backgroundColor:'#BB6B48'},
  badgeText:{fontSize:14,lineHeight:20,fontWeight:'700',color:'#FFF9EF',textAlign:'center'},
  button:{minHeight:48,paddingHorizontal:14,paddingVertical:12,borderRadius:30,alignItems:'center',justifyContent:'center',backgroundColor:'#6B3B24'},
  adventureButton:{backgroundColor:'#FFBE3B',shadowColor:'#9B4F22',shadowOffset:{width:0,height:4},shadowOpacity:.35,shadowRadius:0,elevation:3},
  action:{fontWeight:'700',color:'#FFF9EF',textAlign:'center'},adventureAction:{color:'#4F2C19'},
});
const s=StyleSheet.create({
  fill:{flex:1},measure:{position:'absolute',left:0,top:0,width:0,height:0,opacity:0,overflow:'hidden'},
  content:{flexGrow:1,justifyContent:'center',paddingVertical:FRIEND_TEXT.padding},
  block:{maxWidth:560,alignSelf:'center',gap:FRIEND_TEXT.gap},
  centerGraphic:{alignItems:'center'},centerText:{textAlign:'center'},
  button:{paddingHorizontal:14,paddingVertical:10,minHeight:FRIEND_TEXT.minButton,justifyContent:'center',borderRadius:22,backgroundColor:'#6B3B24',borderWidth:1,borderColor:'#6B3B24'},
  option:{backgroundColor:'#F8E6D9',borderColor:'#C8663A',borderWidth:1.5,borderRadius:17},actionText:{color:'#FFF9EF'},
  hint:{alignItems:'center',justifyContent:'center',paddingBottom:5},chevron:{transform:[{rotate:'-90deg'}],height:20},
  note:{fontSize:13,lineHeight:18,color:'#997A63',textAlign:'center'},overflow:{fontSize:13,lineHeight:18,color:'#806A58',textAlign:'center'},
  error:{fontSize:15,lineHeight:21,color:'#A13B24',textAlign:'left'},pressed:{transform:[{translateY:2}],opacity:.85},disabled:{opacity:.6},
});
