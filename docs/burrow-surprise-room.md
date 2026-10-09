# Surprise Room

## Product flow

- Burrow map replaces Our Room with Surprise Room, keeping the other seven rooms and their positions. Legacy `section=our_room` links redirect to the new room; existing Home/shared-room furniture and inventory are not deleted.
- Six local SVG face frames: Santa, Bunny, Flower, Heart, Birthday, Star. Every face opening uses the same crop geometry. No remote frame downloads and no changes to supplied original artwork.
- Front/back camera and photo library; captured camera image freezes before editing. Drag/zoom the frozen photo, then confirm a 512×512 JPEG. No Toy daily photo quota is consumed.
- Record voice or singing, 1–60 seconds, mono AAC 64 kbps. Actual container duration and audio-only tracks are validated on the server. Preview, retake and re-record cost nothing.
- Send costs exactly **300 carrots**, server-owned pricing. The upload ticket binds sender, recipient, pairing generation, frame, audio duration, photo/audio digest and idempotency UUID. Both immutable private media files must exist before the database transaction charges and publishes the message.
- An uncertain send locks its original media/key for a safe retry. Draft files and metadata survive app restart. Confirmed sent drafts reopen as Sent rather than another paid send. Replaced draft files are removed; account switch clears private draft/cache files.
- Metadata refreshes silently on launch, foreground and every 60 foreground seconds. The Receive prompt waits for tabs, launch cover and other overlays; dismissing leaves the message available in room history. No media download or audio autoplay from the prompt itself.
- Receive prefetches one private photo/audio pair; 28 fixed, native-driver particles reuse the local photo while the recording plays. Pause, close, finish, background and sign-out stop playback. Reduced Motion uses a static portrait. Audio focus suspends Home's ambient soundtrack.
- Replay is free, reauthorizes access and renews signed links. Cache holds at most about 20 media pairs; server messages remain in history (latest 100 displayed). Unpair/re-pair changes relationship generation and revokes access to old messages, even for the same two accounts.
- Hourly authenticated cleanup expires unpaid upload tickets after seven days, keeping tombstones against late retries; removes private orphan files, never paid message media. Account-deleted orphan files also qualify after one day.

## Rollout

1. Apply **only** `20261008000204_burrow_surprise_room.sql` after the existing Burrow migrations, then reload PostgREST schema. Do not blindly reapply older manually-applied migrations.
2. Deploy API including `/api/vnext/surprise` and `/api/cron/surprise-cleanup`; existing `CRON_SECRET` protects the cleanup endpoint. Storage bucket `burrow-surprises` stays private with no client write/read policies; all access is through authenticated API + service-only RPCs.
3. Ship mobile changes. `expo-audio` / `expo-camera` are existing dependencies. Microphone permission copy changed in app.json; native permission copy updates on the next native build.

## Production execution — 2026-10-08

- Applied only `20261008000204` to linked Supabase project `qleeohkhbrdvznbwgqad`, with the migration-history insert in the same explicit transaction, guarded against replay and bounded by lock/statement deadlines. Recent prerequisite migrations through `20261008000203` were already recorded; old historical differences were not replayed.
- Verified the private `burrow-surprises` bucket, its MIME/size limits, enabled table RLS, no anonymous/authenticated table access, and all four service-only RPCs. The message table remained empty; no live carrots were spent or partner messages sent during verification.
- API production deployment `dpl_DLfcVNiZyqSzpRZiRZQNmNx7j2UA` is **READY**, with `api.soulsayit.com` pointing to it. Cloud build includes `/api/vnext/surprise` and `/api/cron/surprise-cleanup`.
- Verified the deployment's hourly Surprise cleanup schedule (`25 * * * *`) and the existing production `CRON_SECRET` configuration. Unauthenticated requests to both new routes and the existing bootstrap route returned 401 on the production domain.
- Re-ran all 13 Surprise API/mobile tests and 10 isolated database tests successfully before deployment. No authenticated two-account send was performed against production.
- No native app package or OTA update was published. Installed release builds still need the updated mobile client; Vercel deployment updates only the backend.

## Verification

- `pnpm test:surprise` — API input/auth/upload order/retry/signing; mobile creation, permission denial, retry identity, receipt playback acknowledgement/background and restart state.
- `PGLITE_MODULE=<installed @electric-sql/pglite path> pnpm test:surprise:db` — actual migration + wallet function: atomic 300 spend, duplicates, missing media, stale pairing, private replay, RLS/RPC privileges and cleanup.
- Mobile TypeScript, API production build, existing reliability regressions and Burrow map tests.
- Real AAC fixture generated with FFmpeg is accepted by the container parser.
- Simulator launches the installed Burrow app, but its session is at unauthenticated onboarding. Authenticated native creation, two-account receive/playback and real-device camera/microphone still need end-to-end testing after migration/API rollout. The iOS simulator does not substitute for real camera testing.
