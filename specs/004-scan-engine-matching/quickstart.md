# Quickstart: validating the scan engine

How to prove this feature works. Behaviour is specified in [spec.md](./spec.md), rules in
[data-model.md](./data-model.md), and the bridge surface in
[contracts/cloudsync-scan.md](./contracts/cloudsync-scan.md).

## Prerequisites

- The branch contains feature 003 (research R1).
- The toolchain from `DEVELOPMENT.md`: pnpm, JDK 17, Android SDK, Docker 29.x / Compose 5.5.1, Maestro
  2.10.0.
- API 31 and API 36 AVDs with an SD card (as for feature 003).

## 1. Unit tests (no device, no network)

```sh
pnpm lint && pnpm typecheck
pnpm test:ci                 # Jest: contracts v3, CloudSync wrappers, useScan, ScanScreen
pnpm test:android:unit       # JVM: Matcher, MatchIndex, RemoteWalker, DirectoryRollup, ScanEngine,
                             # SnapshotStore additions, migration 1→2, module + parity tests
pnpm test:foundation         # fixture-seed / device-fixtures / android-flow script contracts
```

Expected: all pass. `MatcherTest` must include:

- the `duplicates/{a,b}/reusable.jpg` pair collapsing to one key with count 2;
- an NFC/NFD pair that matches;
- `IMG.jpg` vs `img.jpg`, which does not match;
- times on the same side of a bucket edge that match, and a pair straddling the edge that does not;
- rule order: a match beats an incomplete listing.

## 2. Live end-to-end (real emulator, real containers)

```sh
pnpm validation:services:start && pnpm validation:services:health
pnpm e2e:android             # runs validation/maestro/ on API 31, then API 36
pnpm validation:services:stop   # also runs the read-only protocol audit
```

Expected: every flow in [contracts/maestro-scan.md](./contracts/maestro-scan.md) passes on both API
levels, and the protocol audit reports zero forbidden operations (scanning only lists metadata, R026).

To run one flow while iterating:

```sh
maestro test -e SFTP_PORT=… -e SFTP_USER=… -e SFTP_PASSWORD=… -e SFTP_ROOT=… \
  validation/maestro/scan/01-clean-scan-sftp.yaml
```

The per-run credentials are in the validation state directory; `DEVELOPMENT.md` explains how to read them.

## 3. Manual smoke check (optional)

1. Configure the repository via the seam, add `SyncScopeE2E/Scan` in Settings › Folders, open **Scan** and
   tap **Scan**. The counters move and the summary shows synced 4, unsynced 3, unknown 0.
2. Leave the app and come back. A local refresh runs, and "Remote listing checked …" keeps its time.
3. Tap **Rescan from scratch**. A new run starts, and the listing age resets.
