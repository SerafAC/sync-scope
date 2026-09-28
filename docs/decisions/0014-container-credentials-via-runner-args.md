# D014: How do randomly generated, host-side container credentials reach an androidTest on the emulator?

- **Status**: Accepted
- **Date / context**: Planning M001/S01; research flagged this as an unresolved design point that must be
  assigned explicitly rather than left to an executor.
- **Scope**: architecture
- **Made by**: agent
- **Revisable**: Yes. An `adb push` of a credential file into the app's test storage would also work, but
  that leaves the secret on the device filesystem after the run.

## Context

`protocol-service.sh` regenerates a random username and password per service start into
`/tmp/cloud-sync-checker-syncscope-<proto>/credentials`, so the values cannot be committed.
`android-flow.sh` exports those paths into the Gradle environment, but instrumentation runs on-device and
cannot open a host filesystem path.

## Decision

`android/app/build.gradle` reads the `SYNCSCOPE_{SFTP,WEBDAV,FTP}_CREDENTIAL_FILE` paths from the Gradle
environment at configuration time and forwards the parsed username and password into
`android.defaultConfig.testInstrumentationRunnerArguments`. The androidTest reads them via
`InstrumentationRegistry.getArguments()`. Host addresses are `10.0.2.2` with the compose ports, never
`127.0.0.1`.

## Rationale

Runner arguments are the standard AGP channel for host-to-device test parameters and keep the secret out of
the repository and out of the APK. The emulator reaches host loopback only through `10.0.2.2`, and
`vsftpd.conf` already sets `pasv_address=10.0.2.2`.

## Alternatives rejected

- `adb push` of a credential file into the app's test storage — works, but leaves the secret on the device
  filesystem after the run.

## Related

- Requirements: R001, R020
- Features: specs/002-native-cloudsync-connect
