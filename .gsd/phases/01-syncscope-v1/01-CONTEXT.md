# M001: SyncScope v1

**Gathered:** 2026-09-20
**Status:** Ready for planning

## Project Description

SyncScope is a React Native Android app that checks which of the user's selected local directories are synced with their cloud, so redundant local copies can be deleted with confidence.

The user connects to **one** remote repository over FTP, SFTP, or WebDAV with a username and password. They select local folders from on-device and removable storage. A foreground scan with a progress bar compares each local file against the remote listing. Results appear in three views — gallery, browsable list, browsable tree — filterable by all / synced / unsynced / issues-unknown. The user multi-selects and deletes **locally only**.

The app never writes to the cloud: no upload, no remote delete, no download of remote file content.

## Why This Milestone

The user's framing, verbatim: **"this app is to discover files that are sync and can be safely deleted."**

That single sentence reframes the whole product. Sync status is a *deletion-safety signal*, not a backup dashboard. Android phones fill up with photos scattered across app-dependent album directories; the cloud flattens them into its own structure with its own album solution. Nothing tells the user which local files are redundant, and manual comparison across FTP/SFTP/WebDAV is not something anyone actually does.

Why now: a foundation scaffold already exists with the full TurboModule contract declared, a Room schema with match/paging indexes, and digest-pinned protocol containers plus a Maestro emulator pipeline. The contract is designed; nothing behind it is implemented. This milestone fills in that pre-declared contract and ships the working app.

## User-Visible Outcome

### When this milestone is complete, the user can:

- Enter an FTP, SFTP, or WebDAV host with a username and password, and connect — with an SFTP host-key fingerprint prompt they explicitly approve or reject
- Pick local folders through the Android system picker, including removable storage, and have them persist across app restarts
- Tap Scan and watch a live progress indicator through a run that may take minutes
- See every scanned file marked SYNCED, UNSYNCED, or UNKNOWN
- Browse those results three ways: a flat gallery grid (with an origin badge on duplicate tiles), a browsable list that navigates into and back out of directories via breadcrumb, and a browsable expandable tree
- Filter to all / synced / unsynced / issues-unknown in any view
- Tap an image to preview it
- Multi-select files in any view, see an honest pre-flight breakdown ("N synced, N unsynced — are you sure, N unknown — refused"), confirm, and watch those files actually disappear from device storage
- Reopen the app and have the local side auto-refresh while the remote listing stays cached, with the remote's age shown near any delete action
- Hit "Rescan from scratch" whenever they want a full re-check

### Entry point / environment

- Entry point: the installed SyncScope APK, launched from the Android launcher
- Environment: real Android device/emulator, API 31 and API 36
- Live dependencies involved: FTP (vsftpd), SFTP (OpenSSH), WebDAV (Apache) — digest-pinned containers on 127.0.0.1 for validation; Android SAF/MediaStore for local access; Android Keystore for the password

## Completion Class

- **Contract complete means:** Robolectric + Room unit tests prove match-key collapsing, precision bucketing, page-token round-tripping, and query correctness; `SchemaContractTest` passes so no credential column exists in Room; Jest tests prove the JS contract wrapper's normalization and clamping.
- **Integration complete means:** `androidTest` on a real emulator exercises the FTP, SFTP, and WebDAV clients against the live digest-pinned containers — real listings, real auth, real host-key TOFU, real measured timestamp precision.
- **Operational complete means:** the release APK installs and launches on both API 31 and API 36; SAF grants survive process death; a revoked grant is detected on open; a backgrounded scan stops cleanly without promoting a partial snapshot.

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- `pnpm e2e:android` green on **both** API 31 and API 36: a Maestro flow taps through connect → pick folders → scan → filter → browse → multi-select → delete, end to end, against the live containers, with no mocking anywhere in the path
- A Maestro deletion flow removes **real files from real device storage** and the catalog reflects it — the user was explicit that "Maestro test should be an enough proof" for deletion, and equally explicit that a mocked `DocumentFile.delete()` does not count
- A partial-listing scenario (unreadable remote directory) completes the scan, marks the affected files UNKNOWN with an `issueCode`, reports the honest summary, and `prepareLocalDeletion` refuses those entries
- **What cannot be simulated:** whether the app feels "slick and modern." The user said *"I will judge it at the end."* That is human UAT on a real device, not a test.

## Architectural Decisions

### Single native TurboModule as the only JS-to-native API

**Decision:** `CloudSync` is the entire JS↔native surface. Protocol clients, scanning, matching, and deletion all run in Kotlin. JS is presentation only.

**Rationale:** Protocol clients are JVM libraries; running them native avoids a JS-side socket stack and keeps thousands of file records off the bridge. The scaffold already declares the complete method surface in `src/native/specs/NativeCloudSync.ts`, so this is filling in a pre-declared contract rather than designing one.

**Alternatives Considered:**
- JS-side protocol clients via RN networking — no viable SFTP/FTP story in JS, and it would push the whole catalog across the bridge.

### Room is the scan store; secrets never touch it

**Decision:** Scan state persists in Room (`local_node`, `remote_match_key`, `snapshot`, `scan_run`, `source_root`, `local_deletion_overlay`, `repository_config`, `trusted_sftp_host_key`). The password goes to Android Keystore-backed EncryptedSharedPreferences, referenced from Room only as `credentialVersion`.

**Rationale:** `SchemaContractTest` fails the build if `repository_config` grows a password/secret/ciphertext/cipher/nonce/credential_blob/token column — the boundary is enforced by test, not convention. Thousands of files also means the snapshot must live in a database, not in JS memory.

**Alternatives Considered:**
- Encrypted blob in Room — the schema test explicitly forbids it, and Keystore is the platform answer.

### Matching via collapsed remote_match_key, ignoring directory structure

**Decision:** Key is `(snapshotId, name, sizeBytes, precisionMillis, bucket)`. The remote listing collapses into match keys; local nodes look up by `(name, sizeBytes)` and then compare mtime inside the protocol's precision bucket. Directory trees are deliberately **not** compared.

**Rationale:** The user was explicit: *"It doesn't matter. It is important that given file is backed up. That means there can be duplicates on both device and remote... Directory tries might not match between device and remote. Android often have app dependent structure of directories (e.g. picture albums), cloud syncing often flattens it, and have its own solution for directories / albums."* The collapsed key makes this an indexed exact lookup rather than an O(n×m) walk.

**Alternatives Considered:**
- Path-relative matching — breaks the moment the remote flattens, which the user says is the normal case.

### Protocol timestamp precision is discovered, not assumed

**Decision:** Each protocol's actual timestamp precision is measured at connect time and recorded, feeding `precisionMillis` on the match key. FTP uses `mdtmFile()` where the server advertises MDTM and falls back to LIST-parse precision otherwise, degrading the bucket accordingly.

**Rationale:** Apache Commons Net documents MDTM as `yyyyMMDDhhmmss` with an *optional* `.xxx` fraction and notes "not all FTP servers honor this." FTP is second-precision at best and sometimes minute-granularity via LIST. A file compared at minute precision is materially weaker proof for deletion than one compared at second precision.

**Alternatives Considered:**
- Hardcoding per-protocol precision — would silently produce wrong sync verdicts against a server that behaves differently, and wrong here means deleting a file that is not actually backed up.

### Snapshot-scoped opaque paging, clamped to 200

**Decision:** Every query is tied to one `snapshotId`; page tokens are opaque and rejected on snapshot/query/sort mismatch (`PAGE_TOKEN_MISMATCH`, `STALE_GENERATION`). Gallery reads flat via `queryFiles`; list and tree read parent-scoped via `queryTreeChildren(snapshotId, parentId, …)`.

**Rationale:** Thousands of files across three views need one consistent read. The scaffold already clamps to `MAX_PAGE_SIZE = 200` on both sides. The Room index `index_local_node_snapshotId_sourceId_parentId_kind_name` exists specifically for parent-scoped listing, so browsable list/tree is the contract's natural shape.

**Alternatives Considered:**
- Load-all-into-JS-state — memory blowup and torn reads during rescan.

### Two-phase deletion

**Decision:** `prepareLocalDeletion` returns a plan token plus a breakdown (how many synced, how many unsynced, how many UNKNOWN-and-refused); `executeLocalDeletion(planToken)` commits. Results land in `local_deletion_overlay` so the current snapshot reflects deletions without a rescan.

**Rationale:** Deletion is irreversible and the whole app exists to drive it. A plan token makes the confirmation dialog show exactly what will happen and prevents a stale multi-select from deleting the wrong set.

**Alternatives Considered:**
- Single-call delete with a boolean force flag — no way to show an honest pre-flight summary.

### Scan lifecycle: foreground, generation-stamped, cancellable

**Decision:** One `scan_run` per attempt with a monotonic `generation`. `startScan`/`cancelScan`/`getScanState` drive the progress UI. Local side re-stats automatically on app open; remote listing stays cached until explicit rescan. Remote listing age is surfaced near any delete action.

**Rationale:** The user chose *"Foreground app only, but show progress"* and *"refresh local automatically - this app is to discover files that are sync and can be safely deleted."* Because the local side refreshes but the remote does not, a file can show SYNCED from a stale listing while having been deleted remotely since — given deletion is the point, that is a safety hazard, not a cosmetic one.

### Protocol library picks

**Decision:** SSHJ (SFTP), Apache Commons Net (FTP), hand-rolled OkHttp PROPFIND (WebDAV). Locked at planning time; S01 proves them against the real containers.

**Rationale:** SSHJ 0.40.0 made Bouncy Castle optional rather than a hard dependency (the old advice to swap in SpongyCastle predates this), Android compatibility work landed in 0.31.0, and it needs Java 8+ which minSdk 31 clears. WebDAV's read-only surface is small enough that Sardine's thinly-maintained old HTTP stack costs more than it saves.

**Alternatives Considered:**
- JSch for SFTP — abandoned.
- Sardine for WebDAV — thinly maintained, drags in an old HTTP stack for a surface we can write by hand.

**Residual risk:** whether BouncyCastle-free SSHJ supports the host-key and cipher algorithms the actual server negotiates. If it needs `bcprov-jdk18on` added, that is a dependency line, not a redesign. The SSHJ SSH-agent caveat (needs Java 16+ for unix-domain sockets) is irrelevant here — auth is username+password only.

### SFTP host key: blocking trust-on-first-use

**Decision:** First connect surfaces a challenge with the fingerprint; approve persists to `trusted_sftp_host_key`; reject aborts. A *changed* key later fails the connection hard and re-prompts — never a silent reconnect.

**Rationale:** The scaffold already committed to this shape with `approveSftpHostKey`/`rejectSftpHostKey` and a unique index on `(host, port, algorithm)`. Deletion decisions based on a spoofed remote listing would destroy unbacked-up files.

### Verification against real servers, not mocks

**Decision:** Robolectric + Room for unit logic; `androidTest` against the live digest-pinned containers for protocol clients; Maestro on real emulators for every user-visible claim.

**Rationale:** `validation/services/compose.yaml` pins FTP/SFTP/WebDAV images by digest on 127.0.0.1, and `android-flow.sh e2e --api 31 --api 36` already orchestrates containers → Metro → emulator → APK install → `maestro test validation/maestro`. The infrastructure exists; it just has no flows in it yet.

## Error Handling Strategy

The user chose **sensible defaults** for this layer. The defaults below were presented in full and confirmed.

**Typed envelopes everywhere.** Every native call returns `{contractVersion, status, error?}` with a stable machine-readable `code` and a redacted, actionable `message`. No thrown exceptions cross the bridge, no raw paths or credentials in messages.

**Connection failures — fail fast, no retry on auth.** Host unreachable, auth rejected, TLS failure, or host-key refusal each surface inline in the connect screen with a distinct code. Retrying a bad password is never automatic — it just locks accounts.

**Mid-scan remote errors — the scan never aborts wholesale.** An unreadable directory or a dropped connection marks the affected local candidates UNKNOWN with an `issueCode`, and the run completes with an honest summary: "listing incomplete — N files could not be checked." A partial scan must never be indistinguishable from a clean one, because the user acts on it by deleting things.

**Retries — bounded backoff, 3 attempts, transient network only** (socket timeout, connection reset). Never on auth, never on a protocol-level refusal.

**Cancellation / backgrounding — foreground-only.** Backgrounding mid-scan stops the run; the partial snapshot is discarded, not promoted. The active snapshot is always a completed run.

**Deletion failures — per-file outcomes, never all-or-nothing.** File already gone, permission denied, SAF grant revoked each report individually. `local_deletion_overlay` records only actual successes, so the catalog never claims a deletion that did not happen.

**Stale remote listing —** remote age shown near any delete action; past 7 days it suggests a rescan rather than blocking. The threshold is a tunable default, not a hard rule.

**Permission loss —** detected on open. The affected source is marked unavailable and its files become UNKNOWN rather than silently disappearing from the catalog.

**Native module unavailable —** `NATIVE_MODULE_UNAVAILABLE` renders a hard error screen. No mock fallback, no empty state pretending to be a working app.

## Risks and Unknowns

- **`MainApplication.kt` registers no CloudSync package** — the TurboModule is declared in TypeScript with codegen configured (`codegenConfig` → `com.syncscope.codegen`) but has zero Kotlin implementation. Every native call currently dies at `TurboModuleRegistry`. This is the first thing S01 must close; nothing else works until it does.
- **SSHJ and Commons Net on modern Android** (minSdk 31, compileSdk 37, Kotlin 2.2.0, R8, new architecture) — unproven in this codebase. S01 proves it against the live containers or blocks.
- **`validation/maestro/` does not exist** — the runner is fully wired (`android-flow.sh e2e` → Maestro 2.10.0 → `maestro test validation/maestro`) but there are zero flow files. Every user-visible claim owes one. The first slice needing a flow creates the directory.
- **SAF / scoped storage across API 31 vs 36** — folder access is the entire input side of the app, and behaviour differs materially across that range. Removable storage in particular may not behave consistently enough to be a first-class source on both levels.
- **Timestamp precision reconciliation** — FTP MDTM, SFTP attrs, and WebDAV `getlastmodified` each expose different precision. The bucketing must be right or sync status is wrong, and wrong here means deleting a file that is not actually backed up. Exact per-protocol buckets need *measurement* against the real containers, not spec-reading.
- **Filtered browse navigation** — when a filter is applied in list or tree view, directories whose children are all filtered out could make navigation dead-end. Current thinking: show them dimmed with a count rather than hiding them. Needs resolution during slice planning.

## Existing Codebase / Prior Art

- `src/native/specs/NativeCloudSync.ts` — the complete TurboModule contract. Everything except `queryFiles`/`queryTreeChildren` returns a typed `NOT_IMPLEMENTED` envelope today. Its header comment states the boundary later features must preserve: no secret getters, no remote mutation, no remote file-content download, no raw local path operation.
- `src/native/CloudSyncContracts.ts` — versioned DTOs, `CloudSyncErrorCode`, `FileStatus` (`SYNCED`/`UNSYNCED`/`UNKNOWN`), `FileFilter` (`ALL`/`SYNCED`/`UNSYNCED`/`ISSUES_UNKNOWN`), `clampPageSize`, `MAX_PAGE_SIZE = 200`, `DEFAULT_PAGE_SIZE = 50`.
- `src/native/CloudSync.ts` — the typed JS client wrapper. Presentation code consumes this only; no ad hoc native module access elsewhere.
- `android/app/src/test/java/com/syncscope/persistence/SchemaContractTest.kt` — asserts no credential columns in `repository_config`, and asserts the existence of the match indexes (`index_remote_match_key_snapshotId_name_sizeBytes`, plus the full unique key), the paging/view indexes, and the unique keys including `index_trusted_sftp_host_key_host_port_algorithm`.
- `android/app/src/main/java/com/syncscope/MainApplication.kt` — **the gap.** `PackageList(this).packages` with no manual addition; no CloudSync package registered.
- `android/app/build.gradle` — Room 2.8.4 + KSP with `room.schemaLocation` exporting reviewed schemas; Robolectric 4.16.1 against a pinned local m2 cache; kotlinx-coroutines-android 1.10.2.
- `android/build.gradle` — minSdk 31, compileSdk 37, targetSdk 36, Kotlin 2.2.0, `newArchEnabled=true`, `hermesEnabled=true`.
- `validation/services/compose.yaml` — digest-pinned vsftpd (32120, passive 32200-32209), OpenSSH (32122), Apache WebDAV (32180), all bound to 127.0.0.1, with credentials injected as a compose secret.
- `scripts/validation/android-flow.sh` — the e2e orchestrator: starts all three protocol services, starts Metro, boots each AVD, assembles the debug APK, installs via adb, then runs Maestro 2.10.0 against `validation/maestro` with a 600s timeout.
- `src/navigation/AppNavigator.tsx`, `src/screens/PlaceholderScreen.tsx` — the navigation shell with Material Design icons. Placeholder screens to be replaced.

## Relevant Requirements

- R001–R004, R018 — S01 establishes the live connection, host-key TOFU, credential boundary, measured precision, and the typed error envelope
- R005 — S02 makes local sources selectable and durable
- R006, R007, R015, R016, R017 — S03 delivers the scan engine, the matcher, snapshot lifecycle, and honest partial reporting
- R008, R009, R011, R021 — S04 delivers gallery, browsable list, filtering, and the Material 3 shell
- R010, R014 — S05 delivers browsable tree and image preview
- R012, R013 — S06 delivers multi-select and two-phase deletion
- R019, R020, R022 — S07 closes the full loop, the e2e proof on both API levels, and the documentation set

## Scope

### In Scope

- One remote server profile: FTP, SFTP, or WebDAV, username + password auth
- One remote root; all selected local folders compared against it
- Local folder selection from on-device and removable storage
- Sync determination: file name + size + modified time, compared at the shared precision the protocol exposes
- Three views over the same file set: gallery (flat grid), list (browsable), tree (browsable)
- Filter: all / synced / unsynced / issues-unknown
- Multi-select + local-only delete — synced by default, unsynced behind a stronger warning, UNKNOWN refused
- Image preview
- Foreground-only scanning with visible progress
- Origin badge in gallery view, on duplicates only, showing the originating local folder
- Persisted scan snapshot: local side auto-refreshes on open, remote listing cached until explicit rescan
- "Rescan from scratch" as a first-class control
- Unit + e2e tests, `./docs` kept in sync, user-focused README

### Out of Scope / Non-Goals

- Uploading, downloading, or any remote mutation — the app never writes to the cloud
- Deleting remote files
- Background or scheduled scanning
- Multiple connection profiles or multiple remote roots
- Key-based auth, OAuth, token auth
- Cloud-drive SDKs (Google Drive, Dropbox, S3) — protocol-level only
- Non-image preview (video, documents)
- Play Store distribution, signing pipeline, CI
- Content hashing / checksum comparison

## Technical Constraints

- React Native 0.87, new architecture enabled, Hermes
- Android only; minSdk 31, compileSdk 37, targetSdk 36, Kotlin 2.2.0
- pnpm 11.3.0, Node 24.11.1, TypeScript 6 strict
- Local debug/release APK distribution — no Play Store, no signing pipeline, no CI
- KISS, YAGNI, DRY, consistency, decoupling
- Tests mandatory: unit + e2e
- Material 3 via `react-native-paper` only; no ad-hoc inline styles
- Slick, modern, user-friendly design — judged by the user at milestone end
- The scaffold's declared boundary must be preserved: no secret getters, no remote mutation, no remote file-content download, no raw local path operations across the bridge

## Integration Points

- **FTP (vsftpd container, 127.0.0.1:32120, passive 32200-32209)** — read-only listing via Apache Commons Net; MDTM for precise timestamps where advertised
- **SFTP (OpenSSH container, 127.0.0.1:32122)** — read-only listing via SSHJ; host-key TOFU against `trusted_sftp_host_key`
- **WebDAV (Apache container, 127.0.0.1:32180)** — read-only PROPFIND via hand-rolled OkHttp; `getlastmodified` is RFC 1123 HTTP-date, second precision
- **Android SAF / MediaStore** — local folder selection, persisted URI grants, file enumeration, and local deletion
- **Android Keystore / EncryptedSharedPreferences** — the only place the password lives
- **Maestro 2.10.0** — drives the real APK on API 31 and 36 emulators against the live containers

## Testing Requirements

Four tiers, each with a distinct job:

| Tier | Runner | Proves |
|---|---|---|
| Unit (JS) | `pnpm test` — Jest + Testing Library | Contract normalization, page-size clamping, error envelope re-tagging, component rendering/state |
| Unit (Kotlin) | `pnpm test:android:unit` — Robolectric + Room | Schema contract, match-key collapsing, precision bucketing, paging tokens, query correctness |
| Integration (Kotlin) | `pnpm test:android:connected` — `androidTest` on emulator | Protocol clients against the live digest-pinned containers; real listings, real auth, real host-key TOFU |
| E2E (Maestro) | `pnpm e2e:android` — APK on API 31 + 36 | The actual user loop, tapped through, against live servers |

**E2E is the bar for user-visible claims.** A slice does not get to say "the user can X" unless a Maestro flow in `validation/maestro/` taps through X on a real emulator. Component tests with a mocked TurboModule are supporting evidence, never the proof.

**Deletion proof is specifically Maestro** — a flow that multi-selects real files, confirms, deletes, and asserts the catalog reflects it, against real files in real device storage. No mocked `DocumentFile.delete()` counts as proof for that slice.

**Both API levels.** 31 and 36 both run. Scoped-storage and SAF behaviour differ materially across that range, and folder access is the whole input side of the app.

Also enforced mechanically:
- `SchemaContractTest` fails the build on any credential column in Room
- `pnpm typecheck` clean (TypeScript 6, strict)
- `pnpm lint` clean — `--max-warnings=0`
- `pnpm test:ci` green — foundation node tests plus Jest

## Acceptance Criteria

**Per slice:**

- **S01 — Native CloudSync module + live protocol connect:** `MainApplication.kt` registers the CloudSync package and the TurboModule resolves at runtime. A connect screen accepts host, protocol, username, and password. Connecting to each of the three live containers succeeds. An SFTP first-connect surfaces the fingerprint and persists on approval; a changed key blocks and re-prompts. The password is written to Keystore-backed storage and `SchemaContractTest` still passes. The discovered timestamp precision for each protocol is recorded and readable. Auth failure, host unreachable, and host-key rejection each return distinct typed codes with redacted messages. Proven by `androidTest` against real containers.
- **S02 — Local source selection via SAF:** The user picks folders via the system picker, including removable storage. Sources persist across app restart in `source_root`. A revoked grant is detected on open and the source is marked unavailable rather than vanishing. Proven by a Maestro flow on API 31 and 36.
- **S03 — Scan engine, matching, and snapshot lifecycle:** Tapping Scan produces live progress and a completed snapshot with per-file SYNCED/UNSYNCED/UNKNOWN. An unreadable remote directory yields UNKNOWN entries with `issueCode` and an honest "N files could not be checked" summary rather than an aborted run. Backgrounding mid-scan discards the partial snapshot. Reopening auto-refreshes the local side while leaving the remote cached. "Rescan from scratch" produces a new generation. Matching is proven by Robolectric tests over the collapsed match key including precision-bucket edge cases; the loop is proven by Maestro.
- **S04 — Gallery view, filtering, and Material 3 shell:** A virtualized gallery grid renders the snapshot with paged reads. Filter chips switch between all / synced / unsynced / issues-unknown and the counts agree with the snapshot. Duplicate tiles carry an origin badge naming the originating local folder; unambiguous tiles carry none. Browsable list view navigates into and back out of directories via breadcrumb. All interactive elements carry accessibility labels. Proven by a Maestro flow.
- **S05 — Browsable tree view and image preview:** Tree view expands and collapses over the same snapshot with the same navigation semantics as list. With a filter applied, directories whose children are filtered out remain visible (dimmed, with a count) rather than dead-ending navigation. Tapping an image opens a preview. Proven by a Maestro flow.
- **S06 — Multi-select and two-phase local deletion:** Multi-select works from gallery, list, and tree. `prepareLocalDeletion` returns a breakdown naming synced, unsynced-warned, and unknown-refused counts; the confirmation dialog shows it. UNKNOWN entries are refused outright, not warned. Unsynced deletion requires the stronger warning. Execution reports per-file outcomes and `local_deletion_overlay` records only successes. Remote listing age is visible at the point of decision. Proven by a Maestro flow that deletes real files from real storage.
- **S07 — Full-loop integration, docs, and release APK:** `pnpm e2e:android` green on API 31 and API 36 for connect → pick folders → scan → filter → browse → select → delete. Release APK installs and launches. No `NOT_IMPLEMENTED` envelope remains for any method a slice claims to own. `./docs` is coherent and current; README leads with user-focused instructions.

**Milestone-level:** all of the above, plus `pnpm typecheck` / `pnpm lint` / `pnpm test:ci` / `pnpm test:android:unit` / `pnpm test:android:connected` green, and the user's visual sign-off on "slick and modern."

## Open Questions

- **Exact precision buckets per protocol** — needs measurement against the real containers rather than spec-reading. Current thinking: discover at connect time (R004) and record, so the answer is data rather than a constant.
- **Removable storage (SD card) via SAF on both API levels** — whether it behaves consistently enough to be a genuinely first-class source. Current thinking: treat it as first-class, and if API 36 diverges, surface the limitation explicitly rather than silently degrading.
- **The 7-day staleness threshold** — a default, not a researched number. Current thinking: ship it tunable and revisit after real use.
- **Filtered browse navigation** — directories whose children are all filtered out. Current thinking: show dimmed with a count. To be settled in S05 planning.
<!-- gsd:state-version=88:0 -->
