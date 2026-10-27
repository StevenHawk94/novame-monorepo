// Use the supplied compressed animation directly, not a JSON object serialized
// over Fabric at the moment the user finishes. Metro bundles this local file.
export const TAME_HEART_SOURCE = require('../../assets/animations/exploding heart (1).lottie');
// The supplied composition is 90 frames at 29.97 fps (3.003 seconds).
// Metadata only: native completion, not a JS elapsed-time gate, owns settlement.
export const TAME_HEART_DURATION_MS = 3003;
export const TAME_HEART_SPEED = 1;
// Identical composition, used only if a device cannot open the dotLottie file.
export const TAME_HEART_FALLBACK_SOURCE = require('../../assets/animations/exploding-heart.json');
export const TAME_HEART_END_FRAME = 90;
