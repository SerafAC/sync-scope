---
id: T05
parent: S01
milestone: M001
key_files:
  - android/app/src/main/java/com/syncscope/remote/WebDavRemoteClient.kt
  - android/app/src/main/java/com/syncscope/remote/PropfindParser.kt
  - android/app/src/test/java/com/syncscope/remote/PropfindParserTest.kt
  - android/app/build.gradle
  - android/app/src/main/java/com/syncscope/remote/RemoteClient.kt
  - android/app/src/main/java/com/syncscope/bridge/CloudSyncContracts.kt
  - src/native/CloudSyncContracts.ts
key_decisions:
  - OkHttp redirects are disabled (followRedirects/followSslRedirects false): OkHttp turns a redirected OPTIONS into a GET, which protocol-audit.sh fails on even for reads. Collection URLs always end in a trailing slash so mod_dav never needs to redirect.
  - A truncated or unclosed multistatus body is an error (SERVER_ERROR), never a shorter listing. The platform parser accepts EOF with unclosed tags, so the parser requires the DAV:multistatus root to be closed.
  - Added REMOTE_ROOT_NOT_FOUND and SERVER_ERROR to CloudSyncErrorCode in both Kotlin and TS, in the same order. A 404 is REMOTE_ROOT_NOT_FOUND only for connect or root requests; a 404 on a subdirectory is DIRECTORY_UNREADABLE.
  - WebDAV precision is structural: 1000ms with PrecisionBasis.RFC1123_WHOLE_SECONDS, no network probe, and Win32LastModifiedTime is not consulted.
  - Calls use enqueue plus suspendCancellableCoroutine, with body parsing on OkHttp's callback thread, so coroutine cancellation aborts an in-flight listing through call.cancel().
duration:
verification_result: passed
completed_at:
blocker_discovered: false
---

# T05: Added the read-only OkHttp WebDavRemoteClient (OPTIONS + PROPFIND only, redirects never followed, Basic auth) with a streaming XmlPullParser PROPFIND parser that rejects truncated multistatus bodies, structural 1s RFC1123 precision, and distinct REMOTE_ROOT_NOT_FOUND / SERVER_ERROR codes mirrored into the TS contracts

**Added the read-only OkHttp WebDavRemoteClient (OPTIONS + PROPFIND only, redirects never followed, Basic auth) with a streaming XmlPullParser PROPFIND parser that rejects truncated multistatus bodies, structural 1s RFC1123 precision, and distinct REMOTE_ROOT_NOT_FOUND / SERVER_ERROR codes mirrored into the TS contracts**

## What Happened

Retry after a transient credential-cooldown failure. None of the prior attempt's work was on disk, so implementation started fresh.

- **Dependency:** added OkHttp 4.12.0 (cached with okio 3.6.0). Offline resolution lacked a kotlin-stdlib-jdk8:1.9.10 pom, so Gradle resolves online. The gate command runs online anyway.
- **Error codes:** the plan requires distinct codes for 404 and 5xx, and CloudSyncErrorCode had neither. Added REMOTE_ROOT_NOT_FOUND and SERVER_ERROR after DIRECTORY_UNREADABLE in both the Kotlin enum and src/native/CloudSyncContracts.ts. The order matters because CloudSyncContractsParityTest compares ordered lists. Also added PrecisionBasis.RFC1123_WHOLE_SECONDS.
- **PropfindParser.kt:** a streaming parser on android.util.Xml with namespace processing, which handles Apache's lp1: live-property prefix. DOCDECL processing is disabled.
  - It reads props only from 2xx propstats, so Apache's 404 propstat for displayname is ignored. A response with only a bare non-2xx status is dropped.
  - DAV:collection maps to DIRECTORY; everything else is REGULAR_FILE. An absent content length becomes -1.
  - Hrefs can be absolute URLs or paths. They are percent-decoded without form semantics, so '+' is kept.
  - The self entry is skipped by comparing normalized decoded paths.
  - getlastmodified is parsed with DateTimeFormatter.RFC_1123_DATE_TIME. A malformed or absent date gives null and never throws.
  - Found and fixed during testing: the platform parser reports END_DOCUMENT at EOF without complaining about unclosed tags, so a truncated body silently parsed as a shorter directory. That would be a false 'not backed up' signal for a sync checker. The parser now throws when the root is not DAV:multistatus, when the root is never closed, or when END_DOCUMENT arrives inside response, propstat, or a text element.
- **WebDavRemoteClient.kt:**
  - connect issues OPTIONS on the root collection URL. It needs DAV class 1 in the DAV header; otherwise it fails with CONNECTION_REFUSED 'does not offer WebDAV'. It then issues PROPFIND Depth 0 to prove the root exists and is a collection; if not, it fails with DIRECTORY_UNREADABLE.
  - list issues PROPFIND Depth 1 with a body naming exactly displayname, getcontentlength, getlastmodified, and resourcetype.
  - discoverPrecision returns 1000ms with basis RFC1123_WHOLE_SECONDS. It needs a session but makes no network call.
  - Collection URLs are built per segment with addPathSegment (so they are encoded) and always end in a trailing slash, so mod_dav never redirects.
  - followRedirects and followSslRedirects are both false. OkHttp's redirect handling turns a redirected OPTIONS into a GET, which protocol-audit.sh treats as a failure (R026).
  - Calls use enqueue plus suspendCancellableCoroutine, and the body is parsed on OkHttp's callback thread. Coroutine cancellation calls call.cancel(), which closes the socket and aborts a long listing mid-stream instead of waiting out the 30s read timeout.
  - The Basic header lives only in the in-memory session and is dropped on close.
- **Error mapping (WebDavFailures):**
  - Status codes: 401 → AUTH_FAILED. 404 on connect or root → REMOTE_ROOT_NOT_FOUND. 404 on a subdirectory → DIRECTORY_UNREADABLE, since a folder vanishing mid-scan is not a missing root. 5xx → SERVER_ERROR. 3xx or other non-4xx on connect → CONNECTION_REFUSED. Other 4xx → DIRECTORY_UNREADABLE.
  - Transport errors: SocketTimeout, or OkHttp's InterruptedIOException("timeout") → CONNECTION_TIMEOUT. Connect, NoRoute, or UnknownHost → CONNECTION_REFUSED. Anything else → CONNECTION_LOST.
  - Malformed XML or a runtime error while parsing → SERVER_ERROR 'listing could not be read'.
  - An invalid host → CONNECTION_REFUSED, because OkHttp's own message quotes the host.
  - Every message is a fixed string. Host, username, password, and path appear only in the exception cause, as in the FTP and SFTP clients.
- **Tests:** PropfindParserTest has 13 tests and runs under Robolectric so the real platform parser is used. They cover the plan's four fixture cases plus hardening cases. They also run the real client against an in-test loopback ServerSocket, which records methods, paths, Depth, Authorization, and body.
- **Not changed:** CloudSyncModule does not yet dispatch to any protocol client, same as after T03 and T04, so there was no module change. Real Apache listings are proven in T08.

## Verification

- `cd android && ./gradlew :app:testDebugUnitTest --no-daemon`: 14 classes, 104 tests, 0 failures. That includes PropfindParserTest (13 tests) and CloudSyncContractsParityTest (3 tests).
- Plan grep: PROPFIND is present in WebDavRemoteClient.kt and MKCOL is absent (exit 0).
- An extra grep found no quoted GET, PUT, DELETE, MOVE, COPY, MKCOL, PATCH, or POST literals in the WebDAV sources.
- `./gradlew assembleDebug`: BUILD SUCCESSFUL.
- `npx tsc --noEmit`: exit 0 after the TS error-code mirror change.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `cd android && ./gradlew :app:testDebugUnitTest --no-daemon (14 classes, 104 tests, 0 failed)` | 0 | ✅ pass | 32000ms |
| 2 | `grep -q 'PROPFIND' app/src/main/java/com/syncscope/remote/WebDavRemoteClient.kt && ! grep -q 'MKCOL' app/src/main/java/com/syncscope/remote/WebDavRemoteClient.kt` | 0 | ✅ pass | 10ms |
| 3 | `grep -nE '"(GET|PUT|DELETE|MOVE|COPY|MKCOL|PATCH|POST)"' WebDavRemoteClient.kt PropfindParser.kt (expect no match)` | 1 | ✅ pass | 10ms |
| 4 | `cd android && ./gradlew assembleDebug --no-daemon` | 0 | ✅ pass | 46000ms |
| 5 | `npx tsc --noEmit` | 0 | ✅ pass | 1806ms |

## Deviations

- Added two error codes (REMOTE_ROOT_NOT_FOUND, SERVER_ERROR) to CloudSyncContracts.kt and src/native/CloudSyncContracts.ts, which are outside the task's file list. The plan requires distinct 404 and 5xx codes and parity is enforced across the two files.
- Added PrecisionBasis.RFC1123_WHOLE_SECONDS in RemoteClient.kt.
- connect also issues PROPFIND Depth 0 on the root, to prove it exists and is a collection; OPTIONS alone doesn't show that.
- The test adds an in-test loopback HTTP responder beyond the plan's parser-only fixture.
- Gradle resolves OkHttp online, because the offline cache lacks the kotlin-stdlib-jdk8:1.9.10 pom.

## Known Issues

- The scheme is fixed at http through a constructor default, because RemoteConfig has no TLS flag. HTTPS WebDAV needs a config field before release, since release builds block cleartext.
- CloudSyncModule does not yet dispatch to a WebDAV client; that wiring belongs to the connect-flow task.
- There is no per-directory entry cap (see Load Profile).

## Files Created/Modified

- `android/app/src/main/java/com/syncscope/remote/WebDavRemoteClient.kt`
- `android/app/src/main/java/com/syncscope/remote/PropfindParser.kt`
- `android/app/src/test/java/com/syncscope/remote/PropfindParserTest.kt`
- `android/app/build.gradle`
- `android/app/src/main/java/com/syncscope/remote/RemoteClient.kt`
- `android/app/src/main/java/com/syncscope/bridge/CloudSyncContracts.kt`
- `src/native/CloudSyncContracts.ts`
<!-- gsd:state-version=57:0 -->
