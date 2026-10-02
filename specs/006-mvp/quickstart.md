# Quickstart: validating the MVP

How to prove feature 006 works. Commands and prerequisites are in `DEVELOPMENT.md`, which is
authoritative. This page lists what to run and what to expect.

## 1. Automated gates

```sh
pnpm lint && pnpm typecheck
pnpm test:ci                 # Jest + script-contract tests
pnpm test:android:unit       # JVM + Robolectric (migration 3 → 4, re-check, deletion, counts)
pnpm validation:services:start
pnpm e2e:android             # API 31: sources/, scan/, browse/, mvp/ (contracts/maestro-mvp.md)
scripts/validation/android-flow.sh release-smoke --api 31
pnpm validation:services:stop  # also runs the read-only protocol audit
```

Expected: everything exits 0. The protocol audit finds no forbidden operation, which proves the re-check
only listed folders (R026).

## 2. Build and install the APK on your own phone

1. Create the release key once (`DEVELOPMENT.md` › Release key) and add the four
   `SYNCSCOPE_RELEASE_*` properties to `~/.gradle/gradle.properties`.
2. Run `pnpm assemble:release`. The APK is at `android/app/build/outputs/apk/release/app-release.apk`.
   - Without the properties, the build stops with a message pointing to the Release key section
     (Story 4, scenario 4).
3. Copy the APK to the phone and install it. Allow "Install unknown apps" for the file manager when
   Android asks.
4. Disconnect the computer and open SyncScope (Story 4, scenario 1).

## 3. Manual acceptance walk-through on a real device (SC-001, SC-009)

Time it from first launch, without the computer:

1. **Scan tab.** "Before you can scan" lists "Set up the server" and "Add a folder", and Scan is disabled.
2. **Set up the server.** Choose the protocol and enter the host, user, password and backup folder, then
   tap "Save and test".
   - SFTP: compare the fingerprint with the server's (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`
     on the server), then tap Trust.
   - Expect "Connected, N entries".
3. **Add a folder.** Read the hint. The picker opens in DCIM; choose it, or `DCIM/Camera`.
4. **Scan.** The results appear in Files. Elapsed time before the scan should be under 5 minutes (SC-001).
5. **Select.** Filter Synced, open a folder in List view, and tap Select all. The bottom-left corner shows
   "N selected · X MB", and the tabs are hidden. Compare N and X with the phone's Files app (SC-006).
6. **Delete.** "Checking files on the server" runs, then the confirmation shows the counts, the size and
   the scan age. Tap Delete, and the result shows "Deleted N files, freed X MB". The folder is still
   there. Open the phone's gallery: the photos are gone. On the server, nothing changed (SC-009: under
   1 minute from step 5).
7. **Safety checks.**
   - Turn on airplane mode, select a file, and tap Delete. The app says the server must be reachable,
     and nothing is deleted.
   - Select an Unsynced file. It is excluded unless you tick the extra confirmation.
8. **Update in place.** Build again with the same key and install over the old APK. The server, folders
   and results are still there (Story 4, scenario 5).

## 4. What to look at if something fails

| Symptom | First place to look |
| --- | --- |
| WebDAV "certificate not trusted" | Self-signed certificates are not supported (research R4). Use SFTP, or a certificate from a public authority. |
| Delete refused with "previous server settings" | The repository was edited after the scan. Scan again (R15). |
| Some files "Scan again to delete these" | The scan predates schema version 4, so it has no server folders (R11). Scan again. |
| "Cannot use this folder" in the picker | Android blocks the storage root and Download. Pick a subfolder (R7). |
