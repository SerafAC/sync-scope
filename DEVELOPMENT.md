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
| FFmpeg | any recent build with `libx264` (the `ffmpeg` command) | Only `scripts/validation/fixture-images.sh --regenerate`, which rebuilds the checked-in 2 s MP4 and JPEG fixtures (feature 009); not needed to build, test, seed or run the flows (`--check` needs no `ffmpeg`) |

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

### Graphics acceleration (feature 008)

`pnpm e2e:android` runs `scripts/validation/android-flow.sh e2e --api 31 --api 36 --graphics auto`, so
normal validation uses the verified, ranked automatic profile. Calling `android-flow.sh` directly without
`--graphics` still reproduces the original emulator launch (`-gpu swiftshader_indirect`). That launch
exists only to reproduce the original baseline and is never used as a fallback.

```sh
scripts/validation/android-flow.sh e2e --api 31 --graphics auto
```

- `auto` discovers the exposed Intel host GPU and the emulator's software modes. It tries the ranked
  candidate first when the report directory holds a ranking for that API. The default report directory
  is `validation/evidence/performance/`, whose `acceleration-ranking.json` is the published ranking.
  Without a ranking it tries host routes first, then software.
- NVIDIA is excluded from discovery and ranking (decision 2026-10-20). `host-nvidia-1` is recorded as
  `unavailable` with reason `excluded`, and the scripts never call `nvx`. Earlier NVIDIA calibrations
  remain only as history.
- `host-opengl` tries host routes (`-gpu host -feature -Vulkan -accel on`) and then software, without a
  ranking. `software` tries only `swiftshader`, `software`, then `lavapipe` and `swangle`.
- KVM is required. Every boot is verified: CPU mode, actual renderer, driver, image, resources and
  animation scales. A candidate that fails, or that reports the wrong renderer, is released and the next
  one is tried. The run fails with an actionable message when no candidate works. A fallback is
  recorded as a different, `provisional` profile, not as the ranked hardware result.
- A ranking is reused only while its `rankingFingerprint` still matches the app, flows, helpers,
  fixtures, image, drivers, exposed GPUs, host power and guest settings. Otherwise it is `stale`.
  `measure --graphics auto` recalibrates one candidate per invocation. Any change to a flow, helper, the
  app or a fixture script therefore makes the published ranking stale until it is recalibrated.
- The scripts never change GPU power, drivers, the SDK (resolved from `ANDROID_HOME` by
  `scripts/validation/android-sdk.sh`) or the AVDs.

Measured on 2026-10-21 (T046 recalibration, three H01–H08 repetitions per candidate and API):
`host-intel-1` ranks first on both APIs. Its H03+H07+H08 subtotal was 443.5 s against 469.4 s for
`software-swiftshader` on API 31, and 454.4 s against 502.6 s on API 36. The full `pnpm e2e:android`
acceptance (T047) passed on both APIs with that profile. Details and the automated fallback check
(`scripts/validation/acceleration-fault-check.mjs`) are in
[Validation performance evidence](./docs/validation-performance.md#graphics-acceleration-us2).

## End-to-end flows (Maestro)

`pnpm e2e:android` runs every Maestro flow in `validation/maestro/` on API 31 and then API 36.
`scripts/validation/android-flow.sh` starts the protocol containers and Metro, and builds the debug APK
once, before the API loop. It uses `--no-daemon` and `-PreactNativeArchitectures=x86_64`, because the
emulators are x86_64. Release, signing and connected builds keep all their ABIs. For each API level it
boots the AVD, installs that same APK (the invocation records its digest), runs
`scripts/validation/device-fixtures.sh`, and then runs `maestro test validation/maestro`, followed by
the [staged pairs](#staged-pairs-and-hooks).

**How long it takes.** On the development host, with the ranked `host-intel-1` profile on both APIs
(T047, 2026-10-21), the whole two-API run took about 3 h 03 min (10,995 s). Per API, the workspace of
40 flows took 4,780–4,984 s, the seven staged parts 447–454 s and the device-fixture validation about
97–99 s. The build took 22 s and each boot 36–41 s. The legacy software launch with the same flows
took about 3 h 16 min (T045). The workspace step is capped at 7,200 s per API. The old estimate of
"about 55 minutes per API" predates feature 007 and is no longer accurate.
Metro is started once and serves both API levels under the unchanged 14,400-second (four-hour) cap
(`scripts/validation/metro-service.sh`); e2e, connected, release and standalone owned emulators retain
the separate 9,000-second (2.5-hour) cap (`scripts/validation/android-validator.sh`). Newly acquired
`measure` emulators alone have an approved finite 14,400-second cap, authenticated by the full
invocation claim; borrowed emulators are unchanged and no arbitrary lifetime override exists.
Historical timing estimates do not prove
that a current campaign fits either limit. The flows are the proof that a user-visible capability works
([D012](./docs/decisions/0012-maestro-e2e-proof-bar.md)). The rules below apply to every flow; feature
003 set them up (its design record is
`specs/003-local-source-selection/contracts/maestro-conventions.md`).

Feature 008's observational `measure` mode and private original-input retention are documented in
[Validation performance evidence](./docs/validation-performance.md). Metadata capture uses the existing
JDK compiler and SDK build-tools 37.0.0 D8 for a read-only, temporary shell probe when an animation
setting is unset; it never changes the app or guest settings. The original software baseline remains
incomplete after retained scheduled failures: diagnosis ties the API 31 H08 device loss to the old
measurement emulator's 2.5-hour cap, independently of Metro's four-hour expiration on the combined
campaign. Approved recovery uses separate API-specific invocations and the measurement-only cap,
with explicit lifetime-policy provenance, not a speedup claim. Expired Metro cleanup retains logs and releases only state
with a matching acquired receipt/claim, absent saved PID/group and unoccupied port, without signaling
any process. Do not interpret hotspot attempts as complete acceptance or silently replace failures.
Watchdog setup retains the original root/stop/unroot policy: both `ctl.stop` requests must succeed,
asynchronous service shutdown must be observed, and the normal shell UID, boot/network readiness and
owned serial/process identity must pass afterward. Unknown or failed observations fail startup;
private `raw/validator-<api>/watchdog.private` records fixed stage/status categories, not raw commands.
The separate repaired-startup campaign encountered an H05 artifact-boundary failure and was
interrupted without promoting or replacing its failed sample. The authorized narrow parser repair
counts sequential one-millisecond initialization records with identical timestamps only once,
while retaining both execution counts and strict conflict/assertion validation. Diagnostic ingestion
does not rewrite earlier results or contribute baseline samples. The separate fresh API 31 campaign
passed 21 scheduled samples but failed H08 repetition 1's required scrollbar-thumb assertion and
stopped safely; API 36 and full phase baselines were not started. Its cause needs diagnosis, not a
parser/assertion waiver or automatic replacement. Evidence and cleanup proof are documented in the
performance page; later per-cohort collection completed T014 there.

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
│   ├── open-sources.yaml           # navigation only: opens Settings, waits for its sections to load, scrolls to Add folder
│   ├── fill-field.yaml             # replaces one form field's text; env FIELD, TEXT. Since feature 008 it erases the measured length and requires the exact value on read-back
│   ├── fill-field-pass.yaml        # one erase-residue pass of fill-field (at most 8, unrolled)
│   ├── configure-repository.yaml   # the configure-repository seam; env PROTOCOL, PORT, USER, PASSWORD, ROOT, ROOT_2
│   ├── add-scan-source.yaml        # adds SyncScopeE2E/Scan (and Bulk with BULK=true), or the SOURCES list
│   ├── open-scan.yaml              # opens the Scan tab
│   ├── setup-repository.yaml       # the Repository form, as a user fills it; env PROTOCOL, PORT, USER, PASSWORD, ROOT, HTTPS, START, EXPECT
│   ├── start-scan.yaml             # taps Scan (or BUTTON); requires a new generation and its terminal line
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
├── performance/     # feature 008 regressions, after the 39 original flows
│   └── 01-field-replacement.yaml   # real-form field matrix: empty/prefilled/secure/numeric, long roots
├── tree/            # feature 009, after performance/
│   ├── 01-expand-collapse-sftp.yaml
│   ├── 02-filter-dimmed-ftp.yaml
│   ├── 03-preview-image-webdav.yaml
│   ├── 04-video-gallery-preview-sftp.yaml
│   └── 05-tree-select-delete-ftp.yaml
└── staged/          # feature 006: a/b(/c) parts with a hook between them; not in config.yaml
    ├── pairs.txt
    ├── 06-recheck-removed-{a,b}.yaml
    ├── 07-delete-offline-{a,b,c}.yaml
    ├── 08-changed-{a,b}.yaml
    ├── 09-resync-{a,b,c}.yaml             # feature 009
    ├── 10-selection-survives-{a,b}.yaml   # feature 009
    └── 11-toolbar-halves-{a,b}.yaml       # feature 009
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
- `subflows/open-sources.yaml` is navigation only (feature 008). It never launches, stops or resets the
  app, so the caller owns that transition and leaves `MainActivity` open: a `clearState` launch, a real
  restart, a return from a debug seam Activity (with `launchApp`), or the screen the previous flow ended
  on. The subflow waits until the Settings tab is selected and "Loading repository" and "Loading
  folders" are gone before it scrolls to `sources.add`. A new source row is scrolled to
  (`scrollUntilVisible`), not only waited for, because a late load can push it below the fold.
- `subflows/start-scan.yaml` proves that the tap started a run. It reads the "Generation <n>" shown
  before the tap and requires a different generation, then the run's terminal line ("Completed …" or
  "Ended …") with no progress card left. With `PROGRESS: required`, the "Scan progress" card must be
  visible first. A disappearing card alone is never accepted, and no step is optional. The
  `01-clean-scan-*` flows keep `SCAN_DELAY_MS: "4000"`: at 1000 ms the WebDAV scan (and SFTP on API 31)
  finished before Maestro could see the card (`validation/evidence/performance/scan-pacing.md`).
- `subflows/fill-field.yaml` never assumes a contextual "Select all". It reads the field, erases the
  measured length, hides the keyboard and reads again. It repeats the erase until the value is
  unchanged (at most eight passes), then taps, types, hides the keyboard once and requires the exact
  value. A password is checked only as a mask of the typed length, and the authentication proves it.
  Do not use `eraseText` "all", an `inputText` replace flag or Ctrl+A/End keys, because pinned Maestro
  2.10.0 does not support them. `performance/01-field-replacement` covers the matrix on both APIs.

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
  200 folders, kept while its validated marker matches (see
  [Fixture reuse](#fixture-reuse-feature-008)). Only the progress and backgrounding flow
  (`scan/05-background-discards`) adds it.

For the browse flows (feature 005) it seeds three more sources on internal storage, made of real,
decodable PNGs so the gallery can draw thumbnails:

- `SyncScopeE2E/Gallery`: `sunset.png`, `beach.png` and `album/forest.png`, byte-identical to the remote
  `gallery/` root (SYNCED), plus the local-only `harbor.png`, `drafts/draft.png` and `album/notes.txt`
  (UNSYNCED; the text file counts in list view only).
- `SyncScopeE2E/GalleryTwin`: a `sunset.png` of a different size, so it is UNSYNCED and shares its name
  with the Gallery copy, which gives both tiles an origin badge.
- `SyncScopeE2E/GalleryBulk`: `g0000.png` and on, `GALLERY_BULK_FILES` copies of one PNG (default 2 000,
  whole numbers 1 to 9 999), kept while its validated marker matches. Only `browse/01-gallery-thousands` adds it, and it
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

For the tree view, the preview and the refresh re-check (feature 009,
`specs/009-tree-view-image-preview/contracts/maestro-tree-preview.md`, Fixtures) it seeds the immutable
`tree` set in `SyncScopeE2E/ScanTree`, the device side of the remote `scan/tree`, all with one fixed mtime:

| Path | Contents |
| --- | --- |
| `Album/2024/` | `a1.jpg`–`a5.jpg` |
| `Album/2025/` | `b1.jpg`, `new.jpg` and `clip.mp4` (2 s, 64×64, H.264, no audio) |
| `Album/Docs/` | `doc.pdf` |
| `Empty/` | nothing |
| `Loose.jpg` | at the top |

`tree_fixture_files` in `fixture-images.sh` defines the set once for both sides. It is kept while its
marker validates, like the other immutable sets. Within one API run the staged lines see what the
workspace flows left: `tree/05` deletes `a1`–`a3` only, `staged/10` touches `a4`, and the changed set is
reseeded before the next API level. `scripts/validation/fixture-images.sh --check` decodes every embedded
fixture, checks its type and the MP4's codec and 2 s duration, and lists them; `--regenerate` rebuilds
`JPG_TREE` and `MP4_CLIP` with `ffmpeg`, rewrites them in the script and runs `--check`. The script
contract is `tree-fixtures.test.mjs`.

#### Fixture reuse (feature 008)

The five large, immutable sets (`Bulk`, `GalleryBulk`, `Narrow`, `Scroll` and `DCIM/Big`) are kept
only when they are proven unchanged. A matching file count is no longer enough. Each set has a
completion marker in `/data/local/tmp/syncscope-fixtures`, outside every scanned tree. The marker holds
a fingerprint of the generator scripts, the set's name, path and parameters, and a digest of the tree
taken right after a successful seed. That digest covers paths, sizes, content hashes, and mtimes where
the flows depend on them. On each run the script recomputes the digest and keeps the set (`unknown →
validating → valid`) or removes the marker and reseeds it. The marker is written only after the seed
succeeds, so a failed or interrupted seed always reseeds next time.

Every mutable tree (`Scan`, `TwoFolders`, `Gallery`, `GalleryTwin`, `Delete`, `Recheck`, `Offline`,
`Select`, `Changed`) is re-created on every run, on primary storage and on the SD card. The runner
resets the fixtures once per API before its workspace and before every measured repetition, but never
between the parts of a staged line. Validating all five kept sets takes about 88–99 s per API.
Regenerating them takes about 580–630 s (`validation/evidence/performance/fixture-reuse.md`). Changing
`device-fixtures.sh`, `fixture-images.sh` or `scroll-manifest.sh` changes the generator fingerprint, so
the next run reseeds every set.

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
R11). Generating the Bulk set took about 70 s at the time. It is now kept between runs while its marker
validates, so a changed `BULK_FILES` reseeds it once. On a much faster or slower machine, time a scan of both sources from
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

Feature 009 adds `scan/tree/`, the same files as the device `tree` set, **including**
`Album/2025/new.jpg`, on all three servers and in the services' before-manifest. `staged/09-resync`
removes `new.jpg` from the SFTP tree and puts it back (`remove-recheck-file.sh` and
`restore-recheck-file.sh` with the path), and the runner's cleanup restores it too, so an interrupted run
leaves the seeded tree.

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
| `04-remote-folders-webdav` | the form, shared WebDAV endpoint and two relative folders; TwoFolders | Host keeps the shared URL path without replacing either folder, the browser root is the endpoint, per-folder test lines, a file only the second folder holds is SYNCED and passes the re-check, the overlap refusal |
| `05-remote-folder-unread-ftp` | the seam, `root` twice; TwoFolders | one unread folder: the scan completes, names it, and unmatched files are UNKNOWN; all folders unread: the scan fails and the result stays |
| `06-remote-browse-sftp` | the form, never saved | the server folder browser: key approval first, descend, Up, Use this folder, the login error |
| `07-results-updated-keeps-place` | WebDAV; Scroll | a rescan keeps the first visible file on top in the list and in the hidden gallery, with "Results updated" |
| `08-add-large-folder` | clearState | the large-folder hint, then `DCIM/Big` (10 000 files) added by opening it and tapping Use this folder at once |

### Tree flow order

The `tree/` flows (feature 009) run after `performance/`. The full scenario mapping, with the recorded
deviations, is in `specs/009-tree-view-image-preview/contracts/maestro-tree-preview.md`. Every flow scans
the `tree` set.

| Flow | Protocol | Proves |
| --- | --- | --- |
| `01-expand-collapse-sftp` | SFTP | the Tree view: expand and collapse, indented children, the same folders as list view |
| `02-filter-dimmed-ftp` | FTP | under Unsynced, `Album/Docs` is dimmed with "0" and still expands |
| `03-preview-image-webdav` | WebDAV | tapping `Loose.jpg` in gallery, list and tree opens the image preview; Back returns to the same view and place |
| `04-video-gallery-preview-sftp` | SFTP | the MP4 tile's play badge and "0:02", row thumbnails with the badge, and the muted video preview with pause and seek |
| `05-tree-select-delete-ftp` | FTP | selection in tree view and from the preview, then the existing delete flow; leaves `a4`, `a5`, `Album/2025` and `Loose.jpg` for the staged lines |

### Staged pairs and hooks

A scenario that needs server or device state to change between two steps is split into parts in
`validation/maestro/staged/`. `config.yaml` never lists them, so the workspace run skips them. After the
workspace, `android-flow.sh` reads `staged/pairs.txt`: each line alternates flows and hooks,
`<flow>|<hook and args>|<flow>[|<hook and args>|<flow>…]`. Only the first flow of a line starts from
`clearState`. Hooks are in `scripts/validation/hooks/` and run on the host:

| Hook | Does | Line |
| --- | --- | --- |
| `remove-recheck-file.sh [<fixture path>]` | deletes `recheck/beach.png`, or the given file, from the fixture tree the containers serve | `06-recheck-removed`: the server re-check moves the file, and it is not deleted; `09-resync` (feature 009) with `scan/tree/Album/2025/new.jpg`, before the full scan |
| `pause-service.sh <protocol>` / `resume-service.sh <protocol>` | `docker compose pause` / `unpause` of one container | `07-delete-offline`: with the server unreachable, nothing is deleted |
| `change-device-files.sh [<fixture path>]` | through `adb`, removes `Changed/beach.png` and sets a new mtime on `Changed/sunset.png` while the confirmation is open; with a path such as `scan/tree/Album/2024/a4.jpg`, sets the new mtime on that device file | `08-changed`: per-file `Already gone` and `Changed since the scan`; `10-selection-survives` (feature 009): the changed `a4.jpg` is dropped from the selection, `a5.jpg` stays |
| `assert-equal-halves.sh` | reads a `uiautomator dump` and fails unless the buttons `files-sort` and `files-view` are each 50 % ± 2 % of `files-toolbar` (it measures the buttons, not their `-control` wrappers) | `11-toolbar-halves` (feature 009, FR-006); covered by `assert-equal-halves.test.mjs` |
| `restore-recheck-file.sh [<fixture path>]` | puts `recheck/beach.png`, or the given file, back | `09-resync` with `scan/tree/Album/2025/new.jpg`, before the relaunch whose automatic refresh must find it; also run by the runner after the staged lines for both files, so the protocol audit and the next API level see the seeded tree |

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
