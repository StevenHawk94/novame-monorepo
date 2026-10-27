import type { BurrowArtAsset } from './burrow-art-assets';

export const CARROT_VIEWBOX = { top: -24, width: 230, height: 424 };
export type CareCan = { x: number; y: number; scale: number };
export function wateringCanPoint(x: number, y: number, tilt: number, can: CareCan) {
  'worklet';
  const radians = tilt * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians);
  return { x: can.x + (34 + (x - 34) * c - (y - 10) * s) * can.scale,
    y: can.y + (10 + (x - 34) * s + (y - 10) * c) * can.scale };
}

/** All art, touch regions and water landing coordinates share the measured
 * content area. No phone-sized minimum can push an illustration off screen. */
export function careLayout(width: number, height: number, flower?: BurrowArtAsset) {
  const contentHeight = Math.max(1, height);
  const stageWidth = Math.max(1, Math.min(440, width - 32));
  const stageTop = contentHeight * .18, meterBottom = contentHeight * .03;
  // Reserve the text, progress bar and breathing room before sizing the art.
  const stageHeight = Math.max(1, Math.min(contentHeight * .70, contentHeight - stageTop - meterBottom - 86));
  const carrotHeight = Math.min(400, contentHeight * .44, stageWidth * 424 / 230);
  const bounds = flower?.bounds ?? [0, 0, 180, 240];
  const [left, top, right, bottom] = bounds;
  const visibleWidth = Math.max(1, right - left), visibleHeight = Math.max(1, bottom - top);
  const flowerScale = Math.min(stageWidth * .40 / visibleWidth, stageHeight * .29 / visibleHeight);
  const flowerWidth = visibleWidth * flowerScale, flowerHeight = visibleHeight * flowerScale;
  const flowerY = stageHeight - flowerHeight - stageHeight * .025;
  const can: CareCan = { x: stageWidth * .73, y: stageHeight * .17,
    scale: Math.min(.62, stageWidth / 360 * .62, stageHeight / 600 * .72) };
  // Leave a real stream-length gap between the downturned nozzle and flowers.
  const nozzle = wateringCanPoint(-214, -44, -75, can);
  const gap = stageHeight * .12;
  can.y -= Math.max(0, nozzle.y - (flowerY - gap));
  const canPoints = [0, -75].flatMap(tilt => [-234, 151].flatMap(x => [-88, 80].map(y => wateringCanPoint(x, y, tilt, can))));
  const canLeft = Math.max(0, Math.min(...canPoints.map(p => p.x)) - 10);
  const canTop = Math.max(0, Math.min(...canPoints.map(p => p.y)) - 10);
  const canRight = Math.min(stageWidth, Math.max(...canPoints.map(p => p.x)) + 10);
  const canBottom = Math.min(flowerY - gap * .5, Math.max(...canPoints.map(p => p.y)) + 10);
  return {
    hintTop: contentHeight * .095, stageTop, meterBottom,
    carrotHeight, carrotWidth: carrotHeight * 230 / 424, carrotTop: contentHeight * .19,
    stageWidth, stageHeight, can,
    canHit: { left: canLeft, top: canTop, width: canRight - canLeft, height: canBottom - canTop },
    flower: { left: (stageWidth - flowerWidth) / 2, top: flowerY, width: flowerWidth, height: flowerHeight,
      image: { left: -left * flowerScale, top: -top * flowerScale,
        width: (flower?.width ?? 180) * flowerScale, height: (flower?.height ?? 240) * flowerScale } },
    waterEnd: flowerY + flowerHeight * .5,
  };
}
