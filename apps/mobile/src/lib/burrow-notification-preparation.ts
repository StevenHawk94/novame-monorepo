import type { MajorUpdateBootstrap } from './app-major-update-api';
import { AppState } from 'react-native';
import { getBurrowSnapshot } from './burrow-store';
import { sessionEpoch, sessionUserId } from './session-lifecycle';
import { notificationReadiness, type NotificationDestination } from './notification-readiness';
import { notificationScope, notificationContentVersion } from './notification-content-version';
import { warmBurrowGameOverview } from './burrow-page-entry';
import { gameSession } from './burrow-game-room-api';
import { cacheGameSession, getCachedGameOverview, getCachedGameSession, retainNotificationGameSessions } from './burrow-game-room-cache';
import { reconcileLocalGame } from './burrow-game-local';
import { prepareCoupleJournal } from './couple-journal';
import { prepareLoveNotes, loveNotesReady } from './use-love-notes';
import { momentsCache } from './moments-cache';
import { warmFriendVisit } from './friend-visit-local';
import { warmAdventureCompletion } from './adventure-prefetch';
import { warmBurrowPageArt } from './burrow-page-art';
import { unreadBurrowUpdateIds } from './burrow-attention';
import { prepareShopGifts } from './shop-gift-preparation';
import { yieldToUi } from './ui-idle';

/** Notification work is independent of screen focus and of optional catalogue
 * warmups. A failed destination cannot hold up another channel's ready badge. */
export function prepareBurrowNotifications(data:MajorUpdateBootstrap):Promise<unknown>{
  if(data.profile.id!==sessionUserId()||(data.partner&&!data.pairAccessVerified))return Promise.resolve();
  const scope=notificationScope(data),epoch=sessionEpoch();
  const current=(kind:NotificationDestination,version:string)=>{
    const latest=getBurrowSnapshot().data;
    return AppState.currentState==='active'&&epoch===sessionEpoch()&&data.profile.id===sessionUserId()&&!!latest&&notificationScope(latest)===scope
      &&(!latest.partner||latest.pairAccessVerified===true)&&notificationContentVersion(latest,kind)===version;
  };
  const run=(kind:NotificationDestination,work:(valid:()=>boolean)=>Promise<void>)=>{
    const version=notificationContentVersion(data,kind),valid=()=>current(kind,version);
    return notificationReadiness.prepare(scope,kind,version,async()=>{await work(valid);await yieldToUi();},valid);
  };
  return Promise.all([
    run('gifts',valid=>prepareShopGifts(data,valid)),
    run('games',async valid=>{
      if(!data.partner)return;
      await warmBurrowGameOverview({force:true});if(!valid())return;
      const required=unreadBurrowUpdateIds(data,'games').map(id=>({id:id.split(':')[0],result:id.endsWith(':result'),invite:id.endsWith(':invite')}));
      for(const row of getCachedGameOverview(scope)?.sessions??[]){
        if((!row.completedAt||!row.resultViewedAt)&&!required.some(item=>item.id===row.id))required.push({id:row.id,result:!!row.completedAt,
          invite:row.ownCount===0&&row.partnerOwnCount===6&&row.partnerGuessCount===6});
      }
      retainNotificationGameSessions(required.map(row=>row.id),scope);
      // Two reads at a time: no 200-request fan-out after a long absence.
      let cursor=0;
      await Promise.all([0,1].map(async()=>{while(cursor<required.length){
        const row=required[cursor++];
        const cached=getCachedGameSession(row.id,scope),summary=getCachedGameOverview(scope)?.sessions.find(item=>item.id===row.id);
        if(cached&&summary&&cached.completedAt===summary.completedAt&&cached.ownAnswers.length===summary.ownCount
          &&cached.guesses.length===summary.guessCount&&cached.partnerOwnCount===summary.partnerOwnCount&&cached.partnerGuessCount===summary.partnerGuessCount
          &&(!row.result||cached.result&&cached.partnerOwnAnswers&&cached.partnerGuesses)
          &&(!row.invite||cached.partnerOwnCount===6&&cached.partnerGuessCount===6))continue;
        const value=await gameSession(row.id);if(!valid())return;
        if(row.result&&(!value.completedAt||!value.result||!value.partnerOwnAnswers||!value.partnerGuesses))throw Error('result_not_ready');
        if(row.invite&&(value.partnerOwnCount!==6||value.partnerGuessCount!==6))throw Error('invite_not_ready');
        await yieldToUi();if(!valid())return;
        cacheGameSession(reconcileLocalGame(value,scope),Date.now(),scope);
      }}));
      if(!valid())return;
      const overview=getCachedGameOverview(scope);
      if(required.some(row=>!getCachedGameSession(row.id,scope)||!overview?.sessions.some(round=>round.id===row.id)))throw Error('game_summary_not_ready');
      void warmBurrowPageArt('game',data,{retain:false}).catch(()=>{});
    }),
    run('journal',async valid=>{await prepareCoupleJournal(data,valid);}),
    run('letters',async valid=>{await prepareLoveNotes(data,valid);if(valid()&&!loveNotesReady(data))throw Error('letters_not_ready');}),
    run('moments',async valid=>{
      await momentsCache.prepare(data);
      const required=new Set(unreadBurrowUpdateIds(data,'moments')),cursors=new Set<string>();let pages=0;
      while(valid()){
        const value=momentsCache.read(data);
        if(value.error||!value.page||value.loading)throw Error('moments_not_ready');
        const available=new Set(value.page.rows.map(row=>`${row.id}:${row.created_at}`));
        if([...required].every(id=>available.has(id)))return;
        const cursor=JSON.stringify(value.page.next);
        if(!value.page.hasMore||!value.page.next||cursors.has(cursor))throw Error('moment_revision_not_ready');
        if(pages++===4)throw Error('notification_batch_pending');
        cursors.add(cursor);await momentsCache.more(data);
      }
    }),
    run('visits',async()=>{if(data.friendVisit)await warmFriendVisit(data);}),
    ...(data.activeAdventure?[run('adventure',async()=>{
      if(!data.adventureResult&&!data.adventurePlan)throw Error('adventure_plan_not_ready');
      await warmAdventureCompletion(data);
    })]:[]),
  ]);
}
