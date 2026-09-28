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
- **Available:** choosing the local folders to check, on internal storage and on an SD card, in
  **Settings › Folders** (see [Select folders](#select-folders)). This is proven on Android 12 (API 31)
  and Android 16 (API 36) emulators.
- **Not available yet:** setting up the remote connection from the app's screens, scanning, the gallery,
  list and tree views, filtering, image preview and deleting files. Apart from Settings › Folders, the
  app's screens are still placeholders.

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

## Select folders

SyncScope checks only the folders you choose. Open the **Settings** tab; the **Folders** section lists the
folders you have added.

- **Add a folder.** Tap **Add folder**. Android's own folder picker opens: go to the folder, tap **Use this
  folder**, then **Allow**. The folder appears in the list with a short name, such as **Camera**. If you
  back out of the picker, nothing changes.
- **Folders on an SD card.** In the picker, open the menu of storage locations and choose the SD card, then
  pick a folder as above. When two folders share a name, the list adds where they are, for example
  **Camera** and **Camera (SDCARD)**. The names are chosen by the app and cannot be edited.
- **No folders inside other folders.** You cannot add a folder that is already in the list, is inside one
  that is, or contains one that is. SyncScope tells you which folder it overlaps, so no file is counted
  twice.
- **Access lost.** If Android takes back SyncScope's access to a folder while the app is closed, the
  folder stays in the list marked **Access lost** instead of disappearing. Tap
  **Re-grant** and pick the same folder again to restore access; the folder keeps its name. Picking a
  different folder is refused, and the folder stays marked **Access lost**.
- **Storage missing.** A folder whose SD card has been taken out, or that was deleted, is marked
  **Storage missing**. Put the card back, or re-grant or remove the folder.
- **Remove a folder.** Tap **Remove** and confirm. The folder leaves the list, its scan results are
  deleted and SyncScope gives up its access. Your files on the device are not touched. **Cancel** leaves
  everything as it was.

Your chosen folders are kept when you close and reopen the app.

**Folders Android will not let you pick.** Since Android 11 the system picker refuses the top level of
internal storage, the `Download` folder, and the `Android/data` and `Android/obb` folders. This is an
Android restriction, not a SyncScope one. Pick a folder inside internal storage instead, such as `DCIM` or
`Pictures`. On an SD card you can pick the top level.

## For developers

Setup, build, tests and the contribution workflow are in [DEVELOPMENT.md](./DEVELOPMENT.md). Technical
documentation (architecture, sync matching, protocols, scope and decisions) is in [docs/](./docs/README.md).
