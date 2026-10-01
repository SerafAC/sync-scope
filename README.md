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
- **Available:** scanning your folders against the remote repository and seeing how many files are
  **SYNCED**, **UNSYNCED** or **UNKNOWN**, on the **Scan** tab (see [Scan](#scan)). This is proven
  against live FTP, SFTP and WebDAV test servers on Android 12 (API 31) and Android 16 (API 36)
  emulators.
- **Not available yet:** setting up the remote connection from the app's screens (until then it can only
  be set up in a developer build, see [DEVELOPMENT.md](./DEVELOPMENT.md#test-only-seams)), the gallery,
  list and tree views of the results, filtering, image preview and deleting files. The **Files** tab is
  still a placeholder.

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

## Scan

The **Scan** tab checks every file in your folders against the remote repository.

- **Scan.** Tap **Scan**. While it runs, the screen shows what it is doing (connecting, listing the
  backup, checking the files on this device) and counters for the remote folders and files listed and the
  local files found and matched. A large backup can take several minutes. **Cancel scan** stops it.
- **Rescan from scratch.** Once you have a result, the button reads **Rescan from scratch**. It lists the
  remote repository again and checks every file anew. Use it whenever the backup may have changed, and
  before you delete anything.
- **When you reopen the app**, SyncScope checks your folders again by itself, so new photos show up, but
  it reuses the last listing of the remote repository instead of listing it again. Only a rescan lists it
  again.

### What the results mean

Each file gets one of three statuses:

- **SYNCED**: a file with the same name, the same size and the same modified time (as precisely as the
  server reports it) exists somewhere in the remote repository. The folder it is in does not matter.
- **UNSYNCED**: the remote repository was listed completely and no such file was found. Names must match
  exactly, letter case included; the same accented name stored in a different Unicode form still counts
  as the same name.
- **UNKNOWN**: SyncScope could not check the file. The summary counts these as **Files that could not be
  checked**. It happens when a remote folder could not be read, when the connection to the server was
  lost during the listing, when the server gave no modified time, or when the device could not read the
  file's size or date. An UNKNOWN file is never offered for deletion.

The **Scan summary** shows the number of synced and unsynced files and the files that could not be
checked. When something went wrong, it says so: how many remote folders could not be read, that the
remote listing was interrupted, or which of your folders was skipped and why (for example **Access lost**
or **Storage missing**). A scan that could not check everything is never shown as a clean one.

If the server cannot be reached at all, or rejects the login, the scan shows **Scan failed** with what to
do next, and your previous result stays on screen.

### How old the result is

The summary shows when the remote repository was last listed, for example **Remote listing from … (2 days
ago)**. A file you removed from the backup after that still shows as SYNCED until you rescan. Once the
listing is more than **7 days** old, SyncScope suggests a rescan from scratch before you delete anything.
It does not stop you.

### Leaving the app stops a scan

Scans run only while SyncScope is on screen. If you switch to another app or go to the home screen during
a scan, the scan is cancelled and its partial result is thrown away. The screen then shows **Cancelled
(app left)**, and your previous result stays. Start the scan again when you are back.

## For developers

Setup, build, tests and the contribution workflow are in [DEVELOPMENT.md](./DEVELOPMENT.md). Technical
documentation (architecture, sync matching, protocols, scope and decisions) is in [docs/](./docs/README.md).
