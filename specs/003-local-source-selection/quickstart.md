# Quickstart: validating Local Source Selection

How to prove this feature works. The commands are the project's own scripts, described in
[DEVELOPMENT.md](../../DEVELOPMENT.md). This page adds only what is specific to this feature.

## Prerequisites

- The toolchain from `DEVELOPMENT.md` (JDK, Android SDK, pnpm, Maestro 2.10.0).
- Both validation AVDs, each with an SD card:
  - `dependency_api31`: exists already (`hw.sdCard = yes`, `sdcard.size = 512 MB`).
  - `dependency_api36`: created from `system-images;android-36;google_apis;x86_64` with the same SD card
    settings. The steps are in `DEVELOPMENT.md` (added by this feature, research R10).

## 1. Static checks and unit tests

```sh
pnpm lint && pnpm typecheck
pnpm test:ci             # Jest (sources hook, SourcesSection, CloudSync wrappers) + script contract tests
pnpm test:android:unit   # JVM: SourceTree, SourceAlias, SourceOperations, SourcePicker, enumerator, DAO cascade, parity
```

**Expected**: all green, zero lint warnings. `CloudSyncContractsParityTest` passes with `CONTRACT_VERSION`
2 and the five new error codes in the same order on both sides.

## 2. End-to-end on both API levels

```sh
pnpm e2e:android         # android-flow.sh e2e --api 31 --api 36
```

The runner starts the protocol containers and Metro, then for each API level it boots the AVD, installs
the debug APK, runs `scripts/validation/device-fixtures.sh`, and runs `maestro test validation/maestro`.

**Expected**: every flow in `validation/maestro/sources/` passes on API 31 and then on API 36. The
scenario-to-flow mapping is in [contracts/maestro-conventions.md](./contracts/maestro-conventions.md). In
outline:

| Step | What you should see |
| --- | --- |
| Add `SyncScopeE2E/Camera` on internal storage | The row shows alias **Camera** and **Available** |
| Add `SyncScopeE2E/Camera` on the SD card | The row shows alias **Camera (SDCARD)** |
| Try to add `SyncScopeE2E/Camera/Nested` | Error naming **Camera**; the list is unchanged |
| Restart the app | The same two rows, in the same order |
| Grants released through the debug seam, then the app is relaunched | Both rows show **Access lost**, with Re-grant |
| Re-grant, picking a different folder | Mismatch error; the row still shows **Access lost** |
| Re-grant, picking the same folder | The row shows **Available**, with the same alias |
| Remove, then Cancel, then Remove and Confirm | The row stays after Cancel and disappears after Confirm |

If the API 36 run fails at the SD card step because the emulator exposes no removable volume, that is the
spec's open edge case, not a flaky test. Record what you observed and escalate it (research R10). Do not
skip the flow.

## 3. Manual check on a real device (optional, not a gate)

Install the debug APK, open **Settings › Folders**, add a folder from internal storage and one from an SD
card, then force-stop and reopen the app. Both should still be listed.
