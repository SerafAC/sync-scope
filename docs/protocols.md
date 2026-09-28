# Protocols

SyncScope reads remote metadata over FTP, SFTP or WebDAV with a username and password (R001). Every client
implements the read-only `RemoteClient` interface (`connect`, `list`, `discoverPrecision`, `close`), which
has no byte-reading surface. Library choices are recorded in
[D005](./decisions/0005-protocol-client-libraries.md); why precision is discovered is in
[D004](./decisions/0004-discovered-timestamp-precision.md).

All clients map failures to the same typed, redacted error codes (`AUTH_FAILED`, `CONNECTION_REFUSED`,
`CONNECTION_TIMEOUT`, `CONNECTION_LOST`, `DIRECTORY_UNREADABLE`, plus protocol-specific codes below).
Messages are fixed strings; host, username, password and path appear only in the exception cause
([D011](./decisions/0011-typed-error-envelopes-partial-scans.md)).

## FTP (Apache Commons Net)

Commons Net 3.12.0, passive mode only (`enterLocalPassiveMode()`), 15 s connect and 30 s socket/data
timeouts, UTF-8 control encoding. Listing uses `mlistDir` (MLSD) when FEAT advertises MLST, otherwise
`listFiles` (LIST).

**Precision basis.** Precision is empirical: the MDTM advertisement only decides whether to probe, and the
replies decide the result. In order of preference:

1. **MDTM** — each sampled reply's sub-second part maps to 1000 / 100 / 10 / 1 ms, and the finest sample
   wins, so one file landing on `.000` cannot downgrade a millisecond server
   (`MDTM_SUBSECOND`, `MDTM_WHOLE_SECONDS`).
2. **MLSD** — the `modify` fact's fraction, if no MDTM reply is usable (`MLSD_SUBSECOND`,
   `MLSD_WHOLE_SECONDS`).
3. **LIST** — the parsed date's granularity. This takes the *coarsest* sample (a year-form line gives a day,
   86 400 000 ms), floored at 60 000 ms, so old files listed by date only are not falsely compared at minute
   width (`LIST_GRANULARITY`).

With no regular files to sample, the result is `NO_SAMPLE_FILES` at 60 000 ms.

**Breadth-first precision sample.** A repository root commonly holds only folders, so sampling just the root
would leave precision permanently undiscovered. `discoverPrecision()` walks breadth-first to the nearest
directory holding regular files, bounded at `PRECISION_SCAN_DIRECTORIES = 16` directories, and samples up to
`PRECISION_SAMPLES = 5` files there. Dot, `cdir` and `pdir` entries are excluded, and the shallowest samples
win (M001/S01/T08).

Known limits: LIST timestamps are interpreted in the JVM default zone unless the server zone is configured;
hidden files are not requested via `LIST -a` (MLSD returns them); the FTP password must be passed to Commons
Net as a `String`, which cannot be wiped.

## SFTP (SSHJ)

SSHJ 0.40.0 with `bcprov-jdk18on` 1.80.2 (the bundled Bouncy Castle provider is appended in place of
Android's stripped platform one), 15 s connect and 30 s socket timeouts. Listing uses `SFTPClient.ls`
(OPENDIR/READDIR); no file handle is ever opened. Symlink, FIFO and modeless entries are classified `OTHER`.
Precision is 1000 ms (`SFTP_V3_WHOLE_SECONDS`), because SFTP v3 reports mtime in whole seconds.

**Blocking trust-on-first-use** ([D007](./decisions/0007-sftp-host-key-tofu.md), R002):

- An unknown host key returns a challenge (`SFTP_HOST_KEY_UNVERIFIED`) carrying the host, port, algorithm and
  a `SHA256:<base64>` fingerprint. The fingerprint is computed over SSHJ's own key encoding, self-checked
  with SSHJ's `FingerprintVerifier`, and matches OpenSSH `ssh-keygen -lf` output byte for byte, so the user
  can compare it against `ssh-keyscan`.
- `approveSftpHostKey` persists the key to `trusted_sftp_host_key`; `rejectSftpHostKey` persists nothing and
  the connection is aborted.
- Trust is per host and port across algorithms. Any other key for a trusted endpoint, including one of a
  different algorithm, fails hard with `SFTP_HOST_KEY_CHANGED` (including the previous fingerprint) and
  re-prompts; it never reconnects silently. Approval replaces the endpoint's key, so a superseded key never
  verifies again.
- The verifier decides against a snapshot of trusted rows loaded before connect, so SSHJ's transport thread
  does no database I/O.
- Pending challenges live in memory only (at most 16, 15-minute lifetime, newest per endpoint). An unknown,
  consumed or expired challenge id gives `HOST_KEY_CHALLENGE_NOT_FOUND`; after a restart, the next connect
  simply asks again.

## WebDAV (OkHttp PROPFIND)

A hand-written client on OkHttp 4.12.0 using only `OPTIONS` and `PROPFIND`, with Basic auth.

- **Connect** issues `OPTIONS` on the root collection and requires DAV class 1, then `PROPFIND Depth: 0` to
  prove the root exists and is a collection.
- **Multi-value `DAV` header.** Apache `mod_dav` answers `OPTIONS` with two `DAV` headers (`DAV: 1,2` and
  `DAV: <http://apache.org/dav/propset/fs/1>`), and OkHttp's `Response.header("DAV")` returns only the last
  one, which names no class. The class check must read `response.headers("DAV")` and flatten every value,
  or a perfectly good WebDAV server reads as not-WebDAV (MEM020, fixed in M001/S01/T08).
- **Listing** issues `PROPFIND Depth: 1` naming exactly `displayname`, `getcontentlength`,
  `getlastmodified` and `resourcetype`. The streaming parser reads props only from 2xx propstats, and
  rejects a truncated or unclosed multistatus body as `SERVER_ERROR` instead of returning a shorter listing
  — a shorter listing would be a false "not backed up" signal.
- **Redirects are never followed** (`followRedirects` and `followSslRedirects` are off): OkHttp turns a
  redirected `OPTIONS` into a `GET`, which the read-only audit fails. Collection URLs always end in a
  trailing slash so `mod_dav` never needs to redirect.
- **Precision is structural**: 1000 ms (`RFC1123_WHOLE_SECONDS`), because `getlastmodified` is an RFC 1123
  date with no sub-second field. No network probe is made.
- A 404 on connect or on the root is `REMOTE_ROOT_NOT_FOUND`; a 404 on a subdirectory is
  `DIRECTORY_UNREADABLE`; a 5xx is `SERVER_ERROR`.

Known limit: the scheme is fixed at `http`, because the repository configuration has no TLS flag yet. HTTPS
WebDAV needs a configuration field before release, since release builds block cleartext.

## The read-only guarantee

The app never uploads, deletes remotely or downloads remote file content (R026). Beyond the client
interfaces having no content-read surface, `scripts/validation/protocol-audit.sh` enforces this against the
live validation containers: stopping the services scans each server's log, and any forbidden operation fails
the run even if every test passed.

| Protocol | Forbidden operations |
| --- | --- |
| FTP | `RETR`, `STOR`, `APPE`, `DELE`, `RNFR`, `RNTO`, `MKD`, `RMD`, `PORT`, `EPRT` |
| SFTP | `open` for read or write, `remove`, `rename`, `mkdir`, `rmdir`, `symlink` |
| WebDAV | `GET`, `PUT`, `DELETE`, `MOVE`, `COPY`, `MKCOL`, `PATCH`, `POST` |

**FTP scoping for vsftpd (MEM022).** The FTP scan reads only vsftpd `FTP command:` lines. vsftpd answers
`FEAT` by advertising its own capabilities, `EPRT` among them, on `FTP response:` lines, so an unscoped grep
fails every clean run the moment a client calls `FEAT`. Scoping to command lines still catches a genuine
`RETR`, `PORT` or `EPRT` command. In the M001/S01/T08 live run, the FTP client issued only `FEAT`, `LIST`,
`MDTM`, `PASS`, `PASV`, `QUIT`, `SYST` and `USER`.

## Validation container ports

The containers in `validation/services/compose.yaml` publish on host loopback (`127.0.0.1`). Clients on the
emulator must reach them through `10.0.2.2`, the emulator's alias for host loopback, never `127.0.0.1`
([D014](./decisions/0014-container-credentials-via-runner-args.md)).

| Protocol | Emulator address | Notes |
| --- | --- | --- |
| FTP | `10.0.2.2:32120` | Passive data ports 32200–32209; `vsftpd.conf` sets `pasv_address=10.0.2.2`. |
| SFTP | `10.0.2.2:32122` | ed25519 host key. |
| WebDAV | `10.0.2.2:32180` | Plain HTTP with Basic auth. |

Credentials are regenerated on every service start and reach the instrumented tests through runner
arguments ([D014](./decisions/0014-container-credentials-via-runner-args.md)). How to run the stack is in
[architecture](./architecture.md#validation-infrastructure).
