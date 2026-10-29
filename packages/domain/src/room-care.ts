/** Four distinct actions. A room owner's care cannot consume helper care. */
export const ROOM_CARE_ACTIONS = ['carrot','water','leaf','fertilizer'] as const;
export type RoomCareAction = typeof ROOM_CARE_ACTIONS[number];
export const ROOM_CARE_COOLDOWN_MS = 12 * 60 * 60 * 1000;
export const ROOM_CARE_REWARD = 5;
export const roomCareAction = (need:'food'|'water', helper:boolean):RoomCareAction =>
  helper ? need==='food'?'leaf':'fertilizer' : need==='food'?'carrot':'water';
export const roomCareIsOwn = (action:RoomCareAction) => action==='carrot'||action==='water';
/** Keep legacy helper ledger keys: an old pending command cannot pay twice. */
export function roomCareRewardKey(action:RoomCareAction, day:string) {
  return action==='leaf'?`room-need-reward:food:${day}`:action==='fertilizer'?`room-need-reward:water:${day}`
    :`room-care-reward:${action}:${day}`;
}
export type RoomCareStatus = {lastAt:string|null;nextAt:string|null};
export type RoomCareState = {version:2;actorId:string;partnerId:string|null;pairVersion:string|null;
  own:Record<RoomCareAction,RoomCareStatus>;partner:Record<RoomCareAction,RoomCareStatus>|null};
