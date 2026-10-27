import type { MajorUpdateBootstrap } from './app-major-update-api';

/** Never borrow another costume's crop, including an unscoped legacy photo. */
export function toyPhotoFor(photos: MajorUpdateBootstrap['roomPhotos'] = [], ownerId: string, toyId?: string) {
  return toyId ? photos.filter(photo => photo.ownerId === ownerId && photo.kind === 'doll' && photo.toyId === toyId)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] : undefined;
}
export const toyPhotoChangedToday = (data: MajorUpdateBootstrap, toyId?: string, ownerId = data.profile.id) =>
  !!toyId && (!!toyPhotoFor(data.roomPhotos,ownerId,toyId)?.id.startsWith('local-plushie-') || (data.photoUsage && data.photoUsage.localDate===data.localDate
    ? (data.photoUsage.doll.targets.find(target=>target.ownerId===ownerId&&target.toyId===toyId)?.used??0)>=data.photoUsage.doll.limit
    : data.dollPhotoChangeTargetsUsed
    ? data.dollPhotoChangeTargetsUsed.some(target => target.ownerId === ownerId && target.toyId === toyId)
    : ownerId === data.profile.id && !!data.dollPhotoChangesUsed?.includes(toyId)));
export const roomPhotoTarget = (kind: 'frame' | 'doll', ownerId: string, toyId?: string) =>
  kind === 'doll' ? `doll:${ownerId}:${toyId ?? ''}` : `frame:${ownerId}`;
