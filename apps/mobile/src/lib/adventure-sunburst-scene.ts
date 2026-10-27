import { Skia, TileMode, type SkPicture } from '@shopify/react-native-skia';
import { ADVENTURE_REWARD_MOTION as M } from './adventure-reward-motion';

/** Two paint operations, recorded once: one glow and one combined 12-ray path.
 * No React reconciliation, shader construction or image upload during reveal. */
export function adventureSunburstScene(x: number, y: number, radius: number) {
  const recorder = Skia.PictureRecorder();
  const canvas = recorder.beginRecording({ x: x - radius, y: y - radius, width: radius * 2, height: radius * 2 });
  const glow = Skia.Paint(), rays = Skia.Paint(), path = Skia.Path.Make();
  glow.setShader(Skia.Shader.MakeRadialGradient({ x, y }, radius,
    ['#FFE58A99', '#FFB93B40', '#F589270C', '#F5892700'].map(color => Skia.Color(color)), [0, .25, .72, 1], TileMode.Clamp));
  rays.setShader(Skia.Shader.MakeRadialGradient({ x, y }, radius,
    ['#FFF2A9AA', '#FFDA6255', '#FFCF4D10', '#FFCF4D00'].map(color => Skia.Color(color)), [0, .32, .72, 1], TileMode.Clamp));
  for (let i = 0; i < M.rayCount; i++) {
    const a = i * Math.PI * 2 / M.rayCount, b = a + Math.PI / M.rayCount;
    path.moveTo(x, y);
    path.lineTo(x + Math.cos(a) * radius, y + Math.sin(a) * radius);
    path.lineTo(x + Math.cos(b) * radius, y + Math.sin(b) * radius);
    path.close();
  }
  canvas.drawCircle(x, y, radius, glow);
  canvas.drawPath(path, rays);
  return recorder.finishRecordingAsPicture();
}

/** Prime the actual GPU paint pipeline while the unopened box is on screen.
 * The temporary surface is tiny; no viewport-sized bitmap cache is retained. */
export function warmAdventureSunburst(picture: SkPicture, x: number, y: number, radius: number) {
  'worklet';
  try {
    const surface = Skia.Surface.MakeOffscreen(16, 16);
    if (!surface) return;
    try {
      const canvas = surface.getCanvas();
      canvas.scale(8 / radius, 8 / radius);
      canvas.translate(radius - x, radius - y);
      canvas.drawPicture(picture);
      surface.flush();
    } finally { surface.dispose(); }
  } catch { /* Warming is optional; the same vector picture remains drawable. */ }
}
