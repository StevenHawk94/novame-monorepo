# Release Room monster presentation — 2026-10-16

## Artwork and impact

The source WebP files all have 800×800 canvases, but their visible bodies have
different heights/padding. Render the largest connected alpha silhouette at a
common height, preserving the original aspect ratio. Detached shake marks and
stray export pixels do not determine scale. `monster-art-geometry.ts` records
the bounds; a regression test decodes all 16 files and checks the measurements.
No source image was resized/rewritten and there are no per-monster scale knobs.

Grid, preparation and combat use the same normalized renderer. Combat retains
the previous Overthinking reference height (75% of its old square canvas) and
the existing common hit-count shrink thresholds. Idle, hit and tinted-white hit
frames remain mounted/decoded; the white overlay uses the hit pose's bounds,
not the differently shaped idle silhouette. Release-page warmup includes both
poses for all eight monsters.

HP is the compact, centred pixel-edged white/grey bar with yellow-green fill
and no separate red heart, matching the supplied reference. HP remains tied to
the existing 20-hit counter.

## Completion sequence

1. Selected reply starts the same idempotent server settlement and the heart.
2. Heart speed changes from 0.75 to 1.5 (exactly 2×); callback fallback is
   derived from the actual Lottie frame rate and speed plus 500ms grace.
3. Only after both the heart and server receipt complete, mount the victory
   card and small confetti together.
4. Card fades/scales into its final position over 280ms (system reduced motion
   respected). Its completed UI-thread animation callback releases the existing
   deferred coin animation, not `onLayout`. Done is disabled until then.

Background/blur cancels and pauses popup motion. Resume completes the remaining
motion; session/phase/unmount guards reject stale completion callbacks. The
existing one-shot reward guard and server receipt requirements remain intact.
No API, migration, reward amount, daily quota or transaction logic changed.

## Verification

- Full CJS suite: **1,647 passed, 0 failed**, including six new presentation
  tests; `/private/tmp/novame-monster-full-regression.log`.
- Focused presentation/release/API suite: **43 passed**.
- Mobile TypeScript check passed.
- Production JS bundles: Android 4,531 modules / 9,452,406 bytes / 1,306 assets;
  iOS 4,531 modules / 9,395,747 bytes / 1,303 assets. Evidence:
  `/private/tmp/novame-monster-mobile-bundles-final.log`.
- iOS SE simulator, separate `com.novame.localuiqa` app with memory-only mocked
  data/settlement and external application requests blocked: visually inspected
  all eight grid silhouettes, preparation and compact HP; completed a full
  Procrastination attack/reply/heart/popup sequence. Recorded frames show repeated
  white-hit silhouettes, small confetti alongside the popup, and exactly one
  QA reward callback only after popup expansion. No production user or wallet
  was modified. The QA callback counter substitutes for global coin flight;
  actual global coin/reconciliation behavior remains covered by regression tests.
- Native evidence: `/private/tmp/novame-monster-procrastination.mp4`,
  `/private/tmp/novame-monster-attack-contact.png`,
  `/private/tmp/novame-monster-result-contact.png`. Simulator recordings have
  irregular timestamps; sequence is inspected frame-by-frame, while durations
  are verified from animation configuration/tests, not inferred from that video.
- Android simulator skipped. No QA route/config/mock was added to production
  source; the temporary QA bundle/server remains outside the repository.
