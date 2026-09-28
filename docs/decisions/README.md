# Decision records

Append-only: reverse a decision with a new record that supersedes it; new records continue from 0018.

Each record is named `00NN-<kebab-slug>.md` and has the fields Status, Date / context, Scope, Made by and
Revisable, followed by the sections Context, Decision, Rationale, Alternatives rejected and Related.
D001–D015 were made before calendar dates were recorded, so their date column gives the milestone context
in which the decision was made (the record's "Date / context" field).

| ID | Title | Status | Scope | Date |
| --- | --- | --- | --- | --- |
| D001 | [Single CloudSync TurboModule; engine in Kotlin](./0001-single-cloudsync-turbomodule.md) | Accepted | architecture | M001 Layer 2 |
| D002 | [Room scan store; Keystore-backed credentials](./0002-room-scan-store-keystore-credentials.md) | Accepted | architecture | M001 Layer 2 |
| D003 | [Directory-agnostic sync matching](./0003-directory-agnostic-sync-matching.md) | Accepted | architecture | M001 Layer 2 |
| D004 | [Timestamp precision discovered at connect time](./0004-discovered-timestamp-precision.md) | Accepted | architecture | M001 research pass |
| D005 | [Protocol client libraries (SSHJ, Commons Net, OkHttp PROPFIND)](./0005-protocol-client-libraries.md) | Accepted | library | M001 Layer 2 |
| D006 | [UNKNOWN status is never deletable](./0006-unknown-status-never-deletable.md) | Accepted | architecture | M001 Layer 2 |
| D007 | [SFTP host keys: blocking trust-on-first-use](./0007-sftp-host-key-tofu.md) | Accepted | security | M001 Layer 2 |
| D008 | [Two-phase local deletion](./0008-two-phase-local-deletion.md) | Accepted | architecture | M001 Layer 2 |
| D009 | [Foreground-only scanning and freshness](./0009-foreground-scan-and-freshness.md) | Accepted | architecture | M001 Layers 1–2 |
| D010 | [Snapshot paging and gallery origin badge](./0010-snapshot-paging-and-origin-badge.md) | Accepted | architecture | M001 Layer 2 |
| D011 | [Typed error envelopes and partial scans](./0011-typed-error-envelopes-partial-scans.md) | Accepted | observability | M001 Layer 3 |
| D012 | [Maestro end-to-end flows as the proof bar](./0012-maestro-e2e-proof-bar.md) | Accepted | testing | M001 Layer 4 |
| D013 | [Full persistence layer in M001/S01](./0013-full-persistence-layer-in-s01.md) | Accepted | architecture | M001/S01 planning |
| D014 | [Container credentials via instrumentation runner args](./0014-container-credentials-via-runner-args.md) | Accepted | architecture | M001/S01 planning |
| D015 | [Docker major-version pin](./0015-docker-major-version-pin.md) | Accepted | environment | M001/S01/T08 |
| D016 | [SAF source identity, overlap and computed availability](./0016-saf-source-identity-and-availability.md) | Accepted | architecture | 2026-09-28 |
| D017 | [Debug-only grant-release seam for end-to-end flows](./0017-debug-grant-release-seam.md) | Accepted | testing | 2026-09-28 |
