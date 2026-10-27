import friendBounds from './adventure-friend-bounds.json';
import bodyAnchors from './adventure-friend-body-anchors.json';
import {friendPanelBudget} from './friend-text-layout';

export type FriendBounds = readonly [number, number, number, number];
export type FriendGeometry = readonly [FriendBounds, FriendBounds];
const FALLBACK_GEOMETRY: FriendGeometry = [[0, 0, 768, 768], [0, 0, 768, 768]];
export const FRIEND_OVERLAP = .15;
export const FRIEND_SIZE_SCALE = .7;

const catalogue=Object.entries(friendBounds) as unknown as [keyof typeof bodyAnchors,FriendGeometry][];
const same=(a:FriendGeometry,b:FriendGeometry)=>a.every((pose,i)=>pose.every((v,j)=>v===b[i][j]));
// One width limit for the entire cast, including off-centre hands and tails.
const widestHalf=Math.max(...catalogue.flatMap(([name,poses])=>poses.map((b,i)=>
  Math.max(bodyAnchors[name][i]-b[0],b[2]-bodyAnchors[name][i])/(b[3]-b[1]))));

/** Equal alpha-visible height, equal baseline, torso centred (not the canvas or
 * the extended arm). Independent pose scales preserve aspect ratio. */
export function adventureEncounterLayout(width: number, height: number, geometry = FALLBACK_GEOMETRY, answered = false,
  _panelMode:'dialogue'|'visit-invite'|'visit-quiet'='dialogue', measuredPanelHeight?:number) {
  const budget=friendPanelBudget(height),panelHeight = measuredPanelHeight??budget.base;
  const panelTop = height - panelHeight;
  const actorPanelTop=panelTop;
  const reservedPanel=Math.max(budget.base,budget.max);
  const headingBottom = Math.min(92,Math.max(76,(height-reservedPanel)*.35));
  const bounds = geometry[answered ? 1 : 0],name=catalogue.find(([,g])=>same(g,geometry))?.[0];
  const bodyCenter=name?bodyAnchors[name][answered?1:0]:(bounds[0]+bounds[2])/2;
  const visibleHeight=Math.max(1,Math.min((width/2-8)/widestHalf,
    FRIEND_SIZE_SCALE*(height-budget.base-headingBottom)/(1-FRIEND_OVERLAP),
    (height-reservedPanel-headingBottom)/(1-FRIEND_OVERLAP)));
  const scale=visibleHeight/(bounds[3]-bounds[1]);
  return {
    panelHeight, panelTop, actorPanelTop, headingBottom,
    image: {
      left: width/2-bodyCenter*scale,
      top: actorPanelTop - (bounds[1] + (1 - FRIEND_OVERLAP) * (bounds[3] - bounds[1])) * scale,
      width: 768 * scale, height: 768 * scale,
    },
    visibleTop: actorPanelTop - (1 - FRIEND_OVERLAP) * visibleHeight,
    visibleBottom: actorPanelTop + FRIEND_OVERLAP * visibleHeight,
    visibleHeight,bodyCenterX:width/2,
  };
}
