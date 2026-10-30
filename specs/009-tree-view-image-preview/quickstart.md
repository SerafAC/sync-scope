# Quickstart: validating feature 009

Prerequisites, emulator setup and the validation services are in [DEVELOPMENT.md](../../DEVELOPMENT.md).
The flows are described in [contracts/maestro-tree-preview.md](./contracts/maestro-tree-preview.md).

## 1. Static and unit gates

```sh
pnpm lint && pnpm typecheck
pnpm test:ci                # Jest: tree rows, preview, media helpers, selection carry, toolbar styles
pnpm test:android:unit      # JVM: migration 5→6, MediaKind, video thumbnails, refresh re-check, carrySelection budget
pnpm test:foundation        # script contracts: tree fixtures, assert-equal-halves.sh
```

**Expected**: all of them pass with zero warnings, and the 50 k `carrySelection` budget test reports under
300 ms.

## 2. Fixtures

```sh
scripts/validation/fixture-images.sh --check     # includes the 2 s MP4
scripts/validation/protocol-services.sh up
```

**Expected**: the `tree` set exists on all three servers, and `Album/2025/new.jpg` exists.

## 3. End-to-end

```sh
pnpm e2e:android            # API 31 and API 36, includes tree/* and staged/09, staged/10, staged/11
```

**Expected**: every `tree/*` flow and the staged lines 09, 10 and 11 pass on both API levels, and the
services' before-manifest check passes (the SFTP tree has `Album/2025/new.jpg` again).

## 4. Manual spot check on a real phone (optional, not a gate)

1. Install the debug APK and scan a camera folder.
2. Gallery: videos appear with a play badge and their duration, and their thumbnails appear without a
   visible wait (target: under 300 ms each). Tap a photo: its thumbnail shows at once and the full image
   within about 1 s. Tap a video: it plays muted, and the controller seeks.
3. Switch the view to Tree: expand `DCIM` → `Camera`; its first rows appear as quickly as the same folder
   in list view. Rows show thumbnails, and a filter that hides
   everything dims folders without hiding them.
4. Take a photo, let your sync app upload it, and return to SyncScope. After the automatic refresh the
   photo shows "Backed up", and the summary card says how many files the re-check found.
5. Select a few photos, switch to another app and back: the selection is still there.
6. The sort and view drop-downs each take half of the row.
