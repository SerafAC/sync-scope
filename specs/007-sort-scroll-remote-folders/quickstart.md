# Quickstart: validating feature 007

How to prove the feature works. Setup, services and emulators are described in `DEVELOPMENT.md`. This
page names only what is new.

## 1. Gates

```sh
pnpm lint && pnpm typecheck
pnpm test:ci                 # Jest + script-contract tests (scroll manifest, fixtures, icon script)
pnpm test:android:unit       # JVM: sorts, scroll index, bands, migration 4 → 5, multi-folder walk, browser
pnpm e2e:android             # includes validation/maestro/polish/* on API 31 and API 36
pnpm e2e:android:release-smoke
```

Expected: everything green. The JVM budget tests print the time taken by each sort and by the
scroll-index read on 50 k rows, which must stay under the budget in research R4.

**Validation (2026-10-09, before commit):** lint and typecheck passed; `pnpm test:ci` passed all 56
script-contract tests and 733 Jest tests; `pnpm test:android:unit` passed all 627 JVM tests, with none
skipped. Jest still emits React `act(...)` warnings, and Gradle emits deprecation warnings. Emulator
and release-smoke tests were not rerun for this documentation-only acceptance update; the earlier
T080 results and the successful API 36 rerun in [decisions.md](./decisions.md) remain the evidence.

## 2. The picker spike (do this first)

1. Run `scripts/validation/device-fixtures.sh` against an API 31 emulator, then the same for API 36, so
   that each has `DCIM/Big` (10,000 files).
2. In the debug app, open Settings › Device folders › Add a folder, open `DCIM`, then open `Big`.
3. Record in [research R15](./research.md#r15-the-empty-android-folder-picker):
   - whether the folder shows empty, a loading bar, or its files;
   - whether starting the picker elsewhere (a different `EXTRA_INITIAL_URI`) or using different intent
     flags changes this.
4. Pick the R15 branch: an intent fix, or the hint.

## 3. Icon (when the image arrives)

```sh
scripts/icon/generate-icons.sh assets/icon/source.png --full-bleed --background '#0D47A1'
pnpm assemble:release
```

Install the APK, then check the launcher, the app drawer, recent apps and Settings › Apps. On the
launcher, try the circle, squircle and square shapes, and themed icons on API 33 and later. Expected: the
icon is not cropped, has no white square behind it, and the themed variant is single-colour.

**Result (2026-10-08, owner, T072): passed.** The owner checked the icon by hand and reported it correct.

## 4. Manual walk-through on the owner's phone

This is the human acceptance check, done after `pnpm e2e:android` passes:

1. **Update in place**: install the release APK over the 006 build. Settings › Repository shows the old
   remote folder as the only entry.
2. **Several folders**: add a second backup folder with `Browse`, then Save. Each folder shows its own
   result line.
3. **Scan**: files backed up in either folder show as backed up. Make one folder unreadable on the server
   and scan again: the summary names it, and nothing is "not backed up" that was backed up before.
4. **Sort**: in Files, choose `Size (largest first)`. The biggest photos come first. Close and reopen the
   app: the sort and view are still the same.
5. **Scrollbar**: drag the scrollbar in a library of thousands of photos. The labels change with the
   sort, and size labels fit the library (not one band).
6. **Keeping the place**: scroll deep into the gallery, background the app, and reopen it so the refresh
   runs. "Results updated" shows, and the same photos are still on screen.
7. **Large folder**: add `DCIM/Camera` the way the hint says. The folder is added and then scanned.

**Result (2026-10-09, owner, T081): passed.** The owner confirmed the real-device walk-through passed.
