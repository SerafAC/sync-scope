---
id: T07
parent: S01
milestone: M001
key_files:
  - scripts/validation/android-flow.sh
  - scripts/validation/protocol-service.sh
  - scripts/validation/protocol-services.sh
  - android/app/build.gradle
key_decisions:
  - Instrumentation argument keys are <proto>User / <proto>Password with proto in {sftp, ftp, webdav}; a protocol is added only when both username and password are present, so tests can treat an absent key as 'container not provisioned'.
  - Left the exact Docker 29.7.2 pin untouched: it is a deliberate environment guard outside T07's allowed edits (only repo= lines) and is asserted by validation-infrastructure.test.mjs.
duration:
verification_result: mixed
completed_at:
blocker_discovered: false
---

# T07: Validation scripts now derive the repo root from their own location (so android-flow.sh runs this worktree's android/gradlew), and app/build.gradle bridges host-side SYNCSCOPE_*_CREDENTIAL_FILE credentials into testInstrumentationRunnerArguments (sftpUser/sftpPassword, ftpUser/ftpPassword, webdavUser/webdavPassword) without ever printing them

**Validation scripts now derive the repo root from their own location (so android-flow.sh runs this worktree's android/gradlew), and app/build.gradle bridges host-side SYNCSCOPE_*_CREDENTIAL_FILE credentials into testInstrumentationRunnerArguments (sftpUser/sftpPassword, ftpUser/ftpPassword, webdavUser/webdavPassword) without ever printing them**

## What Happened

Defect 1: replaced the hardcoded `repo=/home/adi/projects/cloud-sync-checker` in scripts/validation/android-flow.sh:19, protocol-service.sh:32 and protocol-services.sh:6 with `repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)`. I kept #!/bin/sh and set -eu. As the plan required, I left the /tmp/cloud-sync-checker-* state prefixes, the validator lock, the toolchain cache paths and the image digests unchanged. android-flow.sh now runs "$repo/android/gradlew" -p "$repo/android" against whichever checkout it lives in.

Defect 2 (per D014): I added a syncScopeContainerCredentials() helper to android/app/build.gradle and call it from defaultConfig through testInstrumentationRunnerArguments.putAll(...). At configuration time it reads SYNCSCOPE_{SFTP,FTP,WEBDAV}_CREDENTIAL_FILE. For each file that is set, is a regular readable file, and has both username= and password= lines, it adds <proto>User and <proto>Password. It splits each line on the first '=' only, so passwords that contain '=' survive. Unset, missing, unreadable or incomplete files add nothing, and values are never logged. validation-infrastructure.test.mjs needed no changes because none of its content assertions reference the repo= lines.

## Verification

Task verify passed: pnpm test:foundation ran 5/5 green, the three greps confirm no hardcoded repo= remains, and build.gradle contains testInstrumentationRunnerArguments. `sh -n` passes on all three scripts. I checked Gradle configuration with an init script that prints only argument keys. With no env vars the arguments are [] and exit is 0. With a complete sftp file, an incomplete ftp file and a missing webdav path, the arguments are [sftpPassword, sftpUser] and exit is 0, and the test password (which contains '=') does not appear anywhere in the build output. The plan's by-inspection live check (validation:services:start/health/stop) could NOT be completed. Start exits 1 with "Docker 29.7.2 is required." because the host now runs Docker 29.8.1 (server and client) and protocol-service.sh:64 pins exactly 29.7.2. Since start failed, no credential files were created, and stop correctly refused to touch compose projects it didn't own. The script did resolve and run from this worktree, which confirms the new repo derivation works.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm test:foundation && ! grep -q 'repo=/home/adi/projects/cloud-sync-checker' scripts/validation/{android-flow,protocol-service,protocol-services}.sh && grep -q 'testInstrumentationRunnerArguments' android/app/build.gradle` | 0 | pass | 2143ms |
| 2 | `sh -n scripts/validation/{android-flow,protocol-service,protocol-services}.sh` | 0 | pass | 20ms |
| 3 | `cd android && ./gradlew -q --init-script <print runner-arg keys> :app:help (no credential env)` | 0 | pass (keys=[]) | 9800ms |
| 4 | `cd android && SYNCSCOPE_SFTP/FTP(incomplete)/WEBDAV(missing)_CREDENTIAL_FILE=... ./gradlew -q --init-script <print keys> :app:help` | 0 | pass (keys=[sftpPassword, sftpUser]; password not in output) | 9900ms |
| 5 | `pnpm validation:services:start` | 1 | fail (environment: host Docker 29.8.1, script pins 29.7.2) | 1700ms |

## Deviations

The plan's by-inspection live-container check could not run because of the host Docker version pin described in knownIssues; all automated verify commands passed.

## Known Issues

Host Docker was upgraded to 29.8.1, but scripts/validation/protocol-service.sh:64 requires exactly '29.7.2 29.7.2' (also stubbed in validation-infrastructure.test.mjs:194). Until someone either loosens the pin (a human decision, since the pin is deliberate) or the host goes back to Docker 29.7.2, validation:services:start fails, and T08's live androidTest run cannot start the containers.

## Files Created/Modified

- `scripts/validation/android-flow.sh`
- `scripts/validation/protocol-service.sh`
- `scripts/validation/protocol-services.sh`
- `android/app/build.gradle`
<!-- gsd:state-version=88:0 -->
