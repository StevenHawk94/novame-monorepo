# Coin purchase confirmation

Every paid catalog checkout (Shop/decorator, outfits, Toys, gifts, game unlocks,
and the final Surprise send) uses `useCoinPurchaseConfirmation`. The root
`CoinPurchaseHost` displays the item name, artwork, exact coin total and Purchase
button on a cream card over a translucent black scrim. X, backdrop and Android
Back cancel without submitting a command. No confirmation is required to equip
owned goods or replay an unlocked game. Real-money coin packs retain the store's
own payment authorization.

The confirmation is authorization, not a purchase receipt: callers submit their
existing expected-price/idempotent command only after `confirm()` resolves true,
and show `Purchased [name]!` only on success. The bottom toast is non-blocking and
lasts 2.5 seconds, including when checkout returns to Home. Plus and insufficient
balance gates stay ahead of confirmation; server price/permission/balance checks
remain authoritative. An ambiguous Surprise retry retains its previously
authorized draft and idempotency key, rather than purchasing a second send.

The shared prompt accepts one pending request. Per-screen locks prevent duplicate
commands before React commits. Navigation blur, unmount, account replacement or
pair scope changes revoke unanswered prompts and invalidate stale callbacks.
Immediate overlay reservation prevents automatic banners/paywalls from racing
with a prompt before it mounts.

Run `pnpm test:coin-purchase` for controller, lifecycle, popup, toast and actual
checkout-component regressions. Device visual/payment verification is separate
from these mocked native-component tests.

## Bundle verification

Run `pnpm verify:mobile-bundles` to check every literal mobile asset reference,
then export production Android and iOS JS bundles and their assets sequentially.
It uses the absolute workspace entry and two transformation workers, with no
dependency on a running development server, HTTP proxy, or short HTTP timeout.
Each run retains fresh artifacts in a temporary directory printed by the command;
missing assets, failed child processes or empty output fail validation. This is
Metro JS/resource verification, not an APK/IPA native compile or device payment QA.

The October 14 audit found a stale Tame Enemy background require pointing at
`assets/monsters/monster-bg.webp`; the supplied file is now in `assets/burrow-webp`.
The reference was corrected without replacing its artwork.

Two outdated regression assertions were also corrected, preserving current
product behavior: photo uploads return the authenticated actor's current daily
usage after committing their immutable ticket, and Collection remains wallet-free.
Tests now check completion count/order, usage identity and receipt, safe committed
retry, and the absence of a Collection coin-shop shortcut.

Final October 14 verification: 390 related regression tests passed with no
failures or skips, and mobile TypeScript checking passed. Production Metro
exports passed for Android (26 seconds, 12,018,049 bundle bytes, 1,232 resource
files) and iOS (125 seconds, 11,939,559 bytes, 1,229 files). These timings include
CLI setup and resource copying and reflect the cache state of that audit, not
guaranteed cold-build performance. The iOS run also demonstrates why a 120-second
development-server HTTP deadline is not a reliable build-failure criterion.
