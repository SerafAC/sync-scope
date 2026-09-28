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

The API 31 emulator image is needed for the connected tests and the S01 live gate.

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
| `e2e:android` | Maestro end-to-end flows on API 31 and API 36. |

### The S01 live gate

Changes to the native CloudSync layer must also pass the live connect gate against real protocol servers:

```sh
pnpm validation:services:start && pnpm validation:services:health && pnpm validation:android:api31 && pnpm validation:services:stop
```

It needs Docker, Compose and the API 31 emulator image. Expect exit 0, every instrumented test passing and
three clean protocol audits. How the gate works is described in
[docs/architecture.md](./docs/architecture.md).

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
- **API 36 coverage is deferred.** The live connect gate has only run on API 31
  (`pnpm validation:android:api31`). API 36 coverage belongs to the integration closure of feature 008
  (`specs/008-full-loop-release`).
