export type PhotoCrop = { originX: number; originY: number; width: number; height: number };
export type RoomPhotoKind = 'frame' | 'doll';

// Shared by cropper, saved JPEG, artwork inset and all photo previews.
// The 500×500 frame illustrations have the same opening, including its
// antialiased edge; do not resize this area based on a frame's outer ornament.
export const FRAME_PHOTO_ASPECT = 201 / 290;
export const FRAME_PHOTO_BOUNDS = [150, 128, 351, 418] as const;
export const FRAME_PHOTO_OUTPUT_SIZE = { width: 603, height: 870 } as const;
// Use one reference envelope for frame thumbnails, too: decorative outlines
// vary, but must not change the scale of the shared photo opening.
export const FRAME_ART_REFERENCE_BOUNDS = [98, 2, 402, 470] as const;

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** Frames use 201:290; doll photos retain their square face crop. */
export function centeredRoomPhotoCrop(width: number, height: number, kind: RoomPhotoKind): PhotoCrop {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) throw new Error('photo_too_small');
  const cropWidth = kind === 'frame' ? Math.min(width, height * FRAME_PHOTO_ASPECT) : Math.floor(Math.min(width, height));
  const cropHeight = kind === 'frame' ? cropWidth / FRAME_PHOTO_ASPECT : cropWidth;
  const originX = (width - cropWidth) / 2;
  const originY = (height - cropHeight) / 2;
  return { originX: kind === 'frame' ? originX : Math.floor(originX), originY: kind === 'frame' ? originY : Math.floor(originY), width: cropWidth, height: cropHeight };
}

/** Native crop accepts fractional pixels; keep zoom smooth instead of snapping
 * crop sizes to large multiples of 201. The output JPEG has an exact ratio. */
export function positionedFrameCrop(width: number, height: number, previewWidth: number, zoom: number, offsetX: number, offsetY: number) {
  const base = centeredRoomPhotoCrop(width, height, 'frame');
  const cropWidth = base.width / clamp(zoom, 1, 3);
  const cropHeight = cropWidth / FRAME_PHOTO_ASPECT;
  const scale = previewWidth / cropWidth;
  const clampedX = clamp(offsetX, -(width * scale - previewWidth) / 2, (width * scale - previewWidth) / 2);
  const previewHeight = previewWidth / FRAME_PHOTO_ASPECT;
  const clampedY = clamp(offsetY, -(height * scale - previewHeight) / 2, (height * scale - previewHeight) / 2);
  const crop: PhotoCrop = {
    originX: clamp((width - cropWidth) / 2 - clampedX / scale, 0, width - cropWidth),
    originY: clamp((height - cropHeight) / 2 - clampedY / scale, 0, height - cropHeight),
    width: cropWidth, height: cropHeight,
  };
  return { crop, scale, offsetX: clampedX, offsetY: clampedY };
}

/** Square photo plane underneath the costume's actual transparent opening. */
export function positionedDollCrop(width:number,height:number,previewSize:number,zoom:number,offsetX:number,offsetY:number){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1||!Number.isFinite(previewSize)||previewSize<=0)throw Error('photo_too_small');
 const side=Math.min(width,height)/clamp(zoom,1,3),scale=previewSize/side;
 const x=clamp(offsetX,-(width*scale-previewSize)/2,(width*scale-previewSize)/2);
 const y=clamp(offsetY,-(height*scale-previewSize)/2,(height*scale-previewSize)/2);
 return {scale,offsetX:x,offsetY:y,crop:{originX:clamp((width-side)/2-x/scale,0,width-side),originY:clamp((height-side)/2-y/scale,0,height-side),width:side,height:side}};
}
