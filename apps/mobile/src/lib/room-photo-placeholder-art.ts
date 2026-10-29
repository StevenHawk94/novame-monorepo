export type RoomPhotoPlaceholderKind = 'frame' | 'doll';

// Shared vector artwork for native views and the Toy's baked Skia texture.
// No text, buttons, downloads or press handlers.
const camera = `<g fill="none" stroke="#A77B59" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
  <path d="M31 41 Q28 42 28 46 L28 62 Q28 66 33 66 L67 66 Q72 66 72 61 L72 46 Q72 41 67 41 L60 41 L56 35 L44 35 L40 41 Z"/>
  <path d="M59 46 L64 46"/><circle cx="50" cy="53" r="8.5"/>
</g>`;
const heart = '<path d="M50 82 C47 79 40 75 40 71 C40 65 47 65 50 70 C53 65 60 65 60 71 C60 75 53 79 50 82 Z" fill="#C9957B" opacity="0.72"/>';

export function roomPhotoPlaceholderSvg(kind: RoomPhotoPlaceholderKind) {
  const frame = kind === 'frame';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="${frame ? 144 : 100}" viewBox="0 0 100 ${frame ? 144 : 100}">
    <rect width="100" height="${frame ? 144 : 100}" fill="#FFF2DC"/>
    ${frame
      ? '<rect x="7" y="8" width="86" height="128" rx="3" fill="none" stroke="#D6BB98" stroke-width="1.2" stroke-dasharray="3 4"/>'
      : '<ellipse cx="50" cy="50" rx="44" ry="43" fill="none" stroke="#D6BB98" stroke-width="1.2" stroke-dasharray="2.5 4"/>'}
    <g fill="#D6BB98" opacity="0.25"><circle cx="17" cy="23" r="0.7"/><circle cx="83" cy="31" r="0.7"/><circle cx="21" cy="79" r="0.7"/><circle cx="78" cy="87" r="0.7"/></g>
    <g transform="${frame ? 'translate(0 22)' : 'translate(9 7) scale(0.82)'}">${camera}${frame ? heart : ''}</g>
  </svg>`;
}
