import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { userErrorMessage } from '@/lib/user-error-message';
import { gameRoomTileWidth } from '@/lib/game-room-layout';
import { ActivityIndicator, AppState, FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Alert, Pressable } from '@/components/ui/feedback-pressable';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { gameOverview, gameSession, unlockGame, nudgeGame, GAME_UNLOCK_PRICE,
  type GameOverview, type GameSession, type GameSummary, type GameSessionSummary } from '@/lib/burrow-game-room-api';
import { gameRoomIcons } from '@/lib/burrow-game-room-art';
import { prepareGameHistoryEntry } from '@/lib/room-history-entry';
import { ROOM_TITLE_STYLE } from '@/lib/room-header-typography';
import { showBurrowToast } from '@/lib/burrow-toast';
import { cacheGameOverview, cacheGameSession, getCachedGameOverview, getCachedGameSession, gameOverviewNeedsRefresh, subscribeGameRoomChanges } from '@/lib/burrow-game-room-cache';
import { createLocalGame, gameResultViewed, markGameResultViewed, projectGameOverview, readLocalGame,
  reconcileLocalGame, resumeLocalGames, retryLocalGame, saveLocalGameAnswer, useLocalGames } from '@/lib/burrow-game-local';
import { gameRailItems, localGameOverview } from '@/lib/burrow-game-room-content';
import { burrowProducts } from '@/lib/burrow-products';
import { gameCardState, type GameCardState } from '@/lib/burrow-game-card-state';
import { refreshBurrow, useBurrow } from '@/lib/burrow-store';
import { isInsufficientCoins, showInsufficientCoins } from '@/lib/insufficient-coins';
import { useCoinPurchaseConfirmation } from '@/lib/use-coin-purchase-confirmation';
import { sessionEpoch } from '@/lib/session-lifecycle';
import { requirePartner } from '@/lib/partner-pairing';
import { BURROW_GAME_RULE_ICONS } from '@/lib/burrow-ui-assets';
import { markBurrowUpdatesSeen, useNotificationContentReady } from '@/lib/burrow-attention';
import { haptics } from '@/lib/haptics';
import { ReflectCelebration } from '@/components/main/reflect-celebration';
import { Image } from './burrow-image';
import { CoinLabel } from './coin-ui';
import { BurrowBackButton } from './burrow-back-button';
import { AdventureStageTransition } from './adventure-stage-transition';
import { openPreparedBurrow } from '@/lib/burrow-page-entry';
import { afterUiSettles, yieldToUi } from '@/lib/ui-idle';
import { UserAvatar } from '@/components/ui/user-avatar';

const waitingArt=require('../../../assets/burrow-webp/game room/waiting-page.webp');

const ink='#3C1D12', muted='#80604F', cream='#FFF9EF', orange='#CD5932';
const labels=['A','B','C','D'];
function Button({label,onPress,secondary=false,disabled=false}:{label:string;onPress:()=>void;secondary?:boolean;disabled?:boolean}){
  return <Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} onPress={onPress}
    style={({pressed})=>[st.button,secondary&&st.secondaryButton,(pressed||disabled)&&{opacity:.65}]}>
    <CoinLabel iconSize={32} style={[st.buttonText,secondary&&st.secondaryText]}>{label}</CoinLabel>
  </Pressable>;
}
function Panel({children,style}:{children:React.ReactNode;style?:object}){return <View style={[st.panel,style]}>{children}</View>;}
function Avatar({name,small=false,full=false}:{name:string;small?:boolean;full?:boolean}){return <View accessibilityLabel={name} style={[st.avatar,small&&{width:36,height:36,borderRadius:18,backgroundColor:'#FFC547'}]}><Text numberOfLines={1} adjustsFontSizeToFit style={st.avatarText}>
  {name==='You'||/^\d{2}$/.test(name)||(full&&name.length<=10)?name:name.charAt(0).toUpperCase()}</Text></View>;}
function questionHeading(text:string){
  // Compact result labels; the question and all options remain unchanged.
  const value=text.replace(/^Your /,'').replace(/ (is(?: usually)?|are|usually means)…$/,'').replace(/…$/,'');
  return value.charAt(0).toUpperCase()+value.slice(1);
}
function Check({correct=true,compact=false}:{correct?:boolean;compact?:boolean}){return <View accessibilityLabel={correct?'Correct':'Incorrect'} style={[st.check,compact&&st.resultCheck,compact&&correct&&st.resultCorrect,!correct&&st.miss]}><Feather name={correct?'check':'x'} size={compact?13:24} color={correct?cream:ink}/></View>;}
function ScoreDots({count,color=orange}:{count:number;color?:string}){return <View style={st.scoreDots}>{Array.from({length:6},(_,i)=><View key={i} style={[st.scoreDot,{backgroundColor:i<count?color:'#EBDACA'}]}/>)}</View>;}
const GameTile=memo(function GameTile({game,width,state,onSelect}:{game:GameSummary;width:number;state:GameCardState;onSelect:(game:GameSummary)=>void}){
  const status=state.kind==='plus'?'Plus exclusive':state.kind==='locked'?state.price+' coins to unlock':
    `Unlocked. You ${state.mineFinished?'finished':'not finished'}. Partner ${state.partnerFinished?'finished':'not finished'}.`;
  return <Pressable accessibilityRole="button" accessibilityLabel={game.title+'. '+status} onPress={()=>onSelect(game)}
    style={({pressed})=>[st.tile,{width,height:Math.max(118,width*1.24)},pressed&&{opacity:.8}]}>
    <Image source={gameRoomIcons[game.id]} contentFit="contain" style={{width:width*.39,height:width*.39}}/>
    <Text style={st.tileTitle} numberOfLines={2} adjustsFontSizeToFit>{game.title}</Text>
    <View style={st.tileStatus}>
      {state.kind==='plus'?<View style={st.tilePlus}><MaterialCommunityIcons name="crown" color="#FFD46A" size={19}/><Text style={st.tilePlusText}>PLUS</Text></View>
      :state.kind==='locked'?<CoinLabel iconSize={22} style={st.tilePrice}>{'{coin} '+state.price}</CoinLabel>
      :<View style={st.tileChecks}>{[state.mineFinished,state.partnerFinished].map((done,index)=><View key={index}
        accessibilityLabel={(index===0?'You':'Partner')+(done?' finished':' not finished')}
        style={[st.tileCheck,done&&st.tileCheckDone]}><Feather name="check" size={17} color={cream}/></View>)}</View>}
    </View>
  </Pressable>;
});

export function GameRoomScreen({initialGameId,initialSessionId,fromHistory=false}:{initialGameId?:string;initialSessionId?:string;fromHistory?:boolean}){
  const focused=useIsFocused(),insets=useSafeAreaInsets(),{width,height}=useWindowDimensions(),{data:burrow}=useBurrow(false,'game');
  const scope=burrow?burrow.profile.id+':'+(burrow.partner?.id??'')+':'+(burrow.pairVersion??''):'';
  const checkout=useCoinPurchaseConfirmation(scope);
  const scopeRef=useRef(scope);scopeRef.current=scope;
  const focusedRef=useRef(focused);focusedRef.current=focused;
  const overviewRead=useRef<{scope:string;epoch:number;again:boolean;promise:Promise<void>}|null>(null);
  const local=useLocalGames(scope),screenScope=useRef(scope);
  const [remote,setRemote]=useState<GameOverview>(()=>localGameOverview(getCachedGameOverview(scope)));
  const [storedSession,setSession]=useState<GameSession|null>(()=>initialSessionId?(readLocalGame(initialSessionId,scope)?.session??getCachedGameSession(initialSessionId,scope)):null);
  const [selected,setSelected]=useState<GameSummary|null>(()=>remote.games.find(item=>item.id===initialGameId)??null),[transition,setTransition]=useState(()=>storedSession?.ownAnswers.length===6&&storedSession.guesses.length===0);
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[visit,setVisit]=useState(0);
  const [hold,setHold]=useState<{choice:number;phase:'own'|'guess';index:number}|null>(null);
  const operation=useRef(0),request=useRef(0),locked=useRef(false),choiceTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const closing=useRef(false);
  const requestedRound=useRef<string|undefined>(storedSession?undefined:initialSessionId);
  const live=screenScope.current===scope;
  const session=live&&storedSession?(local.find(j=>j.session.id===storedSession.id||j.sessionId===storedSession.id||'local:'+j.id===storedSession.id)?.session??storedSession):null;
  const job=session?readLocalGame(session.id,scope):undefined;
  const products=useMemo(()=>burrowProducts(burrow?.catalog??[],'game'),[burrow?.catalog]);
  const pricesReady=burrow?.catalogComplete===true;
  // A child game can confirm an unlock while the retained lobby is hidden.
  // Paint that scoped receipt on its very first focus frame, not after a poll.
  const cachedRemote=live?getCachedGameOverview(scope):null;
  const overview=useMemo(()=>projectGameOverview(localGameOverview({... (cachedRemote??(live?remote:localGameOverview(null))),products}),scope),[remote,cachedRemote,scope,local,live,products]);
  const game=overview.games.find(item=>item.id===(selected?.id??session?.gameId))??selected??null;
  const partnerName=burrow?.partner?.display_name?.trim()||'your person';
  const historyOpening=useRef(false);
  useEffect(()=>{if(focused&&burrow?.partner)return afterUiSettles(()=>{void prepareGameHistoryEntry(scope).catch(()=>{});});},[focused,scope]);
  async function openHistory(){
    if(historyOpening.current)return;historyOpening.current=true;const epoch=sessionEpoch(),own=scope;
    try{
      const exists=!!burrow?.partner&&await prepareGameHistoryEntry(scope);
      if(!focusedRef.current||scopeRef.current!==own||sessionEpoch()!==epoch)return;
      if(exists)openPreparedBurrow({pathname:'/(main)/game-room',params:{history:'1'}} as Href);
      else showBurrowToast('No play history yet.');
    }catch{if(focusedRef.current&&scopeRef.current===own&&sessionEpoch()===epoch)showBurrowToast('Could not check history. Please try again.');}
    finally{historyOpening.current=false;}
  }
  const gameVersion=JSON.stringify(burrow?.attention?.games??[]);
  const waiting=!!session&&session.ownAnswers.length===6&&session.guesses.length===6;
  const resultPending=waiting&&session.partnerOwnCount===6&&session.partnerGuessCount===6;
  // Keep the acknowledged final answer on screen until the authenticated
  // receipt contains both answer sets and real scores. Never mount empty results.
  const selection=hold??(resultPending&&!session?.result?{choice:session!.guesses[5],phase:'guess' as const,index:5}:null);
  const catalogue=!session&&!selected&&!requestedRound.current;
  const mode=selection?'question':session?.result?'results':waiting?'waiting':transition&&session?'transition':session?'question':requestedRound.current?'opening':selected?'intro':'catalogue';
  const phase=selection?.phase??(session?.ownAnswers.length===6?'guess':'own');
  const index=selection?.index??(session?(phase==='own'?session.ownAnswers.length:session.guesses.length):0);
  const question=session?.questions[index];
  const stageKey=mode==='question'?'question:'+phase+':'+index:mode==='intro'?'intro:'+game?.id:mode;
  const tileWidth=gameRoomTileWidth(width);
  const minBody=Math.max(0,height-insets.top-insets.bottom-82);
  const fixedFooter=mode==='results'||mode==='waiting';
  const notificationsReady=useNotificationContentReady(burrow,'games');
  useEffect(()=>{if(focused&&burrow&&notificationsReady)markBurrowUpdatesSeen(burrow,'games');},[focused,burrow,notificationsReady]);
  useEffect(()=>{
    if(screenScope.current===scope)return;
    screenScope.current=scope;operation.current++;request.current++;locked.current=false;clearTimeout(choiceTimer.current);
    setBusy(false);setHold(null);setSelected(localGameOverview(getCachedGameOverview(scope)).games.find(item=>item.id===initialGameId)??null);setTransition(false);setError(null);
    setRemote(localGameOverview(getCachedGameOverview(scope)));
    setSession(initialSessionId?(readLocalGame(initialSessionId,scope)?.session??getCachedGameSession(initialSessionId,scope)):null);
    requestedRound.current=initialSessionId&&!readLocalGame(initialSessionId,scope)&&!getCachedGameSession(initialSessionId,scope)?initialSessionId:undefined;
  },[scope,initialGameId,initialSessionId]);
  useEffect(()=>()=>{focusedRef.current=false;operation.current++;request.current++;clearTimeout(choiceTimer.current);},[]);
  useEffect(()=>{
    if(!focused){operation.current++;request.current++;clearTimeout(choiceTimer.current);locked.current=false;}
    else{closing.current=false;setHold(null);setBusy(false);}
    // Do not change the outgoing page's drawing in the middle of a native pop.
  },[focused]);
  const refreshOverview=useCallback(()=>{
    const epoch=sessionEpoch(),pending=overviewRead.current;
    if(pending?.scope===scope&&pending.epoch===epoch){pending.again=true;return pending.promise;}
    const read={scope,epoch,again:false,promise:Promise.resolve()};
    read.promise=(async()=>{
      do {
        read.again=false;
        const value=await gameOverview();
        await yieldToUi();
        if(epoch!==sessionEpoch()||scopeRef.current!==scope)return;
        const cached=cacheGameOverview(value,Date.now(),scope);
        if(focusedRef.current)setRemote(cached??value);
        // A broadcast received during an old read needs one trailing snapshot.
        // Collapse bursts instead of launching parallel requests per event.
      } while(read.again&&focusedRef.current);
    })().finally(()=>{if(overviewRead.current===read)overviewRead.current=null;});
    overviewRead.current=read;return read.promise;
  },[scope]);
  const readRound=useCallback(async(id:string,open=false)=>{
    if(id.startsWith('local:'))return;
    const token=++request.current,epoch=sessionEpoch();
    let value:GameSession;
    try{value=await gameSession(id);}catch(e){
      if(token===request.current&&epoch===sessionEpoch()&&scopeRef.current===scope&&open)setError(userErrorMessage(e,'Couldn’t open this round. Please try again.'));
      return;
    }
    if(!open)await yieldToUi();
    if(token!==request.current||epoch!==sessionEpoch()||scopeRef.current!==scope)return;
    const next=reconcileLocalGame(value,scope);cacheGameSession(next,Date.now(),scope);
    if(open||storedSession?.id===id||job?.sessionId===id){
      if(open&&next.ownAnswers.length===6&&next.guesses.length===0)setTransition(true);
      setSession(getCachedGameSession(next.id,scope)??next);requestedRound.current=undefined;
    }
  },[scope,storedSession?.id,job?.sessionId]);
  const introRound=mode==='intro'?overview.sessions.find(row=>row.gameId===game?.id&&!row.completedAt):undefined;
  useEffect(()=>{
    if(!focused||!introRound||readLocalGame(introRound.id,scope)||getCachedGameSession(introRound.id,scope))return;
    // The rules page is already usable. Prepare real saved progress while the
    // user reads it, not after their Start tap. Never invent old answers.
    void readRound(introRound.id).catch(()=>{});
  },[focused,scope,introRound?.id,readRound]);
  useEffect(()=>{
    if(!focused)return;
    const tick=(refreshHome=true)=>{
      if(AppState.currentState!=='active')return;
      void refreshOverview().catch(()=>{});if(refreshHome)void refreshBurrow({silent:true});void resumeLocalGames();
      const id=requestedRound.current??(waiting&&!session?.completedAt&&(!job||job.confirmed)?session?.id:undefined);
      if(id)void readRound(id,!!requestedRound.current).catch(()=>{});
    };
    // A ready destination paints first. Optional focus revalidation must not
    // return a full bootstrap/render burst in the middle of its native push.
    const cancelRefresh=afterUiSettles(()=>{
      if(focusedRef.current&&scopeRef.current===scope&&gameOverviewNeedsRefresh(Date.now(),scope))void refreshOverview().catch(()=>{});
    });
    if(requestedRound.current)void readRound(requestedRound.current,true).catch(()=>{});
    else if(waiting&&!session?.completedAt&&(!job||job.confirmed))void readRound(session!.id).catch(()=>{});
    const timer=setInterval(tick,30_000),subscription=AppState.addEventListener('change',state=>{if(state==='active')tick();});
    const unsubscribe=subscribeGameRoomChanges(()=>tick(false));
    return()=>{cancelRefresh();clearInterval(timer);subscription.remove();unsubscribe();};
  },[focused,scope,refreshOverview,readRound,waiting,job?.confirmed,session?.id,session?.completedAt,gameVersion]);
  useEffect(()=>{if(focused&&mode==='results'&&session?.result)markGameResultViewed(session.id,scope);},[focused,mode,session?.id,session?.result,scope]);
  const leave=()=>{
    if(closing.current)return;
    closing.current=true;
    operation.current++;request.current++;clearTimeout(choiceTimer.current);locked.current=false;
    // The real lobby/history stays mounted below this route. Do not redraw a
    // second lobby inside the outgoing game, or clear its local answer queue.
    router.back();
  };
  const back=leave;
  const begin=(next:GameSummary)=>{
    if(locked.current)return;
    if(!pricesReady||next.active===false)return;
    if(requirePartner(burrow)||!burrow)return;
    const state=gameCardState(next,overview,!!burrow?.hasPlus);
    if(state.kind==='plus'){locked.current=true;router.push('/(main)/(modals)/subscription-paywall' as Href);return;}
    // Catalogue cards always introduce the rules. Start resumes an unfinished
    // round locally; dedicated Continue / Results / History links keep theirs.
    const resume=overview.sessions.find(round=>round.gameId===next.id&&!round.completedAt);
    const open=()=>{
      locked.current=true;
      openPreparedBurrow({pathname:'/(main)/game-room',params:{gameId:next.id,...(resume?{resumeSessionId:resume.id}:{})}} as Href);
    };
    if(state.kind==='locked')void unlockSelected(next,open);else open();
  };
  const openRound=(row:GameSessionSummary)=>{
    if(locked.current)return;
    if(catalogue){
      locked.current=true;
      openPreparedBurrow({pathname:'/(main)/game-room',params:{gameId:row.gameId,sessionId:row.id,...(row.completedAt?{result:'1'}:{})}} as Href);
      return;
    }
    operation.current++;request.current++;setError(null);setVisit(n=>n+1);
    const cached=readLocalGame(row.id,scope)?.session??getCachedGameSession(row.id,scope);
    setSelected(overview.games.find(item=>item.id===row.gameId)??null);setTransition(cached?.ownAnswers.length===6&&cached.guesses.length===0);
    if(cached){requestedRound.current=undefined;setSession(cached);if(!cached.completedAt&&!cached.id.startsWith('local:'))void readRound(row.id,true).catch(()=>{});}
    else{requestedRound.current=row.id;setSession(null);void readRound(row.id,true).catch(()=>{});}
  };
  const start=(next:GameSummary)=>{
    if(locked.current||!pricesReady)return;
    if(requirePartner(burrow)||!burrow)return;
    const unfinished=overview.sessions.find(row=>row.gameId===next.id&&!row.completedAt);
    if(unfinished){openRound(unfinished);return;}
    if(next.active===false){Alert.alert('Unavailable','This game is not available right now.');return;}
    if(next.plus_only&&!burrow.hasPlus){router.push('/(main)/(modals)/subscription-paywall' as Href);return;}
    const enter=()=>{setSession(createLocalGame(next,undefined,{freeUnlock:next.price===0&&!overview.availableIds.includes(next.id)}));setSelected(next);setTransition(false);setVisit(n=>n+1);requestedRound.current=undefined;};
    if(overview.availableIds.includes(next.id)||next.price===0){try{enter();}catch{setError('Unable to save your game on this device.');}return;}
    void unlockSelected(next,enter);
  };
  async function unlockSelected(next:GameSummary,enter:()=>void){
    if(!burrow)return;
    const price=next.price??GAME_UNLOCK_PRICE;
        if(locked.current)return;locked.current=true;
        const token=++operation.current,epoch=sessionEpoch();
        let navigating=false;
        const current=()=>token===operation.current&&epoch===sessionEpoch()&&scopeRef.current===scope;
        try {
          let baseline=overview;
          // Open the same Shop confirmation immediately; authoritative price,
          // ownership and wallet checks still happen before any charge.
          if(price>0&&!await checkout.confirm({name:next.title,price,
            artwork:<Image source={gameRoomIcons[next.id]} contentFit="contain" style={{width:145,height:145}}/>,
            description:'Unlock once, play anytime.'}))return;
          if(!current()||!checkout.isCurrent())return;
          if(price>0){
            // A partner may already have unlocked this Free game while this
            // device was away. Revalidate ownership before charging or checking
            // balance; a stale offer can never authorize a payment.
            setBusy(true);setError(null);
            const latest=await gameOverview();
            if(!current()||!checkout.isCurrent())return;
            const cached=cacheGameOverview(latest,Date.now(),scope);setRemote(cached??latest);
            baseline=cached??latest;
            if(!latest.paired)throw Error('not_paired');
            if((cached??latest).availableIds.includes(next.id)){enter();navigating=catalogue;return;}
            const offer=latest.products?.[next.id];
            if(!offer||offer.active===false)throw Error('not_for_sale');
            if(offer.plus_only&&!burrow.hasPlus)throw Error('plus_required');
            if(offer.price!==price)throw Error('price_changed');
            if(burrow.wallet.balance<price){showInsufficientCoins();return;}
            setBusy(false);
          }
          if(!current()||!checkout.isCurrent())return;
          setBusy(true);setError(null);
          await unlockGame(next.id,price);
          if(!current()||!checkout.isCurrent())return;
          const updated={...baseline,availableIds:[...new Set([...baseline.availableIds,next.id])],ownedIds:[...new Set([...baseline.ownedIds,next.id])]};
          const cached=cacheGameOverview(updated,Date.now(),scope);setRemote(cached??updated);enter();navigating=catalogue;void refreshBurrow({silent:true});
        }catch(e){
          if(!current()||!checkout.isCurrent())return;
          void refreshOverview().catch(()=>{});void refreshBurrow({silent:true});
          if(e instanceof Error&&e.message==='plus_required'){router.push('/(main)/(modals)/subscription-paywall' as Href);return;}
          if(isInsufficientCoins(e))showInsufficientCoins();
          else setError(userErrorMessage(e,'Couldn’t unlock this game. Please try again.'));
        }finally{if(current()){locked.current=navigating;setBusy(false);}}
  }
  const answer=(choice:number)=>{
    if(locked.current||!session||!game||mode!=='question')return;
    try{
      locked.current=true;
      const draft=job?.session??createLocalGame(game,session);
      const next=saveLocalGameAnswer(draft.id,phase,index,choice);
      setError(null);setHold({choice,phase,index});void haptics.selection().catch(()=>{});
      const token=++operation.current;
      choiceTimer.current=setTimeout(()=>{
        if(token!==operation.current)return;
        setSession(next);setHold(null);locked.current=false;
        if(phase==='own'&&next.ownAnswers.length===6)setTransition(true);
      },160); // Selection acknowledgement, not a server wait.
    }catch{locked.current=false;setError('Your answer could not be saved on this device. Please try again.');}
  };
  const notify=()=>{
    if(!session||busy||locked.current)return;
    locked.current=true;
    const token=++operation.current,epoch=sessionEpoch(),current=()=>token===operation.current&&epoch===sessionEpoch()&&scopeRef.current===scope;
    setBusy(true);
    void (async()=>{
      // Finish/retry local delivery first; never send an invalid local: ID.
      await resumeLocalGames();
      if(!current())return;
      const latest=readLocalGame(session.id,scope);
      const id=latest?.sessionId??job?.sessionId??session.id;
      if(id.startsWith('local:')||(latest&&!latest.confirmed))throw Error('delivery_pending');
      const receipt=await nudgeGame(id);
      if(current())showBurrowToast(receipt.alreadySent?'You’ve already nudged them today.':receipt.finished?'Your partner has already finished.':'Reminder sent.');
    })().catch(()=>{if(current())setError('Couldn’t send a reminder yet. Please try again.');}).finally(()=>{if(current()){setBusy(false);locked.current=false;}});
  };
  const attention=(rows:GameSessionSummary[],heading:string,action:string)=>rows.length>0&&<View style={st.attention}>
    <Text style={st.sectionTitle}>{heading}</Text>{rows.map(row=>{
      const item=overview.games.find(g=>g.id===row.gameId);return <Pressable key={row.id} accessibilityRole="button" accessibilityLabel={action+' '+item?.title}
        onPress={()=>openRound(row)} style={st.attentionCard}>
        <Image source={gameRoomIcons[row.gameId]} contentFit="contain" style={st.attentionIcon}/>
        <Text style={st.attentionTitle} numberOfLines={2}>{item?.title}</Text>
        <View style={st.attentionAction}><Text style={st.attentionActionText}>{action}</Text></View>
      </Pressable>;
    })}</View>;
  const rails=(items:GameSummary[])=> <FlatList horizontal data={gameRailItems(items)} keyExtractor={g=>g.id} initialNumToRender={4}
    maxToRenderPerBatch={4} windowSize={3} showsHorizontalScrollIndicator={false} contentContainerStyle={st.rail}
    renderItem={({item})=><GameTile game={item} width={tileWidth} state={gameCardState(item,overview,!!burrow?.hasPlus)} onSelect={begin}/>}/>;
  const ready=overview.sessions.filter(row=>row.completedAt&&!row.resultViewedAt&&!gameResultViewed(row.id,scope)
    &&!!(getCachedGameSession(row.id,scope)?.result||readLocalGame(row.id,scope)?.session.result));
  const active=overview.sessions.filter(row=>!row.completedAt),incoming=active.filter(row=>row.ownCount===0&&row.guessCount===0
    &&row.partnerOwnCount===6&&row.partnerGuessCount===6
    &&!!(getCachedGameSession(row.id,scope)||readLocalGame(row.id,scope)));
  const continuing=active.filter(row=>(row.ownCount<6||row.guessCount<6)&&!incoming.some(invite=>invite.id===row.id));
  const pendingPartner=active.filter(row=>row.ownCount===6&&row.guessCount===6);
  const personAvatar=(mine:boolean,size=52)=>{
    const person=mine?burrow?.profile:burrow?.partner,other=mine?burrow?.partner:burrow?.profile;
    return <UserAvatar userId={person?.id} otherUserId={other?.id} name={person?.display_name}
      avatarUrl={person?.avatar_url} isDefaultAvatar={person?.is_default_avatar} size={size}/>;
  };
  const flowTop=mode==='results'?49:mode==='question'?Math.max(20,height*.145-insets.top):0;
  return <View style={st.root}>
    <AdventureStageTransition stageKey={stageKey} nativePage={catalogue}>
    <View style={st.root}>
    <View style={[st.top,{paddingTop:insets.top+8,paddingBottom:mode==='results'?0:16}]}>
      <BurrowBackButton light onPress={back}/>
      {catalogue?<Text accessibilityRole="header" style={[st.topTitle,ROOM_TITLE_STYLE,{textAlign:'center'}]}>Game Room</Text>:<View style={{flex:1}}/>}
      {catalogue&&<Pressable accessibilityRole="button" accessibilityLabel="Game History" style={st.historyButton}
        onPress={()=>void openHistory()}>
        <Feather name="clock" size={26} color="#FFF0DA"/>
      </Pressable>}
    </View>
    {!pricesReady&&!session?<View style={{flex:1,alignItems:'center',justifyContent:'center',gap:18}}><ActivityIndicator color={cream}/><Text style={st.hintLight}>Preparing your games…</Text><Button label="Retry" onPress={()=>void refreshBurrow({silent:true})}/></View>:catalogue?<FlatList data={overview.categories} keyExtractor={category=>category}
      initialNumToRender={2} maxToRenderPerBatch={2} windowSize={4}
      contentContainerStyle={{paddingBottom:insets.bottom+28}} showsVerticalScrollIndicator={false}
      ListHeaderComponent={<>
        {error&&<Text style={st.errorLight}>{error}</Text>}
        {attention(ready,'Game result awaiting to be checked','Check')}
        {attention(incoming,'Game from '+partnerName,'Play')}
        {attention(continuing,'Continue your game','Open')}
        {attention(pendingPartner,'Waiting for '+partnerName,'Open')}
      </>}
      renderItem={({item:category})=><View style={st.category}><Text style={[st.sectionTitle,st.railHeading]}>{category}</Text>{rails(overview.games.filter(g=>g.category===category))}</View>}/>
    :<><ScrollView bounces={false} showsVerticalScrollIndicator={false} style={{flex:1}}
      contentContainerStyle={[st.flow,{minHeight:fixedFooter?0:minBody,paddingTop:flowTop,paddingBottom:fixedFooter?24:insets.bottom+24}]}>
      {error&&<Text style={st.errorLight}>{error}</Text>}
      {job?.supersededDraft&&<Text style={st.hintLight}>This game finished on another device. Showing your confirmed result.</Text>}
      {job?.error&&<Pressable accessibilityRole="button" onPress={()=>retryLocalGame(session!.id,scope)}>
        <Text style={st.hintLight}>Your answers are on this device. {job.blocked?'Tap to retry sending.':'We’ll retry sending in the background.'}</Text>
      </Pressable>}
      {mode==='opening'&&<Panel style={{marginTop:36}}><Text style={st.panelTitle}>Your game</Text>
        <Text style={st.body}>Your saved round will appear here.</Text>
        {error&&<Button label="Try again" onPress={()=>{if(requestedRound.current)void readRound(requestedRound.current,true).catch(()=>{});}}/>}</Panel>}
      {mode==='intro'&&game&&<>
        <View style={st.introHero}><View style={st.categoryPill}><Text style={st.categoryText}>{game.category}</Text></View>
          <Text style={st.heroTitle}>{game.title}</Text><Text style={st.heroSub}>{game.hook}</Text></View>
        <Panel style={{paddingVertical:8}}>{['Answer all 6 questions about yourself','Guess your partner’s answers','Compare answers and see who won!'].map((text,i)=>
          <View key={i}><View style={st.rule}><Avatar name={String(i+1).padStart(2,'0')}/>
            <Image source={BURROW_GAME_RULE_ICONS[i]} contentFit="contain" style={{width:55,height:55}}/><Text style={st.ruleText}>{text}</Text></View>{i<2&&<View style={st.divider}/>}</View>)}</Panel>
        <View style={st.footer}><Button disabled={busy||game.active===false} label={busy?'Opening…':'Start Game'} onPress={()=>start(game)}/></View>
      </>}
      {mode==='question'&&session&&question&&<>
        <View style={st.questionHero}><Text style={st.eyebrow}>Step {phase==='own'?'1':'2'} of 2</Text>
          <Text style={st.heroTitle}>{phase==='own'?'Your answers':'Guess their answer'}</Text>
          <View style={st.progressRow}><Text style={st.progressLabel}>{index+1} of 6</Text>{Array.from({length:6},(_,i)=><View key={i} style={[st.dot,i<index&&st.dotDone,i===index&&st.dotCurrent]}/>)}</View>
        </View>
        <Panel><Text style={st.question}>{phase==='own'?question.self:question.partner.replaceAll('[Name]',partnerName)}</Text>
          {question.options.map((option,i)=><Pressable key={i} accessibilityRole="button" accessibilityLabel={labels[i]+'. '+option}
            accessibilityState={{selected:selection?.choice===i,disabled:!!selection}} disabled={!!selection} onPress={()=>answer(i)}
            style={({pressed})=>[st.option,(pressed||selection?.choice===i)&&st.optionSelected]}>
            <View style={st.optionLetter}><Text style={st.optionLetterText}>{labels[i]}</Text></View><Text style={st.optionText}>{option}</Text>
            {phase==='own'&&(selection?.choice===i?<Check/>:<View style={st.radio}/>)}
          </Pressable>)}</Panel>
      </>}
      {mode==='transition'&&<><View style={st.completeHeading}><View style={st.completeCheck}><Feather name="check" size={24} color={cream}/></View>
        <Text style={st.eyebrow}>Step 1 Complete</Text></View>
        <Panel style={st.transitionPanel}><Image source={BURROW_GAME_RULE_ICONS[1]} contentFit="contain" style={st.transitionArt}/>
          <Text style={st.panelHero}>Now, think like {partnerName}</Text><Text style={[st.body,{textAlign:'center',color:ink}]}>Choose the answer you think they would pick</Text></Panel>
        <View style={st.footer}><Button label="Continue" onPress={()=>setTransition(false)}/></View></>}
      {mode==='waiting'&&session&&<>
        <View style={[st.statusHero,{paddingTop:Math.max(20,height*.055)}]}><Image source={waitingArt} contentFit="contain" style={st.waitingArt}/>
          <Text style={st.statusTitle}>You finished your round</Text></View>
        <Panel style={{marginTop:12}}><View style={st.waitRow}>{personAvatar(true)}<Text style={st.waitTitle}>12/12 completed</Text><Check/></View>
          <View style={st.divider}/><View style={st.waitRow}>{personAvatar(false)}<Text style={st.waitTitle}>Not finished yet</Text>
            <View style={st.waitDots}>{[1,.5,.25].map((opacity,i)=><View key={i} style={[st.scoreDot,{backgroundColor:'#F5A526',opacity}]}/>)}</View></View>
          <View style={st.lockNotice}><Feather name="lock" color={muted} size={22}/><Text style={[st.body,{flex:1,fontSize:15}]}>Results unlock when you both finish.</Text></View></Panel>
      </>}
      {mode==='results'&&session?.result&&<>
        <Panel style={st.resultPanel}><Image source={BURROW_GAME_RULE_ICONS[2]} contentFit="contain" style={st.resultArt}/>
          <View style={[st.categoryPill,{alignSelf:'center'}]}><Text style={st.categoryText}>{game?.title}</Text></View>
          <Text style={st.resultTitle}>{session.result.outcome==='win'?'You win!':session.result.outcome==='lose'?'You lose!':'It’s a draw!'}</Text>
          <View style={st.scoreRow}>{[{value:session.result.mine,color:orange},{value:session.result.partner,color:'#F5A526'}].map((item,i)=>
          <View key={i} style={[st.scoreCell,i===0&&{borderRightWidth:1,borderColor:'#E9DECF'}]}>{personAvatar(i===0,48)}<Text style={st.score}>{item.value}/6</Text><ScoreDots count={item.value} color={item.color}/></View>)}</View>
          <View style={st.divider}/></Panel>
        {session.result&&<Panel><View style={st.matchHeading}><Text style={st.matchHeadingText}>How well you know {partnerName}</Text></View>
          {session.questions.map((q,i)=>{
            const actual=session.partnerOwnAnswers?.[i]??-1,guess=session.guesses[i],correct=actual===guess;
            return <View key={i} style={st.matchRow}><Avatar small name={String(i+1).padStart(2,'0')}/><View style={{flex:1,gap:8}}>
              <Text style={st.matchTitle}>{questionHeading(q.self)}</Text><View style={st.answerColumns}><View style={st.answerColumn}><View style={st.answerLabelRow}><Text numberOfLines={1} adjustsFontSizeToFit style={[st.answerLabel,{flex:1}]}>{partnerName} chose</Text></View><Text style={st.answerValue}>{q.options[actual]}</Text></View>
                <View style={[st.answerColumn,{borderLeftWidth:1,borderColor:'#E9DECF',paddingLeft:10}]}><View style={st.answerLabelRow}><Text numberOfLines={1} adjustsFontSizeToFit style={[st.answerLabel,{flexShrink:1}]}>You guessed</Text><Check compact correct={correct}/></View><Text style={st.answerValue}>{q.options[guess]}</Text></View></View></View></View>;
          })}
          </Panel>}
      </>}
    </ScrollView>{fixedFooter&&<View style={[st.fixedFooter,{paddingBottom:Math.max(24,insets.bottom+8)}]}>
      {mode==='waiting'?<><Text style={st.hintLight}>You can leave now, we will let you know when the result is ready</Text>
        <Button disabled={busy} label={busy?'Sending…':'Nudge '+partnerName+' to play'} onPress={notify}/></>
      :<Button label="Done" onPress={fromHistory?back:leave}/>}
    </View>}</>}
    </View>
    </AdventureStageTransition>
    {!fromHistory&&mode==='results'&&session?.result&&<ReflectCelebration key={session.id+':'+visit} active={focused}/>}
  </View>;
}
const st=StyleSheet.create({
  root:{flex:1,backgroundColor:'#492817'},top:{flexDirection:'row',alignItems:'center',paddingHorizontal:18,gap:12,paddingBottom:16},
  topTitle:{flex:1,color:cream,fontSize:23,fontWeight:'800'},historyButton:{width:44,height:44,borderRadius:22,backgroundColor:'#FFFFFF30',alignItems:'center',justifyContent:'center'},
  flow:{paddingHorizontal:16,paddingTop:8,flexGrow:1,gap:20},panel:{backgroundColor:cream,borderRadius:25,padding:18,gap:16,shadowColor:'#BD8963',shadowOpacity:.4,shadowOffset:{width:0,height:4},shadowRadius:0,elevation:4},
  heroTitle:{color:cream,fontSize:34,lineHeight:42,fontWeight:'900'},heroSub:{color:cream,fontSize:18,lineHeight:25},eyebrow:{color:cream,fontSize:17,lineHeight:24,fontWeight:'400'},
  panelTitle:{color:ink,fontSize:25,fontWeight:'800'},panelHero:{color:ink,fontSize:27,lineHeight:34,fontWeight:'900',textAlign:'center'},body:{color:muted,fontSize:17,lineHeight:24},
  button:{minHeight:52,borderRadius:24,paddingVertical:16,paddingHorizontal:16,backgroundColor:'#FFC547',alignItems:'center',justifyContent:'center'},
  buttonText:{color:ink,fontSize:20,fontWeight:'800',textAlign:'center'},secondaryButton:{backgroundColor:'transparent',borderWidth:1.5,borderColor:'#F5D9C7',shadowOpacity:0,elevation:0},secondaryText:{color:cream},footer:{marginTop:'auto',paddingTop:24,gap:14},
  fixedFooter:{paddingHorizontal:16,paddingTop:12,gap:12},
  sectionTitle:{color:cream,fontSize:19,lineHeight:25,fontWeight:'800'},category:{marginTop:22,gap:10},railHeading:{paddingHorizontal:18},rail:{paddingHorizontal:18,gap:9,paddingBottom:8},
  tile:{backgroundColor:'#EEE9D9',borderRadius:15,paddingHorizontal:8,paddingVertical:12,alignItems:'center',justifyContent:'space-between',shadowColor:'#26160F',shadowOpacity:.4,shadowOffset:{width:0,height:3},shadowRadius:0,elevation:3},
  tileTitle:{color:ink,fontSize:11,lineHeight:13,minHeight:26,width:'100%',fontWeight:'800',textAlign:'center'},
  tileStatus:{height:26,alignItems:'center',justifyContent:'center'},tilePrice:{color:ink,fontSize:14,fontWeight:'800'},
  tilePlus:{height:25,borderRadius:14,backgroundColor:orange,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:5,paddingHorizontal:12},tilePlusText:{color:cream,fontSize:12,fontWeight:'900'},
  tileChecks:{flexDirection:'row',alignItems:'center',gap:6},tileCheck:{width:24,height:24,borderRadius:12,backgroundColor:'#AA9B82',alignItems:'center',justifyContent:'center'},tileCheckDone:{backgroundColor:'#FF7920'},
  attention:{paddingHorizontal:18,marginTop:18,gap:12},attentionCard:{backgroundColor:'#EEE9D9',borderRadius:15,minHeight:68,padding:14,flexDirection:'row',alignItems:'center',gap:14},
  attentionIcon:{width:40,height:40},attentionTitle:{flex:1,color:ink,fontSize:15,fontWeight:'800'},attentionAction:{backgroundColor:'#794519',borderRadius:13,paddingHorizontal:14,paddingVertical:11},attentionActionText:{color:cream,fontSize:15,fontWeight:'800'},
  introHero:{paddingTop:34,paddingBottom:22,paddingHorizontal:6,gap:16},categoryPill:{alignSelf:'flex-start',backgroundColor:'#FFDA4F',borderRadius:8,paddingHorizontal:8,paddingVertical:5},categoryText:{color:ink,fontSize:14,fontWeight:'800'},
  rule:{minHeight:88,paddingVertical:14,flexDirection:'row',alignItems:'center',gap:16},ruleText:{flex:1,color:ink,fontSize:17,lineHeight:23,fontWeight:'700'},divider:{height:1,backgroundColor:'#E9DECF'},
  avatar:{width:48,height:48,borderRadius:24,backgroundColor:'#F4E8D9',alignItems:'center',justifyContent:'center'},avatarText:{color:ink,fontWeight:'800',fontSize:19,paddingHorizontal:5},
  questionHero:{paddingTop:12,paddingHorizontal:18,gap:4},progressRow:{flexDirection:'row',alignItems:'center',gap:10,marginTop:20,paddingBottom:4},progressLabel:{color:'#F5D4BE',fontWeight:'700',fontSize:16,marginRight:6},
  dot:{width:16,height:16,borderRadius:8,borderColor:'#BA9073',borderWidth:1.5},dotDone:{backgroundColor:orange,borderColor:orange},dotCurrent:{backgroundColor:'#F8A62A',borderColor:cream},
  question:{color:ink,fontSize:23,lineHeight:30,fontWeight:'900',marginBottom:2},option:{minHeight:58,borderWidth:1.5,borderColor:'#EEE4D9',borderRadius:15,paddingHorizontal:12,paddingVertical:10,flexDirection:'row',alignItems:'center',gap:12},
  optionSelected:{borderColor:orange,backgroundColor:'#FFF3E9'},optionLetter:{width:34,height:34,borderRadius:17,backgroundColor:'#F4E8D9',alignItems:'center',justifyContent:'center'},optionLetterText:{color:ink,fontSize:18,fontWeight:'800'},
  optionText:{flex:1,color:ink,fontSize:16,lineHeight:22,fontWeight:'700'},radio:{width:30,height:30,borderRadius:15,borderWidth:1.5,borderColor:'#B6A18B'},
  check:{width:32,height:32,borderRadius:16,backgroundColor:orange,alignItems:'center',justifyContent:'center'},miss:{backgroundColor:'#E96566'},
  resultCheck:{width:18,height:18,borderRadius:9},resultCorrect:{backgroundColor:'#388A54'},
  hintLight:{color:'#F5D4BE',fontSize:14,lineHeight:21,textAlign:'center'},hint:{color:muted,fontSize:13,lineHeight:20,textAlign:'center'},errorLight:{color:cream,fontSize:15,lineHeight:22,paddingHorizontal:18},
  completeHeading:{marginTop:11,marginBottom:68,alignItems:'center',gap:12},completeCheck:{backgroundColor:'#DF603B',width:44,height:44,borderRadius:22,alignItems:'center',justifyContent:'center'},
  transitionPanel:{marginHorizontal:7,alignItems:'center',paddingVertical:38,paddingHorizontal:32,gap:25},transitionArt:{width:76,height:76},
  statusHero:{paddingTop:32,paddingHorizontal:6,gap:24,alignItems:'center'},waitingArt:{width:64,height:64},heroRow:{flexDirection:'row',alignItems:'center',gap:8},statusTitle:{color:cream,fontSize:25,lineHeight:32,fontWeight:'900',textAlign:'center'},
  resultPanel:{paddingTop:29,gap:18},resultArt:{width:90,height:76,position:'absolute',alignSelf:'center',top:-49},resultTitle:{color:ink,fontSize:30,lineHeight:38,fontWeight:'900',textAlign:'center'},
  matchHeading:{alignSelf:'center',backgroundColor:'#915B39',borderRadius:7,paddingHorizontal:12,paddingVertical:7,marginBottom:12},matchHeadingText:{color:cream,fontSize:17,fontWeight:'800'},answerLabelRow:{height:20,flexDirection:'row',alignItems:'center',gap:5},
  waitRow:{flexDirection:'row',alignItems:'center',gap:14,paddingVertical:8},waitTitle:{flex:1,color:ink,fontSize:19,lineHeight:25,fontWeight:'800'},waitDots:{flexDirection:'row',gap:7},lockNotice:{flexDirection:'row',gap:14,alignItems:'center',padding:14,backgroundColor:'#F5EDE1',borderRadius:16},
  scoreRow:{flexDirection:'row'},scoreCell:{flex:1,alignItems:'center',gap:7},score:{color:ink,fontSize:26,lineHeight:31,fontWeight:'900'},scoreDots:{flexDirection:'row',gap:7},scoreDot:{width:13,height:13,borderRadius:7},
  matchRow:{flexDirection:'row',alignItems:'flex-start',gap:12,paddingVertical:12,borderBottomWidth:1,borderColor:'#E9DECF'},matchTitle:{color:ink,fontSize:16,lineHeight:22,fontWeight:'800'},answerColumns:{flexDirection:'row',gap:10},answerColumn:{flex:1,gap:4},
  answerLabel:{color:muted,fontSize:12,lineHeight:17},answerValue:{color:ink,fontSize:14,lineHeight:20,fontWeight:'600'},matchStatus:{alignItems:'center',gap:4},
  seeAnswers:{borderRadius:16,backgroundColor:'#F5EDE1',minHeight:48,padding:12,alignItems:'center',justifyContent:'center'},seeAnswersText:{color:ink,fontSize:16,fontWeight:'800'},scrim:{flex:1,backgroundColor:'#1E100DBB',alignItems:'center',justifyContent:'center',padding:24},
});
