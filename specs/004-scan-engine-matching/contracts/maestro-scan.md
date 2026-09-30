# Contract: Scan end-to-end flows

Follows the conventions set by feature 003 (`DEVELOPMENT.md` › End-to-end flows, which is authoritative).
The flows live in `validation/maestro/scan/` and share `subflows/configure-repository.yaml` and
`subflows/add-scan-source.yaml`.

## Seam: `syncscope-debug://configure-repository` (D018)

A debug-only activity in `android/app/src/debug/`. Query parameters: `protocol`, `host`, `port`,
`username`, `password`, `root`. It runs the production `RepositoryOperations.save`, then `test`. When `test`
returns an SFTP host-key challenge, it calls `approveSftpHostKey` and tests again, then finishes and shows
the result code in a text view for Maestro to assert. It never logs the intent or its URI. The password
is a throwaway per-run container credential (as in D014), which is the only reason it may travel in a
debug deep link that Android or Maestro could log (D018). `android-flow.sh` injects the per-run container
credentials as Maestro `-e` variables (`FTP_PORT`, `FTP_USER`, `FTP_PASSWORD`, `FTP_ROOT`, and the same
for `SFTP_*` and `WEBDAV_*`; host `10.0.2.2`). Each flow passes the set it needs to
`subflows/configure-repository.yaml`.

## Selectors

Every control has an accessibility label, which is its Maestro selector: `Scan`, `Rescan from scratch`,
`Cancel scan`, `Scan progress`, `Scan summary`, `Files that could not be checked`,
`Remote listing age`, `Rescan suggested`, `Scan failed`, `Last scan` (mode label, generation and
completion time).

## Acceptance scenario mapping

Each flow is added to `validation/maestro/config.yaml` by the task that creates it, never before the file
exists. Each flow starts from `clearState`, configures the repository through the seam, and adds only the
`SyncScopeE2E/Scan` source (flow 05 also adds `SyncScopeE2E/Bulk`). The counts below assume exactly that.

| Spec item | Flow | Protocols | Asserts |
| --- | --- | --- | --- |
| Acceptance 1, 2; FR-002; NFC edge | `01-clean-scan-{ftp,sftp,webdav}.yaml` | FTP, SFTP, WebDAV | Progress visible; summary synced = 4 (exact, 2× reusable, NFC name), unsynced = 3 (size mismatch, `local-only.txt`, `only-here.txt`), unknown = 0 |
| Acceptance 3; FR-005; SC-002 | `02-partial-listing-{ftp,sftp,webdav}.yaml` | FTP, SFTP, WebDAV | Remote root `scan/partial`: summary "1 remote folder could not be read"; synced = 1 (`exact.txt`), unsynced = 0, "Files that could not be checked" = 6 (every unmatched file, `only-here.txt` included) |
| Acceptance 4; FR-004 | `03-rescan.yaml` | SFTP | "Rescan from scratch" produces a new generation (label text changes) and a new completion time |
| Acceptance 5; FR-003 | `04-reopen-refresh.yaml` | SFTP | After `stopApp` / `launchApp`: a `LOCAL_REFRESH` runs by itself; "Remote listing age" is unchanged |
| Acceptance 6; FR-001; SC-003 | `05-background-discards.yaml` | SFTP | With the Bulk source added: tap `Cancel scan` mid-run and see "Cancelled"; then rescan, press Home, relaunch: the last run shows "Cancelled (app left)". Both times the previous summary is still shown |
| Acceptance 7; FR-006 | `06-unreachable-fails.yaml` | SFTP | Reconfigure with a wrong password; scan: "Scan failed" with the auth recovery action; the previous summary is still shown |
| FR-007 | `07-revoked-source.yaml` | SFTP | `release-grants` seam (D017), then scan: the skipped source is named in the summary |

Precision-bucket edges, case sensitivity, duplicate collapsing and rule order are proven by JVM tests
(SC-001). A Maestro flow cannot place a timestamp on a bucket edge reliably across three servers.
