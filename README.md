# SyncScope

SyncScope is an Android app that tells you which of your local files are already backed up to your cloud,
so you can safely delete them from the device. You point it at one remote repository over FTP, SFTP or
WebDAV, select local folders, and scan. Each local file comes back marked **SYNCED**, **UNSYNCED** or
**UNKNOWN**, and only files proven to be backed up are offered for deletion by default. A partial or stale
result is never shown as a clean one.

## Current status

SyncScope is in early development. It is **usable end to end on your own phone**: install the APK, set up
your server, pick folders, scan, browse the results and free up space by deleting files that are backed
up. Each of these steps is proven against live FTP, SFTP and WebDAV test servers on Android 12 (API 31)
and Android 16 (API 36) emulators.

**Not available yet:** the tree view of the results, image preview, and the setting to include hidden
files. What changes from one version to the next is listed in [CHANGELOG.md](./CHANGELOG.md).

## Install the app

There is no store release. SyncScope comes as one APK file that runs on its own on a phone with
Android 12 (API 31) or later, with no computer attached.

1. Get `app-release.apk`, either from the person who builds it for you or by building it yourself (see
   [DEVELOPMENT.md › Release key](./DEVELOPMENT.md#release-key)).
2. Copy it to the phone and open it in a file manager. Android asks you to allow installs from that app
   ("Install unknown apps"); allow it for this one install. You can switch it off again afterwards.
3. Open **SyncScope**.

A later APK built with the same key installs over this one and keeps your server, your folders and your
results. **Settings › Apps › SyncScope** shows the installed version.

Developers can also install a debug APK, which needs a computer running the development server (see
[DEVELOPMENT.md](./DEVELOPMENT.md)).

## Set up your server

SyncScope compares your phone with **one** backup server. It supports three protocols:

| Protocol | Authentication | Encrypted |
| --- | --- | --- |
| SFTP | Username and password; you confirm the server's key the first time | Yes (recommended) |
| WebDAV | Username and password | With **Use HTTPS** on |
| FTP | Username and password | No |

SyncScope only reads from the server. It **never uploads** files, **never deletes** anything on the
server and **never downloads** file content from it. The only thing it ever changes is files on your
phone, and only when you ask it to delete them.

Open the **Settings** tab. The **Repository** section says **Repository not set up**. Tap **Set up
repository** and fill in:

- **Server type**: FTP, SFTP or WebDAV. For WebDAV, **Use HTTPS** is on by default.
- **Host** and **Port**. Leave the port empty to use the standard one (FTP 21, SFTP 22, WebDAV 80, or 443
  with HTTPS).
- **User name** and **Password**.
- **Remote folder**: the folder on the server that holds your backup, for example `/photos`.

Tap **Save and test**. SyncScope saves the details and connects to the server. On success the form shows
**Connected** and how many entries the remote folder holds, and the Repository section shows the server,
user, folder and **Password stored**. If something is wrong (wrong password, unreachable host, missing
folder), the form says what and what to do; what you typed stays there except the password.

- **Unencrypted connections.** With FTP, or WebDAV without HTTPS, the password and file names travel
  unencrypted, and the form warns you. Use them only on a network you trust; prefer SFTP.
- **SFTP server key check.** The first time you connect to an SFTP server, SyncScope shows the server's
  key fingerprint and asks **Trust this server?** Compare the fingerprint with the one your server
  reports, then tap **Trust**, or **Reject** to leave it untrusted. If the key of a server you trusted
  changes, SyncScope warns **Server key changed** and connects only if you tap **Trust new key** and
  confirm. An unexpected change can mean someone is intercepting the connection.
- **HTTPS certificates.** WebDAV over HTTPS works only with a certificate your phone already trusts. A
  self-signed certificate fails with "The server's certificate is not trusted by this phone."
- **Your password** is kept in the phone's secure storage, never shown again and never written to the
  log. To change other details, tap **Edit repository**; leave the password empty to keep the stored one
  (only possible while the server and user stay the same).

You cannot change the server while a scan is running. After a change, the Scan tab says your results
were made with the previous server settings; scan again.

## Pick folders

SyncScope checks only the folders you choose. Open the **Settings** tab; the **Folders** section lists the
folders you have added.

**Folders Android will not let you pick.** Since Android 11 the system picker refuses the top level of
internal storage, the `Download` folder, and the `Android/data` and `Android/obb` folders ("Cannot use
this folder"). This is an Android restriction, not a SyncScope one, and the app reminds you above **Add
folder**. Pick a folder inside internal storage instead, such as `DCIM` or `Pictures`; the picker opens in
`DCIM` for you. On an SD card you can pick the top level.

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

## Scan

The **Scan** tab checks every file in your folders against the remote repository.

On a fresh install the Scan tab shows **Before you can scan**, listing what is still missing (the server,
a folder) with a button that takes you to where you set it up. **Scan** is enabled once both are ready.
When a scan fails because something needs fixing, the message says where, with a **Go there** button.

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

## Browse your files

The **Files** tab shows the result of your last scan, file by file. Before your first scan it says that
results appear after a scan, with a **Go to Scan** button. Switch between two views at the top:

- **Gallery** shows the photos in your folders as a grid of thumbnails, newest first. Only images are
  shown here. Each photo carries its status (**Synced**, **Unsynced** or **Unknown**).
- **List** shows your folders by name. Tap a folder to open it, and keep going down into its subfolders.
  Each file shows its size, date and status. The path at the top (**All folders › Camera › 2024**) takes
  you back up: tap any part of it.

Thumbnails are made from the photos on your device. SyncScope never downloads anything from the remote
repository to show them.

### Filters

The chips under the view switch narrow what you see, in both views. Each chip shows how many files it
matches (in the gallery, how many photos):

- **All**: every file.
- **Synced**: files that are backed up. These are the ones that are safe to delete.
- **Unsynced**: files that were checked and are not in the backup.
- **Issues or unknown**: files SyncScope could not check (see [What the results mean](#what-the-results-mean)).
  These are never offered for deletion.

The filter you choose stays selected when you switch between Gallery and List, until you close the app.

### Origin badges

Photos from different folders can look the same in the gallery. When a photo's file name also appears in
another of your folders, its tile shows a small badge with the name of the folder it comes from, for
example **Camera** or **Camera (SDCARD)**. A photo whose name is used in only one folder has no badge. The
list view needs no badge, because you can see which folder you are in.

### Dimmed folders

Each folder in the list shows how many files anywhere inside it match the chosen filter, for example
**12 matching**. A folder with **0 matching** is shown dimmed rather than hidden, so your folders always
look the same. You can still open it; it then shows **No files match this filter**.

### Results updated

When a new result arrives while you are looking at the Files tab, for example after **Rescan from
scratch** or when you come back to the app, the Files tab reloads by itself and shows **Results updated**
for a moment. It keeps your view, your filter and the folder you were in. If that folder no longer exists,
you are taken to the closest folder above it that does.

## Free up space safely

Delete files from your phone that are safely on your server.

1. **Select.** On the **Files** tab, in Gallery or List, long-press a file. Tap more files to add or
   remove them; a selected file shows a check mark. Folders cannot be selected; tapping one still opens
   it. **Select all** at the top selects every file the current view shows, including ones you have not
   scrolled to: all photos under the chosen filter in Gallery, or the files of the open folder in List.
   The **✕** at the top, or the back button, ends selecting.
2. **See the size.** While you select, a bar replaces the tabs at the bottom. Its left side shows how many
   files are selected and how much space they take, for example **37 selected · 1.2 GB**, in the units
   Android's storage settings use. It also says how many have an unknown size (not counted) and how many
   are hidden by the current filter (still selected). The quickest clean-up: choose the **Synced**
   filter, **Select all**, then Delete.
3. **Server check.** Tap **Delete**. Before anything is removed, SyncScope connects to your server and
   checks that every selected backed-up file is still there, with the same name, size and date. A file
   whose server copy is gone moves to "not backed up"; a file the server could not answer for is never
   deleted. If the server cannot be reached, **nothing is deleted** and you can try again.
4. **Confirm.** **Delete from this phone?** shows how many backed-up files will be deleted and how much
   space that frees, how many files are not backed up, how many will never be deleted, how many the server
   check moved, and how old your scan is (with a suggestion to rescan if it is over 7 days old). Tap
   **Delete** to go ahead.
5. **Result.** SyncScope shows how many files were deleted and how much space was freed, and lists every
   file it did not delete with the reason (for example already gone, changed since the scan, or no
   permission to delete in this folder). Deleted files disappear from the results at once, with no new
   scan.

**What is never deleted:**

- Files whose backup state is **unknown**, whatever you choose.
- Files the server check could not confirm, and files from a scan too old to check (scan again).
- Files that **are not backed up**, unless you tick **Also delete files that are not backed up** and then
  confirm again. Those files exist only on your phone.
- Files that changed on the phone since the scan.
- **Folders.** Only files are deleted. A folder left empty stays, and shows 0 files.
- **Anything on your server.** SyncScope never changes your backup.

**Deleting is permanent.** Android has no recycle bin for it, and deleted files cannot be recovered from
the phone. While a deletion runs, a scan cannot start, and the other way round. If you change your server
settings after a scan, scan again before deleting.

## For developers

Setup, build, tests and the contribution workflow are in [DEVELOPMENT.md](./DEVELOPMENT.md). Technical
documentation (architecture, sync matching, protocols, scope and decisions) is in [docs/](./docs/README.md).
