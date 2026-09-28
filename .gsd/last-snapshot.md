# GSD context snapshot (2026-09-23T18:48:36.013Z)

## Active context
Active: M001 / S01 / T08 - androidTest proving live FTP, SFTP, and WebDAV connect against the digest-pinned containers

## Top project memories
- [MEM018] (environment) Host Docker drifted to 29.8.1 (Compose still 5.5.1) by 2026-09-21, so scripts/validation/protocol-service.sh start fails with 'Docker 29.7.2 is required.' before any container starts. The pin is also asserted by validation-infrastructure.test.mjs. Every live-container gate (validation:services:start, android-flow.sh) is blocked until the host is downgraded or the pin is deliberately bumped.
- [MEM020] (gotcha) Apache mod_dav answers OPTIONS with two DAV headers ("DAV: 1,2" and "DAV: <http://apache.org/dav/propset/fs/1>"), and OkHttp's Response.header("DAV") returns only the LAST value, which names no class. Any DAV class check must use response.headers("DAV") and flatten all values, or a perfectly good WebDAV server reads as not-WebDAV.
- [MEM021] (environment) The API 31 validator emulator must be launched with -no-window: agent/CI sessions have no DISPLAY, and without the flag Qt's xcb platform plugin fails fatally ("no Qt platform plugin could be initialized") and android-validator.sh reports only "Emulator or validator lock failed to start." QT_QPA_PLATFORM=offscreen gets further but still core-dumps. Also note android-validator.sh start aborts if /tmp/cloud-sync-checker-api31 survives an interrupted run, or if any emulator is still attached to adb.
- [MEM022] (gotcha) protocol-audit.sh must scan only vsftpd "FTP command:" lines: vsftpd answers FEAT by advertising its own capabilities, EPRT among them, on "FTP response:" lines, so an unscoped grep fails every clean run the moment a client calls FEAT. Scoping to command lines still catches a genuine RETR/PORT/EPRT command.
- [MEM017] (gotcha) GSD worktrees can lose gitignored setup between attempts: before any Gradle run, ensure node_modules exists (pnpm install --frozen-lockfile --prefer-offline, never a symlin
…[truncated]
