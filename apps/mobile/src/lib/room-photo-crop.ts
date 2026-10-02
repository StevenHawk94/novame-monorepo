export type PhotoCrop = { originX: number; originY: number; width: number; height: number };
export type RoomPhotoKind = 'frame' | 'doll';

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** Frame uploads are exactly 5:7; doll photos retain their square face crop. */
export function centeredRoomPhotoCrop(width: number, height: number, kind: RoomPhotoKind): PhotoCrop {
  const unit = kind === 'frame' ? Math.floor(Math.min(width / 5, height / 7)) : Math.floor(Math.min(width, height));
  if (unit < 1) throw new Error('photo_too_small');
  const cropWidth = kind === 'frame' ? unit * 5 : unit;
  const cropHeight = kind === 'frame' ? unit * 7 : unit;
  return { originX: Math.floor((width - cropWidth) / 2), originY: Math.floor((height - cropHeight) / 2), width: cropWidth, height: cropHeight };
}

/** Offset is measured in preview pixels; return the exact rectangle shown in a 5:7 viewport. */
export function positionedFrameCrop(width: number, height: number, previewWidth: number, zoom: number, offsetX: number, offsetY: number) {
  const base = centeredRoomPhotoCrop(width, height, 'frame');
  const unit = Math.max(1, Math.floor(base.width / (5 * clamp(zoom, 1, 3))));
  const cropWidth = unit * 5;
  const cropHeight = unit * 7;
  const scale = previewWidth / cropWidth;
  const clampedX = clamp(offsetX, -(width * scale - previewWidth) / 2, (width * scale - previewWidth) / 2);
  const previewHeight = previewWidth * 7 / 5;
  const clampedY = clamp(offsetY, -(height * scale - previewHeight) / 2, (height * scale - previewHeight) / 2);
  const crop: PhotoCrop = {
    originX: clamp(Math.round((width - cropWidth) / 2 - clampedX / scale), 0, width - cropWidth),
    originY: clamp(Math.round((height - cropHeight) / 2 - clampedY / scale), 0, height - cropHeight),
    width: cropWidth, height: cropHeight,
  };
  return { crop, scale, offsetX: clampedX, offsetY: clampedY };
}
