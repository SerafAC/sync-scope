# Developing SyncScope

This guide is for people working on the SyncScope code. For what the app does and how it is built, see
[docs/](./docs/README.md). What the app does for its users is in [README.md](./README.md).

## Prerequisites

| Tool | Version | Used for |
| --- | --- | --- |
| Node.js | 24.11.1 (pinned in `package.json` `engines`) | JavaScript tooling, Metro, Jest |
| pnpm | 11.3.0 (pinned in `packageManager`) | Dependencies and every script below |
| JDK | 21 or newer | Gradle builds and Robolectric JVM tests (see [MEM015](#android-sdk-location-and-jdk-for-jvm-tests-mem015)) |
| Android SDK | minSdk 31, compileSdk 37, targetSdk 36 (set in `android/build.gradle`) | Building and running the app |
| Docker | 29.x | Protocol validation services |
| Docker Compose | 5.5.1 (checked by `scripts/validation/`) | Protocol validation services |
| Maestro | 2.10.0 | End-to-end emulator flows |
| ImageMagick | 7 (the `magick` command) | Only `scripts/icon/generate-icons.sh`; not needed to build, test or run the app |

The API 31 and API 36 emulators (AVDs `dependency_api31` and `dependency_api36`, each with an SD card)
are needed for the connected tests, the S01 live gate and the end-to-end flows; see
[Validation emulators](#validation-emulators).

First-time setup:

```sh
pnpm install --frozen-lockfile
export ANDROID_HOME=$HOME/Android/Sdk
```

## Scripts

Every script in `package.json`, grouped by purpose. Run them with `pnpm <script>`.

### Build and run

| Script | What it does |
| --- | --- |
| `start` | Starts the Metro development server, which serves the JavaScript bundle to debug builds. |
| `android` | Builds the debug app, installs it on a connected device or emulator and launches it. |
| `build` | Alias for `assemble:debug`. |
| `assemble:debug` | Builds `android/app/build/outputs/apk/debug/app-debug.apk` with Gradle. |
| `assemble:release` | Builds the signed, self-contained `android/app/build/outputs/apk/release/app-release.apk` (needs the [release key](#release-key)). |

### The app icon

The launcher icons are generated from one high-resolution image by `scripts/icon/generate-icons.sh`
(feature 007, research R17). It is not a `package.json` script, because it runs only when the image
changes:

```sh
scripts/icon/generate-icons.sh path/to/source.png --background '#RRGGBB'
```

The committed icons come from an opaque, edge-to-edge artwork, so they were generated with
`--full-bleed`: the image fills the whole 108 dp foreground layer, the monochrome layer is taken from
its bright parts, and the store image is the artwork itself. To regenerate them:

```sh
scripts/icon/generate-icons.sh assets/icon/source.png --full-bleed --background '#0D47A1'
```

It needs ImageMagick 7 (`magick` on `PATH`; for example `pacman -S imagemagick`, `apt install
imagemagick` on a release that ships version 7, or `brew install imagemagick`) and stops with a clear
message when it is missing. It writes into `android/app/src/main/res/`:

- `mipmap-anydpi/ic_launcher.xml` and `ic_launcher_round.xml`, the adaptive icon: a background colour
  (`values/ic_launcher_background.xml`), a foreground layer, and a monochrome layer for Android 13 themed
  icons;
- `mipmap-<density>/ic_launcher_foreground.png` and `ic_launcher_monochrome.png` (108 dp, the image
  scaled into the central 66 dp safe zone, or filling the layer with `--full-bleed`) and the legacy
  `ic_launcher.png` and `ic_launcher_round.png` (48 dp), for every density;

and into `assets/icon/`, `play-store-512.png` and a copy of the source as `source.png`, so the icons can
be regenerated. `assets/icon/concept.jpg` is the owner's concept sheet, kept for reference. `--res` and
`--assets` point it elsewhere, which the tests use. Commit every output: the build never runs the
script. Its contract test in `validation-infrastructure.test.mjs` runs it on a generated image when
`magick` is installed and is skipped with a notice when it is not; the missing-`magick` message is
tested either way.

### Project progress

| Script | What it does |
| --- | --- |
| `speckit:serve` | Serves the [speckit-eye](https://www.npmjs.com/package/speckit-eye) progress dashboard for `specs/` at http://127.0.0.1:4747/, with live updates. |
| `speckit:build` | Builds the same dashboard as a static site in `_site/` (git-ignored). Pass `--base /<path>/` when it is hosted under a sub-path. |

`.github/workflows/speckit-eye.yml` builds the snapshot on every push to `master` and publishes it to
GitHub Pages at https://serafac.github.io/sync-scope/. The site is public: every spec, plan, research note
and the constitution are readable by anyone.

### Quality gates

| Script | What it does |
| --- | --- |
| `lint` | ESLint over the repository, with zero warnings allowed. |
| `typecheck` | TypeScript type check (`tsc --noEmit`). |
| `test` | Jest, for local runs. |
| `test:ci` | `test:foundation`, then Jest in CI mode (`--ci --runInBand`). |
| `test:foundation` | Node tests for the validation scripts (`scripts/validation/*.test.mjs`). |
| `test:android:unit` | Android JVM unit tests (`:app:testDebugUnitTest`, Robolectric). |

The gate every change must pass locally is `pnpm lint && pnpm typecheck && pnpm test:ci`, plus
`pnpm test:android:unit` for changes that touch native code.

#### No inline styles

`.eslintrc.js` makes `react-native/no-inline-styles` an error (feature 005), so `pnpm lint` fails on a
`style={{…}}` literal. Put styles in a `StyleSheet.create` at the bottom of the file and take sizes from
`src/theme/spacing.ts` (`spacing`, `density`, `gridColumns`). When a style needs a theme colour, build the
sheet from the `useTheme()` theme and memoise it, as `src/screens/ListScreen.tsx` does:

```tsx
function themedStyles(theme: MD3Theme) {
  return StyleSheet.create({dimmed: {color: theme.colors.onSurfaceDisabled}});
}

// inside the component
const theme = useTheme();
const themed = useMemo(() => themedStyles(theme), [theme]);
```

Colours always come from the Paper MD3 theme in `src/theme/theme.ts`, never from hex literals, so light
and dark mode stay correct.

### Validation services

| Script | What it does |
| --- | --- |
| `validation:fixtures` | Seeds the fixture files into an empty scratch root (`--root /tmp/cloud-sync-checker-*`). |
| `validation:manifest` | Records a before/after manifest of one protocol's fixtures (`--protocol`, `--phase`, `--state`), used to prove the app changed nothing remotely. |
| `validation:services:start` | Starts the FTP, SFTP and WebDAV test containers. |
| `validation:services:health` | Checks that every test container is healthy. |
| `validation:services:stop` | Stops the FTP, SFTP and WebDAV test containers. |

### Emulator flows

| Script | What it does |
| --- | --- |
| `test:android:connected` | Instrumented tests on an API 31 emulator. |
| `validation:android:api31` | Instrumented tests on an API 31 emulator (the live gate target). |
| `validation:android:api36` | Instrumented tests on an API 36 emulator. |
| `e2e:android` | Maestro end-to-end flows on API 31 and API 36; see [End-to-end flows](#end-to-end-flows-maestro). |

### The S01 live gate

Changes to the native CloudSync layer must also pass the live connect gate against real protocol servers:

```sh
pnpm validation:services:start && pnpm validation:services:health && pnpm validation:android:api31 && pnpm validation:services:stop
```

It needs Docker, Compose and the API 31 emulator image. Expect exit 0, every instrumented test passing and
three clean protocol audits. How the gate works is described in
[docs/architecture.md](./docs/architecture.md).

## Validation emulators

The validation scripts drive two AVDs by fixed name: `dependency_api31` (Android 12) and
`dependency_api36` (Android 16). Both need an SD card, because the end-to-end flows add a folder from
removable storage.

Provision the API 36 AVD once:

```sh
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" "system-images;android-36;google_apis;x86_64"
"$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" create avd -n dependency_api36 \
  -k "system-images;android-36;google_apis;x86_64" -d pixel_5 -c 512M
```

Then check `~/.android/avd/dependency_api36.avd/config.ini` has `hw.sdCard = yes` and
`sdcard.size = 512 MB`, the same as `dependency_api31`. The API 31 AVD is created the same way from
`system-images;android-31;google_apis;x86_64`.

To check that an AVD exposes the SD card, boot it headless and list the public volumes:

```sh
scripts/validation/android-validator.sh start --api 36 --avd dependency_api36 \
  --state /tmp/cloud-sync-checker-api36 --exclusive-lock /tmp/cloud-sync-checker-validator.lock
adb -s "$(cat /tmp/cloud-sync-checker-api36/serial)" shell sm list-volumes public
# expect a line such as: public:253,80 mounted 0000-0000
scripts/validation/android-validator.sh stop --api 36 --avd dependency_api36 \
  --state /tmp/cloud-sync-checker-api36 --exclusive-lock /tmp/cloud-sync-checker-validator.lock
```

If no `mounted` public volume is listed, see
[An AVD with no SD card image](#an-avd-with-no-sd-card-image-feature-003).

## End-to-end flows (Maestro)

`pnpm e2e:android` runs every Maestro flow in `validation/maestro/` on API 31 and then API 36. For each
API level `scripts/validation/android-flow.sh` starts the protocol containers and Metro, boots the AVD,
builds and installs the debug APK, runs `scripts/validation/device-fixtures.sh`, and then runs
`maestro test validation/maestro`, followed by the [staged pairs](#staged-pairs-and-hooks). Metro is started once and serves both API levels, under a 2-hour cap
(`scripts/validation/metro-service.sh`). A full two-API run takes about 55 minutes, so a 1-hour cap would
end Metro during the API 36 pass. The flows are the proof that a user-visible capability works
([D012](./docs/decisions/0012-maestro-e2e-proof-bar.md)). The rules below apply to every flow; feature
003 set them up (its design record is
`specs/003-local-source-selection/contracts/maestro-conventions.md`).

On API 36, opening the system folder picker can close the debug app's Metro connection. `index.js`
suppresses only the disconnected Fast Refresh banner and its related LogBox warnings in debug builds:
the native banner otherwise covers the selection controls and consumes their first tap while Maestro
cannot see it. Reload the app after the picker to reconnect Fast Refresh when developing. Release
builds have no Metro or banner. The cause and passing rerun are recorded in
[007 decisions](./specs/007-sort-scroll-remote-folders/decisions.md#2026-10-08--known-issue-api-36-header-first-tap-from-006).

### Layout

```text
validation/maestro/
├── config.yaml      # executionOrder.flowsOrder + continueOnFailure: false
├── subflows/        # reusable steps, never run on their own
│   ├── pick-folder.yaml            # drives the system folder picker; env VOLUME, PATH
│   ├── open-sources.yaml           # launches the app, opens Settings and scrolls to Add folder (below Repository)
│   ├── configure-repository.yaml   # the configure-repository seam; env PROTOCOL, PORT, USER, PASSWORD, ROOT, ROOT_2
│   ├── add-scan-source.yaml        # adds SyncScopeE2E/Scan (and Bulk with BULK=true), or the SOURCES list
│   ├── open-scan.yaml              # opens the Scan tab
│   ├── setup-repository.yaml       # the Repository form, as a user fills it; env PROTOCOL, PORT, USER, PASSWORD, ROOT, HTTPS, START, EXPECT
│   ├── start-scan.yaml             # taps Scan (or BUTTON) and waits for the run to end
│   └── open-files.yaml             # opens the Files tab and waits for its first page
├── sources/         # one directory per feature area (feature 003)
│   ├── 01-add-internal.yaml
│   └── …
├── scan/            # feature 004
│   ├── 01-clean-scan-{ftp,sftp,webdav}.yaml
│   └── …
├── browse/          # feature 005
│   ├── 01-gallery-thousands.yaml
│   ├── 02-gallery-filters.yaml
│   ├── 03-gallery-issues-unknown.yaml
│   └── 04-list-browse.yaml
├── mvp/             # feature 006
│   ├── 01-setup-{ftp,sftp,webdav}.yaml
│   ├── 02-setup-errors.yaml
│   ├── 03-first-run.yaml
│   ├── 04-select-size.yaml
│   ├── 05-delete-synced.yaml
│   ├── 90-release-smoke.yaml       # also the release-smoke mode's flow
│   └── 91-release-update.yaml      # release-smoke only: after an in-place update
├── polish/          # feature 007
│   ├── 01-sort.yaml
│   ├── 02-sort-persists.yaml
│   ├── 03-fast-scroll.yaml
│   ├── 04-remote-folders-webdav.yaml
│   ├── 05-remote-folder-unread-ftp.yaml
│   ├── 06-remote-browse-sftp.yaml
│   ├── 07-results-updated-keeps-place.yaml
│   └── 08-add-large-folder.yaml
└── staged/          # feature 006: a/b(/c) parts with a hook between them; not in config.yaml
    ├── pairs.txt
    ├── 06-recheck-removed-{a,b}.yaml
    ├── 07-delete-offline-{a,b,c}.yaml
    └── 08-changed-{a,b}.yaml
```

- Flow files are named `NN-<verb>-<object>.yaml`, where `NN` is the order within the directory.
- Each flow declares `name: <dir>/<file>` (for example `name: sources/01-add-internal`), and
  `config.yaml` lists the full order in `executionOrder.flowsOrder`. Add a new flow there too.
- Later flows build on the state earlier ones leave, so `continueOnFailure` is `false` and the run stops at
  the first failure.
- A new feature area gets its own directory and an entry in the `flows:` list of `config.yaml`.

### Selectors

- **App UI**: select by `id:`, using the React Native `testID`, named `<screen>.<element>[.<qualifier>]`
  in lower camel case, for example `sources.add`, `sources.row`, `sources.row.status`,
  `sources.dialog.confirm`. Rows that repeat share an ID and are told apart with `childOf` or `index`.
- **Files tab** (feature 005): select by accessibility label. Every interactive element there has one,
  built in `src/files/a11y.ts`, and the label is the selector, so a missing label fails a flow (spec
  FR-004, SC-003). Examples: `View: Gallery`, `Sort: Size, largest first`, `Filter Synced, 3`,
  `sunset.png, Unsynced, from GalleryTwin`, `Folder drafts, 0 matching, no matches`, `Breadcrumb All folders`. The full list is in
  `specs/005-gallery-list-filtering/contracts/maestro-browse.md` (Selectors). A new label goes in `a11y.ts`
  and its unit test, not inline in a component.
- **Repository form** (feature 006): its buttons and status are selected by accessibility label, as in the
  Files tab (`specs/006-mvp/contracts/maestro-mvp.md`, Selectors). Its text fields are tapped by `testID`
  (`repository.host`, `repository.port`, `repository.username`, `repository.password`,
  `repository.remoteRoots.<n>`, one per remote folder from `0`, feature 007): a prefilled field's floating
  label also matches its name, and a tap on that label does not focus the input. A passed test shows
  `Connected` and one `<folder>: <n> entries` line per folder. Hide the keyboard and scroll to each field before tapping it, as
  `subflows/setup-repository.yaml` does; the keyboard covers the lower fields.
- **System UI** (the folder picker, permission dialogs): select by visible text, and only inside
  `subflows/`. Differences between Android versions are handled there with `runFlow: when:` branches,
  never in feature flows. For example, `pick-folder.yaml` matches the picker's confirm buttons
  case-insensitively, because they are all caps on API 31.

### Assertions

- Assert what the user sees: aliases, status text ("Available", "Access lost", "Storage missing") and
  error messages. Never assert internal IDs.
- A flow that depends on an earlier flow says so in a leading comment, for example
  `# requires: 01-add-internal`.
- In `sources/`, only the first flow uses `launchApp: clearState: true`, and later flows build on its
  state. Every `scan/`, `browse/` and `mvp/` flow is self-contained instead: it starts from `clearState`,
  configures the repository (through the seam, or through the form with `subflows/setup-repository.yaml`)
  and adds only the sources it needs. A restart is `stopApp` then
  `launchApp` without `clearState`.

### Test-only seams

A seam lives only in `android/app/src/debug/`, so the release build never contains it. It is reached
through a `syncscope-debug://` deep link (Maestro `openLink`), is recorded in `docs/decisions/`, and must
reproduce a real OS or app state through production code, never fake app state. The existing seams are:

- `syncscope-debug://release-grants` releases every persisted folder grant
  ([D017](./docs/decisions/0017-debug-grant-release-seam.md)).
- `syncscope-debug://configure-repository?protocol=…&host=…&port=…&username=…&password=…&root=…`
  saves and tests a repository with the production `RepositoryOperations`, approving an SFTP host-key
  challenge on the way, and shows `Repository configured` or `Repository error: <CODE>`
  ([D018](./docs/decisions/0018-debug-repository-seam.md)). Since feature 007 `root` may repeat
  (`&root=/a&root=/b`) to give several remote folders, in order; a single `root` is a one-folder
  repository, as before. `polish/05` uses it to set one readable and one unreadable folder, then two
  unreadable ones; `subflows/configure-repository.yaml` takes a second folder in `ROOT_2`. Feature 006
  added the Repository screen, and the `mvp/` flows set up each protocol through it
  (`subflows/setup-repository.yaml`); the seam stays for flows whose subject is not setup. An optional `scanDelayMs=<ms>` sets a debug-only pause before each local file is matched
  (`ScanPacing`, a no-op in release builds), which the `01-clean-scan-*` flows use so the progress card
  stays visible; a link without it resets the pause to 0. Flows call it through
  `subflows/configure-repository.yaml`. The password travels in the link, which Android and Maestro may
  log, so only ever pass the throwaway container credentials, never a real password.

### Device fixtures

Flows never create their own files. `scripts/validation/device-fixtures.sh` seeds them before
`maestro test`, on the device named by `ANDROID_SERIAL`:

- `SyncScopeE2E/Camera` and `SyncScopeE2E/Camera/Nested` on internal storage;
- `SyncScopeE2E/Camera` on the SD card, found with `sm list-volumes public`.

Each folder gets one small file. For the scan flows (feature 004) it also seeds, on internal storage:

- `SyncScopeE2E/Scan`: the device side of the remote `scan/clean` tree, with the same names, contents and
  mtimes (`touch -d @1704067200`). `é-decomposed.txt` uses the NFC name, while the server stores it in
  NFD, which proves NFC matching. `size-mismatch.txt` differs in size, `local-only.txt` has no remote
  copy, and `only-here.txt` matches only the file in the unreadable `scan/partial/restricted` folder.
- `SyncScopeE2E/Bulk`: `BULK_FILES` small generated files (default 20 000, whole numbers 1 to 99 999) in
  200 folders, regenerated on every run. Only the progress and backgrounding flow
  (`scan/05-background-discards`) adds it.

For the browse flows (feature 005) it seeds three more sources on internal storage, made of real,
decodable PNGs so the gallery can draw thumbnails:

- `SyncScopeE2E/Gallery`: `sunset.png`, `beach.png` and `album/forest.png`, byte-identical to the remote
  `gallery/` root (SYNCED), plus the local-only `harbor.png`, `drafts/draft.png` and `album/notes.txt`
  (UNSYNCED; the text file counts in list view only).
- `SyncScopeE2E/GalleryTwin`: a `sunset.png` of a different size, so it is UNSYNCED and shares its name
  with the Gallery copy, which gives both tiles an origin badge.
- `SyncScopeE2E/GalleryBulk`: `g0000.png` and on, `GALLERY_BULK_FILES` copies of one PNG (default 2 000,
  whole numbers 1 to 9 999), regenerated on every run. Only `browse/01-gallery-thousands` adds it, and it
  asserts `Filter All, 2000`, so keep the default when running that flow; spec scenario 1 needs at least
  2 000.

For the selection and deletion flows (feature 006) it seeds five more sources on internal storage, each
the same tree as `Gallery` (`sunset.png`, `beach.png`, `album/forest.png`, `harbor.png`,
`drafts/draft.png`, `album/notes.txt`), so every flow that deletes or changes files has its own copy:

| Source | Used by |
| --- | --- |
| `SyncScopeE2E/Select` | `mvp/04-select-size` |
| `SyncScopeE2E/Delete` | `mvp/05-delete-synced` |
| `SyncScopeE2E/Recheck` | `staged/06-recheck-removed-*` |
| `SyncScopeE2E/Offline` | `staged/07-delete-offline-*` |
| `SyncScopeE2E/Changed` | `staged/08-changed-*` |

These flows delete real files, so every gallery tree is removed and re-created on each run.

The images are embedded as base64 in `scripts/validation/fixture-images.sh`, which `device-fixtures.sh`
and `fixture-seed.sh` both source, so no image tool is needed. The twin image must keep a different byte
length from `sunset.png`, or the GalleryTwin copy would match and become SYNCED.

The script is idempotent, and it fails with a clear message when no SD card is mounted, so
removable-storage coverage is never skipped silently. New fixtures go in this script, under
`SyncScopeE2E/`.

For sorting, the scrollbar, several server folders and the picker (feature 007,
`specs/007-sort-scroll-remote-folders/contracts/maestro-polish.md`, Fixtures) it seeds four more:

| Source | Contents | Used by |
| --- | --- | --- |
| `SyncScopeE2E/TwoFolders` | the same names, bytes and mtimes as the remote `scan/clean/a` and `scan/clean/b` (copied by the existing logic), plus `b/b-only-deleted.jpg` and `b/b-only-kept.jpg`, which only `scan/clean/b` holds | `polish/04`, `polish/05` |
| `SyncScopeE2E/Scroll` | 5 000 padded PNGs from 2 KB to 4 MB, over 30 months, with names covering `#` and every letter `a`–`z` (accented and mixed-case initials included) | `polish/01`–`03`, `polish/07` |
| `SyncScopeE2E/Narrow` | 200 padded PNGs, all 3–5 MB with at least 8 distinct sizes, within 21 days, so the size bands must be narrow | `polish/03` |
| `DCIM/Big` | 10 000 empty `.jpg` files, made with one `adb shell` loop | `polish/08` and the picker spike |

`Scroll` and `Big` take a while to create, so they are kept when their file count is already complete (in
practice once per emulator boot); the others are re-created on each run.

**The scroll manifest.** `scripts/validation/scroll-manifest.sh` is the one definition of the `Scroll` and
`Narrow` files (Principle III). Sourced, it defines `scroll_name`, `scroll_size` and `scroll_mtime <i>`
(`i` from 0 to 4 999) and `narrow_name`, `narrow_size` and `narrow_mtime <i>` (0 to 199), pure functions
of the index that `device-fixtures.sh` uses to write the files. Run as `scroll-manifest.sh print`, it
prints `KEY=value` lines computed from the same functions: the first file under each sort
(`FIRST_NAME_ASC`, `FIRST_NAME_DESC`, `FIRST_TIME_DESC`, `FIRST_TIME_ASC`, `FIRST_SIZE_DESC`,
`FIRST_SIZE_ASC`), `LARGEST_NAME`, a month band about three quarters down the date track
(`BAND_MONTH_LABEL`, `BAND_MONTH_FIRST`) and `BAND_LETTER_M_FIRST`. `android-flow.sh` evaluates it once and
passes every line to Maestro as `-e` variables, so the `polish/` flows never hold a literal file name or
size. The name order follows `SortName` (research R2); `validation-infrastructure.test.mjs` recomputes one
value independently. To run a `polish/` flow by hand, pass the same variables:
`$(scripts/validation/scroll-manifest.sh print | sed 's/^/-e /')`.

**Calibrating `BULK_FILES`.** The Bulk source must keep a full scan running for at least 15 s on the API 31
emulator, so a flow can cancel it or leave the app mid-run. With 20 000 files a FULL scan over SFTP of
`Scan` and `Bulk` took about 22 s on the reference host (`specs/004-scan-engine-matching/research.md`,
R11), and seeding takes about 70 s. On a much faster or slower machine, time a scan of both sources from
the first progress frame to the summary and set `BULK_FILES` (an environment variable read by
`device-fixtures.sh`) so the run lasts at least 15 s.

### Remote fixtures

`scripts/validation/fixture-seed.sh` seeds the read-only tree the containers serve. The scan flows use its
`scan/` subtree:

- `scan/clean/`: `exact.txt`, `a/reusable.jpg` and `b/reusable.jpg` (a duplicate pair), the NFD-named
  `é-decomposed.txt` and `size-mismatch.txt`, all with the mtime `1704067200`. The `01-clean-scan-*`
  flows and flows `03` to `07` use it as their remote root.
- `scan/partial/`: `readable/exact.txt`, and `restricted/only-here.txt` inside `restricted/`, which is
  `0700` and owned by the host user, so each server answers with a real permission error. The
  `02-partial-listing-*` flows use it.

The browse flows (feature 005) use two more roots, built from the same embedded PNGs:

- `gallery/`: `sunset.png`, `beach.png` and `album/forest.png`. Flows `01`, `02` and `04` use it
  (`browse/05-results-updated` was replaced by `polish/07` in feature 007).
- `gallery-partial/`: the same files plus `restricted/hidden.png` inside `restricted/`, which is `0700`
  and host-owned like `scan/partial/restricted`, so the listing is incomplete and every unmatched file is
  UNKNOWN. Flow `03-gallery-issues-unknown` uses it.

The expected chip counts per root and view are in
`specs/005-gallery-list-filtering/contracts/maestro-browse.md` (Fixtures).

Feature 006 adds `recheck/`, a copy of `gallery/` that `fixture-seed.sh` re-creates on every seed run,
because `staged/06-recheck-removed` removes `recheck/beach.png` mid-scenario. The `mvp/` and `staged/`
flows otherwise use `gallery/` and `gallery-partial/`.

Feature 007 adds `scan/clean/b/b-only-deleted.jpg` and `b-only-kept.jpg`, two files only the second of two
remote folders holds, so `polish/04` can prove that a file backed up in the second folder is SYNCED and
passes the server re-check. The `polish/` flows use `scan/clean/a`, `scan/clean/b`,
`scan/partial/restricted`, `gallery-partial/restricted` (two unreadable folders) and `gallery/` as remote
folders; the `Scroll` and `Narrow` files are local only.

When the tree changes, update the exact-tree expectations in `ProtocolConnectInstrumentedTest` and
`scripts/validation/validation-infrastructure.test.mjs` in the same change.

### Credentials for the flows

The containers get a new random username and password on every `pnpm validation:services:start`, written
to `/tmp/cloud-sync-checker-syncscope-<protocol>/credentials` as `username=…` and `password=…` lines
([D014](./docs/decisions/0014-container-credentials-via-runner-args.md)). Before `maestro test`,
`android-flow.sh` reads them and passes them as Maestro `-e` variables, never printing them:

| Variables | Value |
| --- | --- |
| `FTP_HOST`, `SFTP_HOST`, `WEBDAV_HOST` | `10.0.2.2`, the emulator's alias for the host loopback |
| `FTP_PORT`, `SFTP_PORT`, `WEBDAV_PORT` | `32120`, `32122`, `32180` |
| `FTP_USER`, `FTP_PASSWORD` (and the `SFTP_` and `WEBDAV_` pairs) | the per-run credentials |
| `FTP_ROOT`, `SFTP_ROOT`, `WEBDAV_ROOT` | `/`, `/srv/fixtures`, `/webdav`; each flow appends its remote root, such as `/scan/clean`, `/scan/partial`, `/gallery` or `/gallery-partial` |

Each scan flow passes the set it needs to `subflows/configure-repository.yaml`, and each `mvp/` setup
flow to `subflows/setup-repository.yaml`.

The selection and deletion flows assert byte totals, which `android-flow.sh` measures from the seeded
remote fixtures with `size_of` (the flows never hard-code a byte count). The values are raw byte sums;
the flows assert them with a ` B` suffix, the way the app shows a total below 1 kB:

| Variable | Files |
| --- | --- |
| `SIZE_BEACH` | `beach.png` |
| `SIZE_SYNC_2` | `sunset.png`, `beach.png` |
| `SIZE_IMAGES_5` | the five device images: `sunset.png`, `beach.png`, `album/forest.png`, `harbor.png`, `drafts/draft.png` (the last two measured from `gallery-partial/restricted/hidden.png`, which is the same PNG) |
| `SIZE_SYNCED_3` | `sunset.png`, `beach.png`, `album/forest.png` | The browse flows read only
the local snapshot, so they are protocol-agnostic and all use SFTP; the three protocols are covered by the
scan flows.

### Browse flow order

The `browse/` flows run after `scan/`, in the order pinned in `config.yaml`:

| Flow | Remote root, sources | Proves |
| --- | --- | --- |
| `01-gallery-thousands` | `gallery`; GalleryBulk | 2 000 tiles render through paged reads and keep loading while scrolling |
| `02-gallery-filters` | `gallery`; Gallery, GalleryTwin | chip counts 6 / 3 / 3 / 0, what each filter shows, and the origin badges |
| `03-gallery-issues-unknown` | `gallery-partial`; Gallery, GalleryTwin | the Issues or unknown filter shows the UNKNOWN set |
| `04-list-browse` | `gallery`; Gallery, GalleryTwin | descend and breadcrumb back up, a dimmed `0 matching` folder, and the filter shared with the gallery |

Each flow is self-contained, so any one can be run alone as described below.

### MVP flow order

The `mvp/` flows (feature 006) run after `browse/`. The full scenario mapping is in
`specs/006-mvp/contracts/maestro-mvp.md`.

| Flow | Setup | Proves |
| --- | --- | --- |
| `01-setup-{ftp,sftp,webdav}` | the form, root `gallery` | each protocol set up through the UI, the unencrypted warning, SFTP key approval, and the prefilled edit form |
| `02-setup-errors` | the form | a wrong password shows the error and keeps the fields; the discard prompt |
| `03-first-run` | clearState | the Scan checklist, the Files empty state, the folder picker hint and DCIM start folder, then a first scan |
| `04-select-size` | SFTP, `gallery`; Select | long-press, tap, Select all, the count and size, hidden by filter, back clears |
| `05-delete-synced` | SFTP, `gallery-partial`, then `gallery`; Delete | real deletion of the SYNCED files, UNKNOWN files survive, folders stay; then the not-backed-up opt-in |
| `90-release-smoke` | clearState, no seam | setup, folder, scan and results; valid on debug and release |
| `91-release-update` | after `adb install -r` | the server, folders and results survive an update (release-smoke only) |

### Polish flow order

The `polish/` flows (feature 007) run after `mvp/`. The full scenario mapping, with the recorded
deviations, is in `specs/007-sort-scroll-remote-folders/contracts/maestro-polish.md`. Expected names,
sizes and band labels come from the [scroll manifest](#device-fixtures), never from literals.

| Flow | Setup | Proves |
| --- | --- | --- |
| `01-sort` | WebDAV, `gallery`; Scroll, Gallery | the sort and view drop-downs, each of the six sorts in both views, sort and filter independent, each view keeping its own sort |
| `02-sort-persists` | after `01`, a restart | the view and each view's sort survive a restart; the filter does not |
| `03-fast-scroll` | Scroll, Narrow | the scrollbar: month and letter jumps within 1 s (SC-003), narrow size bands (SC-008), no thumb on a short result; drag points per `API_LEVEL` |
| `04-remote-folders-webdav` | the form, two folders; TwoFolders | several folders, per-folder test lines, the URL path fills folder 1, a file only the second folder holds is SYNCED and passes the re-check, the overlap refusal |
| `05-remote-folder-unread-ftp` | the seam, `root` twice; TwoFolders | one unread folder: the scan completes, names it, and unmatched files are UNKNOWN; all folders unread: the scan fails and the result stays |
| `06-remote-browse-sftp` | the form, never saved | the server folder browser: key approval first, descend, Up, Use this folder, the login error |
| `07-results-updated-keeps-place` | WebDAV; Scroll | a rescan keeps the first visible file on top in the list and in the hidden gallery, with "Results updated" |
| `08-add-large-folder` | clearState | the large-folder hint, then `DCIM/Big` (10 000 files) added by opening it and tapping Use this folder at once |

### Staged pairs and hooks

A scenario that needs server or device state to change between two steps is split into parts in
`validation/maestro/staged/`. `config.yaml` never lists them, so the workspace run skips them. After the
workspace, `android-flow.sh` reads `staged/pairs.txt`: each line alternates flows and hooks,
`<flow>|<hook and args>|<flow>[|<hook and args>|<flow>…]`. Only the first flow of a line starts from
`clearState`. Hooks are in `scripts/validation/hooks/` and run on the host:

| Hook | Does | Line |
| --- | --- | --- |
| `remove-recheck-file.sh` | deletes `recheck/beach.png` from the fixture tree the containers serve | `06-recheck-removed`: the server re-check moves the file, and it is not deleted |
| `pause-service.sh <protocol>` / `resume-service.sh <protocol>` | `docker compose pause` / `unpause` of one container | `07-delete-offline`: with the server unreachable, nothing is deleted |
| `change-device-files.sh` | through `adb`, removes `Changed/beach.png` and sets a new mtime on `Changed/sunset.png` while the confirmation is open | `08-changed`: per-file `Already gone` and `Changed since the scan` |
| `restore-recheck-file.sh` | puts `recheck/beach.png` back after the staged lines | run by the runner, so the protocol audit and the next API level see the seeded tree |

A pause registers its resume in the runner's `trap` before it runs, so a failed flow never leaves a
container paused. The staged flows all use the SFTP container. The hooks are covered by
`validation-infrastructure.test.mjs`.

### Release smoke

`pnpm e2e:android:release-smoke` (`android-flow.sh release-smoke --api 31`) proves the installable APK:

1. `pnpm assemble:release` with no `SYNCSCOPE_RELEASE_*` properties must fail with "Release signing is
   not configured". The run refuses to start if `~/.gradle/gradle.properties` sets them.
2. It generates a throwaway keystore in a temp directory and builds with `pnpm assemble:release` through
   `ORG_GRADLE_PROJECT_SYNCSCOPE_RELEASE_*`.
3. `aapt2 dump badging` must report the `versionName` and `versionCode` derived from `package.json`.
4. It installs the release APK with Metro stopped, and asserts that `syncscope-debug://configure-repository`
   resolves to no activity.
5. It runs `mvp/90-release-smoke`, re-installs the same APK with `adb install -r`, and runs
   `mvp/91-release-update`.
6. It deletes the keystore.

It needs the protocol containers like `pnpm e2e:android`, and runs on API 31 only.

### Running one flow

`pnpm e2e:android` always runs the whole directory on both API levels. To iterate on one flow, drive the
steps yourself:

```sh
pnpm start                                  # Metro, in its own terminal
scripts/validation/android-validator.sh start --api 36 --avd dependency_api36 \
  --state /tmp/cloud-sync-checker-api36 --exclusive-lock /tmp/cloud-sync-checker-validator.lock
export ANDROID_SERIAL=$(cat /tmp/cloud-sync-checker-api36/serial)
pnpm assemble:debug
adb -s "$ANDROID_SERIAL" install -r android/app/build/outputs/apk/debug/app-debug.apk
scripts/validation/device-fixtures.sh
maestro test validation/maestro/sources/01-add-internal.yaml
```

A flow with a `# requires:` comment needs the state the earlier flows leave, so run those first, in order,
starting from `01-…` (the only flow that clears app state).

A scan flow is self-contained, but needs the containers and their credentials. Start the services first
(`pnpm validation:services:start && pnpm validation:services:health`), do the steps above, then pass the
variables of the protocol the flow uses:

```sh
creds=/tmp/cloud-sync-checker-syncscope-sftp/credentials
maestro test -e SFTP_PORT=32122 -e SFTP_ROOT=/srv/fixtures \
  -e SFTP_USER="$(sed -n 's/^username=//p' "$creds")" \
  -e SFTP_PASSWORD="$(sed -n 's/^password=//p' "$creds")" \
  validation/maestro/scan/01-clean-scan-sftp.yaml
pnpm validation:services:stop               # also runs the read-only protocol audit
```

For FTP use port `32120` and root `/`; for WebDAV, port `32180` and root `/webdav`. The `mvp/04` and
`mvp/05` flows also need the `SIZE_*` variables above; compute them from
`/tmp/cloud-sync-checker-syncscope-sftp/fixtures` as `android-flow.sh` does. A staged line must be run as
a whole, with its hook between the parts. Stop the emulator afterwards with
`android-validator.sh stop` and the same arguments. The Maestro binary used by the scripts is
`~/.cache/cloud-sync-checker-toolchain/maestro-2.10.0/maestro/bin/maestro`.

## Branches and workflow

- The mainline branch is `master`. Feature work happens on a branch and merges into `master` only after
  every quality gate passes.
- Work is planned with [GitHub Spec Kit](https://github.com/github/spec-kit). Each feature lives in
  `specs/<NNN-feature-name>/` and moves through **specify → clarify → plan → tasks → implement**
  (the `/speckit-*` commands), with `spec.md`, `plan.md` and `tasks.md` as its artifacts.
- `.specify/feature.json` points at the active feature. Update it when you start the next feature.
- The project's rules are in the constitution, `.specify/memory/constitution.md`. Changes that alter
  behaviour, tooling or release steps update `docs/`, `README.md`, `DEVELOPMENT.md` and `CHANGELOG.md` in
  the same change, as the constitution requires.

## Versioning and releases

- The project uses [Semantic Versioning](https://semver.org/). The `version` field in `package.json` is the
  single source of truth for the version.
- `android/app/build.gradle` derives the Android version from it: `versionName` is the version and
  `versionCode` is `major * 10000 + minor * 100 + patch`. The build fails on a version that is not plain
  `MAJOR.MINOR.PATCH`, or on a minor or patch of 100 or more. `android/gradlew -p android -q
  :app:printVersion` prints both values.

### Changelog

`CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Every user-visible or
behaviour-changing change adds an entry under `## [Unreleased]`, in the same change, under `Added`,
`Changed`, `Deprecated`, `Removed`, `Fixed` or `Security`.

### Release procedure

1. Make sure `master` passes every quality gate, including the S01 live gate.
2. Choose the new version by Semantic Versioning and set it as `version` in `package.json`.
3. In `CHANGELOG.md`, move the `Unreleased` entries under a new `## [X.Y.Z] - YYYY-MM-DD` heading, using the
   ISO date, and leave an empty `## [Unreleased]` section above it.
4. Build the release APK with `pnpm assemble:release`.
5. Commit the version bump and changelog together, and tag the commit `vX.Y.Z`.

### Release key

The release APK is signed with your personal key, so a later build installs over an earlier one and the
app keeps its data. There is no fallback to the debug key. The key and its passwords never go into the
repository.

1. Create the key once. Keep the keystore outside the repository:

   ```sh
   mkdir -p ~/keys
   keytool -genkeypair -v -storetype PKCS12 -keystore ~/keys/syncscope-release.p12 -alias syncscope -keyalg RSA -keysize 4096 -validity 10000
   ```

2. Add four properties to `~/.gradle/gradle.properties`. Gradle does not expand `~`, so give the keystore
   as an absolute path:

   ```properties
   SYNCSCOPE_RELEASE_STORE_FILE=/home/<you>/keys/syncscope-release.p12
   SYNCSCOPE_RELEASE_STORE_PASSWORD=<store password>
   SYNCSCOPE_RELEASE_KEY_ALIAS=syncscope
   SYNCSCOPE_RELEASE_KEY_PASSWORD=<key password>
   ```

   Instead of the file, you can export them as environment variables named
   `ORG_GRADLE_PROJECT_SYNCSCOPE_RELEASE_STORE_FILE`, `ORG_GRADLE_PROJECT_SYNCSCOPE_RELEASE_STORE_PASSWORD`,
   `ORG_GRADLE_PROJECT_SYNCSCOPE_RELEASE_KEY_ALIAS` and `ORG_GRADLE_PROJECT_SYNCSCOPE_RELEASE_KEY_PASSWORD`.
   `pnpm e2e:android:release-smoke` does this with a throwaway key.

3. Build with `pnpm assemble:release`. The APK is
   `android/app/build/outputs/apk/release/app-release.apk`. It bundles the JavaScript, so it runs without
   Metro. Install it with `adb install -r android/app/build/outputs/apk/release/app-release.apk`, or copy it
   to the phone and open it.

If any of the four properties is missing, every task whose name contains `Release` fails at once with
"Release signing is not configured. Set SYNCSCOPE_RELEASE_STORE_FILE, …". Debug builds and JVM tests never
need the key.

**Back up the keystore and its passwords.** Android installs an update only when it is signed with the
same key. If the key is lost, the next build can only be installed after uninstalling the app, and
uninstalling deletes the app's data: the server settings, the folder list and the scan results.

**Why `hermes-compiler` is hoisted.** A release build compiles the JavaScript bundle to Hermes bytecode.
React Native's Gradle plugin looks for the `hermesc` binary at `node_modules/hermes-compiler`, but
`hermes-compiler` is only a dependency of `react-native`, and pnpm keeps it out of the top-level
`node_modules`. The `publicHoistPattern: [hermes-compiler]` entry in `pnpm-workspace.yaml` puts it there.
Without it, `pnpm assemble:release` fails while bundling. Debug builds load the bundle from Metro, so they
do not notice. After changing that entry, run `pnpm install` again.

## Technical documentation

Deeper technical detail is in [docs/](./docs/README.md):

- [Architecture](./docs/architecture.md): the native CloudSync layer and the validation harness.
- [Sync and deletion safety](./docs/sync-and-deletion-safety.md): matching rules and deletion guarantees.
- [Protocols](./docs/protocols.md): FTP, SFTP and WebDAV behaviour and the read-only guarantee.
- [Scope](./docs/scope.md): v1 scope and non-goals.
- [Decision records](./docs/decisions/README.md).

## Environment gotchas

Known environment and tooling pitfalls, each traced to the project memory it came from (MEM-IDs) or to the
task that found it.

### Android SDK location and JDK for JVM tests (MEM015)

Android JVM unit tests (`pnpm test:android:unit`) need three local prerequisites:

- **An Android SDK that Gradle can find**, through `ANDROID_HOME` or `sdk.dir` in `android/local.properties`
  (git-ignored). A root-owned system SDK with only build-tools is not enough; point Gradle at a user SDK
  such as `~/Android/Sdk`.
- **A JDK 21+ test launcher.** Robolectric refuses to sandbox SDK 36 on Java 17. The Gradle toolchain in
  `android/app/build.gradle` requests Java 21.
- **The Robolectric SDK 36 runtime jar** (`android-all-instrumented-16-robolectric-13921718-i7`) in the
  pinned Robolectric cache. The build reads that cache from `ROBOLECTRIC_REPO_URL` and
  `ROBOLECTRIC_DEPENDENCY_DIR` when set, and from a local toolchain cache otherwise; a cache that only has
  the SDK 23 artifact fails.

### Robolectric pins `android.app.Application` (MEM016)

Robolectric boots the manifest's `MainApplication`, whose `ReactNativeApplicationEntryPoint` calls
`SoLoader` and throws a `NullPointerException` off-device. `android/app/src/test/resources/robolectric.properties`
therefore sets `application=android.app.Application`, so JVM tests never touch native loading. Keep it.

Related: in main source that unit tests reach, use `java.util.Base64`, not `android.util.Base64`; the latter
is an unmocked stub under JVM tests.

### Install dependencies and export `ANDROID_HOME` before Gradle (MEM017)

A fresh checkout, or one that lost its git-ignored setup, needs two things before any Gradle run:

```sh
pnpm install --frozen-lockfile   # node_modules must be a real directory, not a symlink
export ANDROID_HOME=$HOME/Android/Sdk
```

`node_modules` must not be a symlink, because `.gitignore` uses `node_modules/`, which does not match a
symlink. Unit tests also need JDK 21 through the Gradle toolchain (see MEM015 above).

### Headless emulator and stale validator state (MEM021)

- **The API 31 validator emulator must run with `-no-window`.** Agent and CI sessions have no `DISPLAY`;
  without the flag, Qt's xcb platform plugin fails fatally ("no Qt platform plugin could be initialized")
  and `android-validator.sh` reports only "Emulator or validator lock failed to start."
  `QT_QPA_PLATFORM=offscreen` gets further but still core-dumps. `scripts/validation/android-validator.sh`
  passes `-no-window`.
- **Clear stale state after an interrupted run.** `android-validator.sh start` aborts if
  `/tmp/cloud-sync-checker-api31` survives an interrupted run, or if any emulator is still attached to
  `adb`. Remove that directory and stop any attached emulator before retrying.

### Known issues from the S01 live gate (M001/S01/T08)

- **`-no-window` is unconditional.** The validator emulator never shows a window, even on a workstation with
  a display attached. That is the right default for a validation harness; to watch a run visually, remove
  the flag locally.
- **API 36 coverage.** The Maestro flows (`pnpm e2e:android`) run on both API 31 and API 36 since
  feature 003, and the API 36 AVD is provisioned as described in
  [Validation emulators](#validation-emulators). The live connect gate still runs on API 31 only
  (`pnpm validation:android:api31`); `pnpm validation:android:api36` exists but is not part of the gate
  yet. Adding API 36 to the connect gate belongs to feature 011 (`specs/011-full-loop-release`).

### An AVD with no SD card image (feature 003)

Setting `hw.sdCard = yes` and `sdcard.size` in an AVD's `config.ini` does not create the card: the image
file is only made by `avdmanager create avd -c <size>`. Without `sdcard.img` in the AVD directory the
emulator mounts no public volume, and `device-fixtures.sh` fails with "No public removable volume is
mounted". Create the image once, with the emulator stopped:

```sh
"$ANDROID_HOME/emulator/mksdcard" 512M ~/.android/avd/dependency_api31.avd/sdcard.img
```
