export type FriendBounds = readonly [number, number, number, number];
export type FriendGeometry = readonly [FriendBounds, FriendBounds];
const FALLBACK_GEOMETRY: FriendGeometry = [[0, 0, 768, 768], [0, 0, 768, 768]];
export const FRIEND_OVERLAP = .15;
export const FRIEND_SIZE_SCALE = .7;

/** Coordinates use alpha bounds, not the square WebP's transparent padding.
 * Both poses share one scale and horizontal anchor; their 85% height mark is
 * tied to the canonical actor-stage panel top. Welcome, dialogue, choices and
 * farewell share that same panel; text and visit state never affect geometry. */
export function adventureEncounterLayout(width: number, height: number, geometry = FALLBACK_GEOMETRY, answered = false,
  _panelMode:'dialogue'|'visit-invite'|'visit-quiet'='dialogue') {
  const dialoguePanelHeight=Math.min(height * .48, Math.max(220, height * .4));
  const panelHeight = dialoguePanelHeight;
  const panelTop = height - panelHeight;
  const actorPanelTop=panelTop;
  const headingBottom = Math.min(92, actorPanelTop * .35);
  const first = geometry[0], second = geometry[1], bounds = geometry[answered ? 1 : 0];
  const left = Math.min(first[0], second[0]), right = Math.max(first[2], second[2]);
  const tallest = Math.max(first[3] - first[1], second[3] - second[1]);
  const scale = FRIEND_SIZE_SCALE * Math.min(width * .86 / (right - left), (actorPanelTop - headingBottom) / ((1 - FRIEND_OVERLAP) * tallest));
  const visibleHeight = (bounds[3] - bounds[1]) * scale;
  return {
    panelHeight, panelTop, actorPanelTop, headingBottom,
    image: {
      left: (width - (right - left) * scale) / 2 - left * scale,
      top: actorPanelTop - (bounds[1] + (1 - FRIEND_OVERLAP) * (bounds[3] - bounds[1])) * scale,
      width: 768 * scale, height: 768 * scale,
    },
    visibleTop: actorPanelTop - (1 - FRIEND_OVERLAP) * visibleHeight,
    visibleBottom: actorPanelTop + FRIEND_OVERLAP * visibleHeight,
  };
}
