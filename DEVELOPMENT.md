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
| `assemble:release` | Builds the release APK with Gradle. |

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
`maestro test validation/maestro`. The flows are the proof that a user-visible capability works
([D012](./docs/decisions/0012-maestro-e2e-proof-bar.md)). The rules below apply to every flow; feature
003 set them up (its design record is
`specs/003-local-source-selection/contracts/maestro-conventions.md`).

### Layout

```text
validation/maestro/
├── config.yaml      # executionOrder.flowsOrder + continueOnFailure: false
├── subflows/        # reusable steps, never run on their own
│   ├── pick-folder.yaml            # drives the system folder picker; env VOLUME, PATH
│   ├── open-sources.yaml           # launches the app and opens Settings › Folders
│   ├── configure-repository.yaml   # the configure-repository seam; env PROTOCOL, PORT, USER, PASSWORD, ROOT
│   ├── add-scan-source.yaml        # adds SyncScopeE2E/Scan (and Bulk with BULK=true)
│   ├── open-scan.yaml              # opens the Scan tab
│   └── start-scan.yaml             # taps Scan (or BUTTON) and waits for the run to end
├── sources/         # one directory per feature area (feature 003)
│   ├── 01-add-internal.yaml
│   └── …
└── scan/            # feature 004
    ├── 01-clean-scan-{ftp,sftp,webdav}.yaml
    └── …
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
  state. Every `scan/` flow is self-contained instead: it starts from `clearState`, configures the
  repository through the seam and adds only the sources it needs. A restart is `stopApp` then
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
  ([D018](./docs/decisions/0018-debug-repository-seam.md)). It stands in for the Connect screen until
  feature 008. An optional `scanDelayMs=<ms>` sets a debug-only pause before each local file is matched
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

The script is idempotent, and it fails with a clear message when no SD card is mounted, so
removable-storage coverage is never skipped silently. New fixtures go in this script, under
`SyncScopeE2E/`.

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
| `FTP_ROOT`, `SFTP_ROOT`, `WEBDAV_ROOT` | `/`, `/srv/fixtures`, `/webdav`; each flow appends `/scan/clean` or `/scan/partial` |

Each scan flow passes the set it needs to `subflows/configure-repository.yaml`.

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

For FTP use port `32120` and root `/`; for WebDAV, port `32180` and root `/webdav`. Stop the emulator afterwards with
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
- The Android `versionName` and `versionCode` in `android/app/build.gradle` do not derive from it yet.
  Deriving them from `package.json` is tracked in `specs/008-full-loop-release`.

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
  yet. Adding API 36 to the connect gate belongs to feature 008 (`specs/008-full-loop-release`).

### An AVD with no SD card image (feature 003)

Setting `hw.sdCard = yes` and `sdcard.size` in an AVD's `config.ini` does not create the card: the image
file is only made by `avdmanager create avd -c <size>`. Without `sdcard.img` in the AVD directory the
emulator mounts no public volume, and `device-fixtures.sh` fails with "No public removable volume is
mounted". Create the image once, with the emulator stopped:

```sh
"$ANDROID_HOME/emulator/mksdcard" 512M ~/.android/avd/dependency_api31.avd/sdcard.img
```
