# Scope

## v1 scope

SyncScope v1 connects to **one remote server** with **one remote root** for all selected folders, through
**one active connection profile** using username and password. Scanning runs **in the foreground only**,
with visible progress and cancellation. The app is distributed as a **local debug or release APK** for the
user's own device, and must install and run the full loop on API 31 and API 36. Everything listed below is
deliberately outside v1.

## Deferred

Wanted eventually, but not in v1.

### R023 — Checksum verification as an optional stricter match mode

- **Class**: quality-attribute
- **Why it matters**: Name plus size plus mtime can theoretically collide; a content hash would make
  deletion safety airtight.
- **Rationale**: Deferred because it requires downloading remote file content, which v1 explicitly forbids
  (R026), and would make scans dramatically more expensive over FTP. See
  [D003](./decisions/0003-directory-agnostic-sync-matching.md).

### R024 — Multiple connection profiles and per-folder remote root mapping

- **Class**: core-capability
- **Why it matters**: A user with both a home NAS and a work server would eventually want to check folders
  against different targets.
- **Rationale**: The user explicitly scoped v1 to one remote server and one remote root for all folders.

### R025 — Background or scheduled scanning with notification

- **Class**: operability
- **Why it matters**: Long scans would not require the user to keep the app open.
- **Rationale**: The user chose a foreground app only, with visible progress, for v1. Background work would
  add foreground-service lifecycle, doze handling and notification permissions. See
  [D009](./decisions/0009-foreground-scan-and-freshness.md).

## Non-goals

Out of scope by design.

### R026 — No remote mutation of any kind: no upload, no remote delete, no download of remote file content

- **Class**: anti-feature
- **Why it matters**: Prevents scope confusion with backup and sync tools; the app is a read-only checker
  whose only write action is local deletion.
- **Rationale**: The `NativeCloudSync` spec comment already states that the foundation ships no remote
  mutation and no remote file-content download, and that later features must preserve that boundary. It is
  enforced by the read-only audit described in [protocols](./protocols.md#the-read-only-guarantee).

### R027 — No cloud-drive SDKs such as Google Drive, Dropbox or S3; protocol-level FTP, SFTP and WebDAV only

- **Class**: anti-feature
- **Why it matters**: Each SDK brings its own auth model and would balloon scope well past the protocol
  abstraction the user asked for.
- **Rationale**: The user specified FTP, SFTP and WebDAV explicitly.

### R028 — No key-based auth, OAuth or token auth

- **Class**: anti-feature
- **Why it matters**: Keeps the credential surface to exactly one shape, which is what the Keystore boundary
  and the schema test are built around.
- **Rationale**: The user answered "Username and password only" for v1 auth scope. This also sidesteps the
  SSHJ SSH-agent caveat that would need a Java 16+ runtime (see
  [D005](./decisions/0005-protocol-client-libraries.md)).

### R029 — No non-image preview: no video, no documents

- **Class**: anti-feature
- **Why it matters**: Video and document rendering each bring their own decoding and viewer stack for no gain
  on the primary photo-clearing loop.
- **Rationale**: The user specified "Preview a file (image only)".

### R030 — No Play Store distribution, signing pipeline or CI

- **Class**: anti-feature
- **Why it matters**: Distribution is a local APK for the user's own device; release engineering would be
  pure overhead at this stage.
- **Rationale**: The user answered "Local debug/release APK" for distribution. The codebase has no CI today.
