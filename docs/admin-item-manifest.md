# Admin Item Manifest publishing

The bundled 5,439-item catalog is the offline baseline. Admin can publish a
reviewed R2 overlay containing new icons or replacements without rewriting old
memory IDs.

## Safe workflow

1. Open **Admin → Memory Items → Publish New or Replacement Icons**.
2. Download the JSON template and prepare one row per WebP.
3. Select the JSON and every referenced WebP, then choose **Preview & Validate**.
4. Review every `NEW` / `REPLACE` row. No live data changes during Preview.
5. Choose **Upload Validated Files**. Uploads use immutable versioned keys and
   still do not affect users.
6. Choose **Publish Item Manifest**. The server verifies every uploaded object,
   writes a complete immutable manifest, and moves `itemsVersion` last.

If Preview or Upload fails, fix the reported problem and start Preview again.
Unpublished uploaded objects are harmless and can be lifecycle-cleaned later.
Never manually change `content-version.json` before the immutable manifest and
all referenced images exist.

## Row contract

- `iconName`: required; matching is case/punctuation-normalized for deciding
  NEW versus REPLACE. Existing names keep their stable `item_id`.
- `imageFile`: exact, case-sensitive selected filename; square WebP, 128–1024px,
  non-empty, at most 2MB.
- `category`, `bagsCategory`, `promptCategory`, `rarity`: required catalog
  placement. `promptCategory` is one current `Reflect_Subcategory_Map`
  `Main_Category` key or label.
- `keywordsMapping`: the icon's complete replacement rule vocabulary.
- `keywordSafety`: exactly one row per mapping. Accepted modes are `AUTO`,
  `AUTO_UNLESS_EXCLUDED`, and `NEVER_AUTO`; types are `Word` and `Phrase`.
- `AUTO_UNLESS_EXCLUDED` must contain exclusions. Other modes must not.
- Every mapping and safety phrase is normalized before collision checks.
  Cross-icon enabled keyword conflicts block the entire batch.

## Runtime behavior

- Older app versions omit `itemsVersion` and keep their bundled dictionary.
- Supporting versions cache the exact immutable manifest, merge it with the
  bundle, and then apply reviewed rule overrides.
- A replacement uses the remote image with the bundled image as a loading and
  offline fallback. A new icon uses a neutral empty tile until its R2 image is
  cached.
- Visible assets jump to the front of the queue. Background warm-up order is:
  Announcement; catalogs; Outfit thumbs; Scene thumbs; Outfit previews; Item
  overlays; Scene backgrounds; platform Outfit animations; Focus Voice.
- Clearing app data rebuilds the queue from the manifests on next launch.
