# SyncScope

SyncScope is an Android app that tells you which of your local files are already backed up to your cloud,
so you can safely delete them from the device. You point it at one remote repository over FTP, SFTP or
WebDAV, select local folders, and scan. Each local file comes back marked **SYNCED**, **UNSYNCED** or
**UNKNOWN**, and only files proven to be backed up are offered for deletion by default. A partial or stale
result is never shown as a clean one.

## Current status

SyncScope is in early development and is **not yet usable end to end**.

- **Available:** connecting to a remote repository over FTP, SFTP and WebDAV with a username and password.
  This is implemented in the app's native layer and proven against live test servers on Android 12
  (API 31). SFTP host keys are trusted on first use, with an explicit approve or reject step, and
  passwords are kept in the Android Keystore.
- **Not available yet:** selecting local folders, scanning, the gallery, list and tree views, filtering,
  image preview and deleting files. The app's screens are still placeholders.

What changes from one version to the next is listed in [CHANGELOG.md](./CHANGELOG.md).

## Supported protocols

| Protocol | Authentication |
| --- | --- |
| FTP | Username and password |
| SFTP | Username and password; host key trusted on first use |
| WebDAV | Username and password |

SyncScope only reads from the remote repository. It **never uploads** files, **never deletes** anything
remotely and **never downloads** remote file content. The only thing it will ever change is your local
files, and only when you ask it to delete them.

## Installing a debug APK

There is no store release yet. To try the current build, install a debug APK on a device or emulator
running Android 12 (API 31) or later:

1. Get `app-debug.apk`, either from a developer or by building it yourself (see
   [DEVELOPMENT.md](./DEVELOPMENT.md)); a local build writes it to
   `android/app/build/outputs/apk/debug/app-debug.apk`.
2. Enable USB debugging on the device and connect it, or start an emulator.
3. Install it with `adb install -r app-debug.apk`.

You can also copy the APK to the device and open it there, after allowing installs from that source.

A debug APK does not contain the app's JavaScript bundle: it loads it from a development server running on
a computer the device can reach (see [DEVELOPMENT.md](./DEVELOPMENT.md)). A standalone release APK is
planned for the v1 release.

## For developers

Setup, build, tests and the contribution workflow are in [DEVELOPMENT.md](./DEVELOPMENT.md). Technical
documentation (architecture, sync matching, protocols, scope and decisions) is in [docs/](./docs/README.md).
