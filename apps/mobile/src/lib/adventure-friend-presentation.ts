import type { MajorUpdateBootstrap } from './app-major-update-api';
import {adventureFriendGender} from './adventure-friend-identity';

const RETURNING_HEADINGS = [
  '[name] is hanging around.',
  '[name] just popped out of the dirt.',
  '[name] is snacking on some roots.',
  'You ran into [name].',
  'You bumped into [name].',
  '[name] is nearby.',
  '[name] crossed your path.',
  '[name] is around the corner.',
] as const;

export type AdventureFriendPresentation = {
  isNewFriend: boolean;
  friendName: string;
  heading: string;
  introduction: string;
  talkLabel: string;
};

/** Resolve once per journey from the already-loaded personal collection.
 * Legacy chest claims can discover this friend before the conversation opens:
 * that journey's own discovery is not evidence of an earlier meeting. */
export function adventureFriendPresentation(data: MajorUpdateBootstrap, random = Math.random): AdventureFriendPresentation {
  const result = data.adventureResult, snapshot = result?.metadata?.friendSnapshot;
  const friendId = result?.friend_id ?? snapshot?.stable_id;
  const friendName = snapshot?.name ?? data.friends?.find(friend => friend.stable_id === friendId)?.name ?? 'Your friend';
  const discoveredPreviously = !!friendId && !!data.profile?.id && !!data.discoveries?.some(discovery =>
    discovery.user_id === data.profile.id && discovery.friend_id === friendId
    && discovery.source_adventure_id !== data.activeAdventure?.id);
  // Progress belongs to the current user, unlike discoveries (which include the partner).
  const completedPreviously = !!friendId && !!data.adventureCollection?.progress?.some(progress =>
    progress.friend_id === friendId && progress.completed > 0);
  const isNewFriend = !discoveredPreviously && !completedPreviously;
  const gender = adventureFriendGender(snapshot,data.friends?.find(friend=>friend.stable_id===friendId),friendId,friendName);
  return {
    isNewFriend,
    friendName,
    heading: isNewFriend ? 'You met a new friend!' : RETURNING_HEADINGS[Math.floor(random() * RETURNING_HEADINGS.length)].replace('[name]', friendName),
    introduction: `You ran into ${friendName} down in the burrow.`,
    talkLabel: gender === 'she' ? 'Talk to her' : gender === 'he' ? 'Talk to him' : 'Talk',
  };
}
