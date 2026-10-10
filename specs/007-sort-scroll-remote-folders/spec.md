# Feature Specification: Sorting, Fast Scrolling, Several Server Folders and an App Icon

**Feature Branch**: `007-sort-scroll-remote-folders`

**Created**: 2026-10-05

**Status**: Planned (clarified, plan and tasks written)

**Input**: User description: "Please add another spec, before all unfinished (starting and including 007).
Features: Sort by drop-down, by size, date, name, both asc and desc. Drop-down should be on the left side
of gallery/list view. View mode should be a drop-down as well. Then there will be two drop-downs next to
each other. Smart scrollbar that will show date ranges mm.yyyy, letters a..z, sizes 1mb, 2mb, 5mb, 10mb
(values are examples choose reasonable buckets). When adding repository, allow to select multiple folders
that will be scanned. Settings "Folders" should be named "Device folders". Bugs: Scan refresh "Results
updated" when browsing images is resetting the view, it jumps to the top. Browsing a folder to add, when
opening folder with lots of files it shows nothing even when changing navigation."

The former features 007 (tree view and preview), 008 (multi-select, merged into 006) and 009 (full loop
and release) were shifted when this feature was inserted. With the E2E performance draft inserted at
008 on 2026-10-10, their current slots are [009](../009-tree-view-image-preview/spec.md),
[010](../010-multiselect-local-deletion/spec.md) and [011](../011-full-loop-release/spec.md).

**Depends on**: [005-gallery-list-filtering](../005-gallery-list-filtering/spec.md) and
[006-mvp](../006-mvp/spec.md) (both complete).

## Context

The MVP (feature 006) runs on the owner's phone. Using it on a real photo library showed what gets in the
way next:

- Gallery is always newest first and list always by name. There is no way to find the biggest files,
  which are the ones worth deleting first.
- With thousands of photos, the only way through the results is flinging; there is no way to jump to a
  month, a letter or a size.
- The repository has exactly one remote folder. A user whose backups live in several folders on the
  same server (for example `/photos` and `/phone-backup`) cannot check against all of them.
- Two bugs: a rescan or app-open refresh that publishes new results throws the user back to the top of
  the view, and the Android folder picker shows an empty folder when the folder holds many files, so such
  a folder cannot be reached or added.
- "Folders" in Settings does not say which folders it means, now that the repository has folders too.

## Scope

**In scope**: a sort drop-down and a view-mode drop-down side by side above gallery and list view; sort
by name, date and size in both directions; a scrollbar whose thumb shows where the user is in the active
sort (a date or size band fitted to the files shown, or a letter) and jumps there when dragged; several remote
folders, each typed or picked with a server folder browser, in one
repository; renaming Settings › Folders to Settings › Device folders; keeping the scroll position when
new results arrive; adding device folders that hold many files; the app's own launcher icon.

**Out of scope** (unchanged owners):

- Tree view and image preview, including tree view as a third option in the view drop-down —
  [009-tree-view-image-preview](../009-tree-view-image-preview/spec.md).
- Hidden files, snapshot retention, the API 36 full loop and the final docs pass —
  [011-full-loop-release](../011-full-loop-release/spec.md).
- Mapping a device folder to a particular remote folder, and more than one server (R024 stays out of
  scope: every device file is still compared against every remote folder of the one server).
- Remembering the filter across app restarts (feature 005 R10 stands; sort and view mode are remembered).

## Clarifications

### Session 2026-10-05

- Q: "When adding repository, allow to select multiple folders": server folders or device folders? → A:
  Server folders. The repository gets several remote folders; device folders are unchanged.
- Q: "Browsing a folder to add … shows nothing": is this the Android system folder picker opened by
  Settings › Device folders › Add a folder? → A: Yes, the Android picker.
- Scope extension (user decision): "add an application icon. I will provide a hires image, when it is
  needed, you will prepare all formats needed and place them where needed" → User Story 7, FR-018.
- Change (user decision): "for scroll size bands make them dynamic, so values will be dependent on the
  content and not squeeze everything into one bucket if all files e.g. 3-5mb" → User Story 2 scenario 5,
  FR-007a, SC-008.
- Q: How should the user choose each server folder: by typing its path, or by browsing the server's
  folders? → A: Both: a typed path field plus a "Browse" button that opens a server folder browser.
- Q: When one of several server folders cannot be read during a scan, should the whole scan fail or
  finish with an honest partial result? → A: Finish. Files matched in a readable folder are backed up;
  every other file is "unknown" with a reason naming the unread folder, and the result shows a warning.
- Q: Should the date labels on the scrollbar adapt to the files shown, as size bands do, instead of
  always being months? → A: Yes. Years (`YYYY`), months (`MM.YYYY`) or days (`DD.MM.YYYY`), picked from
  the span of the files shown: the coarsest unit that gives at least 5 bands where the dates allow.
- Q: If the empty-folder problem is in Android's own folder picker and the app cannot avoid it, what
  should the app offer? → A: Keep it simple. Where possible, show a loading indicator while a folder
  loads and, when the user goes back, cancel loading the folder they left. Where that is not possible,
  show a hint instead. No complex solution such as an in-app device folder browser.
- Q: Should the chosen sort and view mode be remembered when the app is closed and reopened? → A: Yes,
  each view's sort and the last view mode are remembered across restarts; the filter still resets.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sort the results (Priority: P1)

Above gallery and list view, a "Sort" drop-down sits on the left and the view-mode drop-down (Gallery,
List) right next to it. The user picks name, date or size, ascending or descending, and the view reorders.

**Why this priority**: the biggest files are the ones worth deleting first, and today they cannot be
found.

**Independent Test**: a Maestro flow on the test fixtures picks each of the six sorts in gallery and list
view and checks the first rows against the fixtures' known order.

**Acceptance Scenarios**:

1. **Given** the Files tab, **When** it is shown, **Then** the sort drop-down is on the left and the
   view-mode drop-down is next to it, each showing its current choice, and the filter chips sit below
   them.
2. **Given** the sort drop-down is open, **When** the user looks at it, **Then** it offers Name (A–Z),
   Name (Z–A), Date (newest first), Date (oldest first), Size (largest first) and Size (smallest first),
   with the current one marked.
3. **Given** gallery view, **When** the user picks "Size (largest first)", **Then** the largest image is
   first and each following tile is the same size or smaller.
4. **Given** list view inside a folder, **When** the user picks a sort, **Then** that folder's files
   reorder; subfolders stay above the files, sorted by name, whatever the sort.
5. **Given** a sort and a filter, **When** the user changes either, **Then** the other is kept.
6. **Given** a sort in gallery view, **When** the user switches to list view and back, **Then** each view
   still shows the sort it had; on first run gallery starts as "Date (newest first)" and list as "Name
   (A–Z)", as today.
7. **Given** a chosen sort and view mode, **When** the app is closed and reopened, **Then** the Files tab
   opens in the same view mode with each view's sort as left, and the filter back at All.
8. **Given** the view-mode drop-down, **When** the user picks the other view, **Then** the view switches
   exactly as the old switch did, keeping each view's folder and scroll position.
9. **Given** files of unknown size or date, **When** the user sorts by that attribute, **Then** they come
   last in both directions.

---

### User Story 2 - Jump through long results with a smart scrollbar (Priority: P2)

While the user scrolls a long gallery or list, a scrollbar appears on the right edge. Its thumb carries a
label for where the user is in the current sort: a year, month or day (`10.2026`) when sorted by date, a
letter when
sorted by name, a size band when sorted by size. Dragging the thumb shows the label for the position
under the finger and, on release, the view is at the first file of that band.

**Why this priority**: it turns a library of thousands of photos from minutes of flinging into one drag,
but the app is usable without it.

**Independent Test**: on a fixture of several thousand files spread over many months, letters and sizes,
drag the thumb to a label and check that the first visible file belongs to that band, in each sort.

**Acceptance Scenarios**:

1. **Given** a view longer than three screens (viewport heights), **When** the user scrolls, **Then** a
   scrollbar with a draggable thumb appears on the right edge and fades out about 1.5 seconds after
   scrolling stops; shorter views show none.
2. **Given** the date sort, **When** the user drags the thumb, **Then** the label shows the date band of
   the position. The band size follows the files shown: years (`2024`) for files spread over many years,
   months (`10.2026`) in the usual case, and days (`14.10.2026`) when the files cover only a few weeks,
   so they spread over several bands instead of one.
3. **Given** the name sort, **When** the user drags the thumb, **Then** the label shows the first letter
   (A–Z, with `#` for names starting with a digit or symbol, and accented letters under their base
   letter).
4. **Given** the size sort, **When** the user drags the thumb, **Then** the label shows the size band of
   the position, for example `5 MB`, meaning the band from that size up to the next band's.
5. **Given** the size sort, **When** the bands are worked out, **Then** they follow the sizes of the
   files actually shown, not a fixed list: a library from 50 KB to 2 GB gets wide steps (`100 KB`,
   `1 MB`, `10 MB`, `100 MB`, `1 GB`), and a library where every file is 3–5 MB gets narrow ones (`3 MB`,
   `3.2 MB`, `3.4 MB` … `4.8 MB`), so the files spread over several bands instead of one.
6. **Given** the thumb released on a band whose files are not loaded yet, **When** the view settles,
   **Then** it shows the first file of that band, with a brief loading state rather than an empty screen.
7. **Given** the scrollbar, **When** the user drags it with TalkBack on or uses accessibility actions,
   **Then** the current band is announced and the band can be changed to the previous or next one.
8. **Given** a filter or a different list folder, **When** the scrollbar is shown, **Then** its positions
   and labels, including the size bands, reflect only the files shown there.

---

### User Story 3 - Check against several server folders (Priority: P1)

In Settings › Repository, the remote folder becomes a list. The user adds as many server folders as their
backups are spread across, and a scan checks every device file against all of them.

**Why this priority**: with backups in more than one folder, every file outside the single remote folder
shows as not backed up, which hides exactly the files that are safe to delete.

**Independent Test**: with the live test containers holding backups in two folders, set up a repository
with both, scan, and see files from each folder reported as backed up; remove one folder and rescan, and
see its files reported as not backed up.

**Acceptance Scenarios**:

1. **Given** the repository form, **When** the user opens it, **Then** it shows one remote folder field
   and an "Add another folder" action; each added folder has its own field and a remove action, and at
   least one folder is always required.
2. **Given** two or more remote folders, **When** the user saves, **Then** the connection test checks
   each folder and the result names any folder that is missing or unreadable, with the entry count of
   each that worked.
3. **Given** a folder that is the same as, inside or around another folder in the list, **When** the user
   saves, **Then** the form refuses it and names the folder it overlaps, as device folders already do.
4. **Given** a saved repository with several folders, **When** a scan runs, **Then** each device file is
   reported as backed up when a matching file exists in any of the folders (same rules as today, D003).
5. **Given** one of several folders cannot be read during a scan, **When** the scan finishes, **Then**
   the result becomes active with a warning naming that folder; files matched in a readable folder are
   backed up, and every other file is "unknown" (never deletable) with a reason naming the unread
   folder, never "not backed up".
6. **Given** none of the folders can be read, **When** the scan runs, **Then** it fails as a whole, as it
   does today for the single remote folder, and the current results stay.
7. **Given** a repository saved before this feature, **When** the app is updated, **Then** its one remote
   folder is shown as the only entry of the list and scans behave exactly as before.
8. **Given** a server URL with a path typed into Host (feature 006), **When** the address is split up,
   **Then** the path fills the first remote folder and leaves the others alone.
9. **Given** several remote folders, **When** a deletion is prepared, **Then** the server re-check (D020)
   finds a file's copy in whichever folder it was matched in.
10. **Given** the Repository section in Settings, **When** the repository has several folders, **Then** it
   lists all of them.
11. **Given** a remote folder field, **When** the user taps its "Browse" button, **Then** a server folder
    browser opens at that field's path (or the server's top folder when the field is empty or the path
    does not exist), shows only folders, lets the user go into a folder and back up with a breadcrumb,
    and "Use this folder" fills the field with the current path.
12. **Given** the server cannot be reached, the login fails or an SFTP key is not yet trusted, **When** the
    user taps "Browse", **Then** the browser shows the same cause and next step as the connection test,
    and the typed path stays usable.

---

### User Story 4 - Stay in place when results update (Priority: P1)

The user is scrolled deep into the gallery or a list folder when a rescan or the refresh on app open
publishes new results. The "Results updated" notice appears and the view stays where it was.

**Why this priority**: losing one's place in thousands of photos every time results refresh makes the
app tiring to use; this is a bug found on the device.

**Independent Test**: scroll a long gallery and a long list folder down, publish a new snapshot, and check
that the same files are still on screen and the notice shows.

**Acceptance Scenarios**:

1. **Given** the user has scrolled down in gallery or list view, **When** new results replace the
   current ones, **Then** the "Results updated" notice appears and the first file that was visible stays
   at the top of the screen.
2. **Given** that file is not in the new results, **When** the view reloads, **Then** it stays at the
   position where that file would be in the current sort, not at the top.
3. **Given** the user is in a list folder, **When** new results arrive, **Then** the view stays in the
   same folder (as today) and at the same position in it.
4. **Given** the view that is not on screen, **When** new results arrive, **Then** it also keeps its
   position for when the user switches back.

---

### User Story 5 - Add a device folder that holds many files (Priority: P1)

The user goes to Settings › Device folders › Add a folder and navigates into a folder with thousands of
files, such as `DCIM/Camera`. The picker shows the folder and lets the user add it.

**Why this priority**: the camera folder is the main thing the app exists to check, and on the owner's
phone it cannot be added; this is a bug found on the device.

**Independent Test**: on a device or emulator with a folder of at least 10,000 files, add that folder
through the app, and see it listed as available and scanned.

**Acceptance Scenarios**:

1. **Given** a device folder holding at least 10,000 files, **When** the user opens it in the picker
   started from Add a folder, **Then** the folder's contents or at least the button to use the folder
   appear, and the user can add it.
2. **Given** the picker is showing that folder, **When** the user navigates to other folders and back,
   **Then** each folder shows its contents rather than an empty screen.
3. **Given** a large folder is still loading, **When** the user waits, **Then** a loading indicator shows
   instead of an empty screen, where the app can make that happen.
4. **Given** a large folder is still loading, **When** the user goes back, **Then** loading that folder is
   cancelled and the folder the user returned to shows promptly, where the app can make that happen.
5. **Given** neither a fix nor scenarios 3 and 4 are within the app's control, **When** the user taps Add
   a folder, **Then** a hint before the picker opens says to select a large folder from its parent folder
   without opening it.

---

### User Story 6 - "Device folders" in Settings (Priority: P3)

Settings shows "Repository" and "Device folders". Every message that sends the user to the folder list
uses the new name.

**Why this priority**: a wording fix; with server folders now in the repository, "Folders" is ambiguous.

**Independent Test**: unit tests and the a11y sweep find no user-visible "Settings › Folders" or "Folders"
section header.

**Acceptance Scenarios**:

1. **Given** Settings, **When** it opens, **Then** its sections are headed "Repository" and "Device
   folders".
2. **Given** any guidance that points to the folder list (setup checklist, scan errors, empty states),
   **When** it is shown, **Then** it says "Settings › Device folders".

---

### User Story 7 - The app has its own icon (Priority: P2)

The launcher, the recent-apps screen and Android's app settings show SyncScope's own icon instead of the
default React Native one. The owner supplies one high-resolution source image when this story is built;
every size and shape Android needs is produced from it and placed in the app.

**Why this priority**: the app now lives on the owner's phone next to other apps and has to be
recognisable; it changes nothing about what the app does.

**Independent Test**: install the release APK and look at the launcher, the app drawer, recent apps and
Settings › Apps on API 31, with the launcher set to circle, squircle and square icon shapes.

**Acceptance Scenarios**:

1. **Given** the installed app, **When** the user looks at the launcher and app drawer, **Then** the
   SyncScope icon is shown, sharp at the device's density.
2. **Given** a launcher that masks icons to a circle, squircle or square, or animates them, **When** the
   icon is shown, **Then** nothing important is cut off and no white square shows behind it (an adaptive
   icon with its own foreground and background).
3. **Given** a launcher with themed (monochrome) icons turned on, **When** the icon is shown, **Then** a
   single-colour version of the icon is used.
4. **Given** an older launcher without adaptive icons, **When** the icon is shown, **Then** a square and a
   round version at every density are used.
5. **Given** the source image, **When** the icon is built, **Then** a 512 × 512 store-style image is also
   produced and kept with the sources, ready for any later listing.

---

### Edge Cases

- **Equal sort keys**: files with the same name, date or size keep a stable order (by name, then by path)
  so paging never repeats or skips a file.
- **Sort and selection**: changing the sort keeps the selection, as a view or filter change does.
- **Sort and "select all"**: select all still selects every file of the current filter and folder,
  whatever is loaded and whatever the sort.
- **Date of a file**: the date is the file's last-modified time on the device, the same one used for
  matching; the gallery's current "newest first" is that same order.
- **Date bands for unusual sets**: all files on one day give one band; files spread over decades give
  year bands even if some years are empty (empty years are skipped, as all empty bands are).
- **Size bands for unusual sets**: when all files have the same size there is one band; when a few huge
  files sit far above the rest, they get a band of their own at the top rather than stretching every
  band. Band labels are always round values (steps of 1, 2 or 5 at a suitable scale, or finer steps such
  as 0.2 when the range is narrow) and never repeat.
- **Empty bands**: bands with no files are not shown and cannot be landed on.
- **Unknown values on the scrollbar**: files with an unknown date or size (Story 1 sc. 9) form one last
  band labelled "Unknown" in that sort.
- **Name order right after the update**: results scanned before this feature keep their old name order
  for accented initials (for example `É` under `#`) until the first refresh or scan after the update,
  which recomputes every row; the app-open refresh normally does this on the first launch.
- **Scrollbar during paging**: the thumb's position reflects the whole result, not only the loaded pages.
- **New results while dragging**: the drag ends, the notice shows, and the view keeps the position the
  drag reached.
- **Remote folder written with or without a trailing slash, or twice**: treated as the same folder and
  refused as a duplicate.
- **Removing the last remote folder**: not possible; the remove action is hidden on the only folder.
- **Removing a remote folder**: takes effect at the next scan; the current results are unchanged until
  then, and the freshness notice already tells the user when results are old.
- **Unread folder and deletion**: files that became "unknown" because a folder was not read are never
  deletable (D006); backed-up files from the readable folders are deletable after the usual re-check
  (D020). The warning stays on the result until a scan reads every folder.
- **A folder unreadable in the middle of its listing**: treated like an unread folder, so no file is
  called "not backed up" on the strength of a half-read listing.
- **SFTP host key**: asked once per server, not per folder, and also before the folder browser lists
  anything.
- **Browsing with unsaved details**: the browser connects with the details currently in the form,
  including a password typed but not yet saved, and saves nothing.
- **Browsing a large server folder**: folders appear as they are listed; a folder with thousands of
  files still shows its subfolders, and the browser never downloads file content (R026).
- **Picking an overlapping folder in the browser**: the browser lets the user pick it; the form then
  refuses it on save, naming the folder it overlaps, as for a typed path.
- **Picker on a removable card**: the many-files fix (or the hint) applies to every volume the picker
  offers; the R15 spike checks a second volume when the emulator offers one.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Gallery and list view MUST show, above the filter chips, a sort drop-down on the left and a
  view-mode drop-down immediately to its right, replacing the current gallery / list switch.
- **FR-002**: The sort drop-down MUST offer name, date (last modified) and size, each ascending and
  descending, and MUST show the current choice.
- **FR-003**: Each view MUST keep its own sort, and the app MUST remember each view's sort and the last
  view mode across app restarts, starting on first run at date newest first for gallery
  and name A–Z for list; sort, filter, view, folder and selection MUST be independent of each other.
- **FR-004**: In list view, subfolders MUST stay above files, ordered by name, under every sort.
- **FR-005**: Every sort MUST be total and stable (ties broken by name, then path), and files with an
  unknown value for the sort key MUST come last in both directions.
- **FR-006**: Gallery and list view MUST show a scrollbar on the right edge when the result is longer than
  three screens (viewport heights), with a draggable thumb that jumps to the matching position of the whole result,
  including rows not loaded yet.
- **FR-007**: While dragging, the thumb MUST show the band of the position under it: a date band for the
  date sort, a letter A–Z or `#` for the name sort, and a size band for the size sort. Only bands that
  contain files under the current filter are reachable. Files with an unknown value for the sort key form
  one last band labelled "Unknown".
- **FR-007a**: Size bands MUST be derived from the sizes of the files being shown (current view, folder
  and filter), with round boundaries. They MUST spread the files so that, whenever the files have at least
  8 distinct sizes, there are between 5 and 15 bands and no band holds more than half of the files unless
  more than half the files share one size.
- **FR-007b**: Date bands MUST be whole years (`YYYY`), months (`MM.YYYY`) or days (`DD.MM.YYYY`), one
  unit for the whole scrollbar, chosen from the dates of the files being shown (current view, folder and
  filter): the coarsest unit that gives at least 5 non-empty bands, or days when no unit does. Only one
  label shows at a time, so a finer unit with many bands (for example 36 months) is acceptable.
- **FR-008**: The scrollbar MUST be usable with TalkBack: it announces the current band and offers
  previous / next band actions.
- **FR-009**: The repository MUST hold one or more remote folders. The form MUST let the user add and
  remove folders, MUST require at least one, and MUST refuse a folder that is the same as, inside or
  around another one, naming that folder.
- **FR-009a**: Each remote folder field MUST offer a "Browse" action that opens a folder-only browser of
  the server, using the details in the form (saved or not), with descend, a breadcrumb back up, and "Use
  this folder" to fill the field. Connection, login and host-key problems MUST be shown as the connection
  test shows them. Browsing MUST only list folders and never read or change file content.
- **FR-010**: Saving the repository MUST test every remote folder and report each folder's outcome (entry
  count, or what is wrong and what to do).
- **FR-011**: A scan MUST list every remote folder and match each device file against all of them with
  the existing matching rules (D003, D019). If some but not all remote folders cannot be read, the scan
  MUST still complete: files matched in a readable folder are backed up, every other file MUST be
  "unknown" with a reason naming the unread folder (never "not backed up"), and the result MUST carry a
  warning naming it. If no remote folder can be read, the scan MUST fail and the current result stays.
- **FR-012**: The pre-delete server re-check (D020) MUST work with several remote folders.
- **FR-013**: A repository saved before this feature MUST keep working unchanged, with its remote folder
  as the only entry.
- **FR-014**: When new results replace the current ones, gallery and list view MUST keep the first
  visible file at the top, or the position where it would be in the current sort when it is gone, and
  MUST still show the "Results updated" notice. This applies to the hidden view too.
- **FR-015**: The user MUST be able to add a device folder holding at least 10,000 files through Add a
  folder. Where the app can influence it, the picker MUST show a loading indicator rather than an empty
  screen while a folder loads, and going back MUST cancel loading the folder left behind. Where the
  app cannot, it MUST show a hint before the picker opens: select a large folder from its parent without
  opening it. The fix MUST stay simple: no in-app device folder browser and no replacement for Android's
  picker.
- **FR-016**: The Settings section for local folders MUST be named "Device folders", and every
  user-visible reference to it MUST use that name.
- **FR-017**: Every new control MUST have an accessibility label following the project's convention, and
  the sort and view drop-downs MUST announce their current choice.
- **FR-018**: The app MUST have its own launcher icon, built from one owner-supplied high-resolution
  image: an adaptive icon (foreground, background and monochrome layers) and square and round icons at
  every Android density, replacing the default icons, plus a 512 × 512 image kept with the sources.

### Key Entities

- **Sort**: one of six choices (name, date, size × ascending, descending), held per view and remembered across
  restarts, together with the last view mode.
  Applies to the files of the current view, folder and filter.
- **Scroll band**: a labelled range of the current sort (a date band, a letter or a size band) with the
  position of its first file in the current result. Derived from the snapshot, never stored. Size bands
  are worked out from the shown files each time the result, filter or folder changes.
- **App icon**: the owner's source image and the icon set produced from it.
- **Repository** (changed): the one server, now with a list of one or more remote folders instead of
  exactly one. Everything else is unchanged.
- **Remote folder**: a path on the server whose files take part in matching, typed or picked with the
  server folder browser. Folders in one repository never overlap.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For each of the six sorts, the order shown in gallery and list view equals the fixtures'
  expected order, proven by tests and a Maestro flow on API 31 and API 36.
- **SC-002**: The largest file of a scan can be reached in two taps from the Files tab.
- **SC-003**: On a result of at least 5,000 files, dragging the scrollbar to any band shows that band's
  first file within 1 second on the API 31 emulator.
- **SC-004**: With backups split across two remote folders on the live test containers, every fixture
  file present in either folder is reported as backed up, and none from a removed folder is.
- **SC-004a**: With one of two remote folders made unreadable on the live test containers, the scan
  completes, zero files are reported as not backed up, and the warning names the unread folder.
- **SC-005**: After new results arrive, the file that was first on screen is still first on screen in
  100% of the test runs where it exists in both results.
- **SC-006**: A folder of 10,000 files can be added as a device folder on the API 31 emulator.
- **SC-007**: Zero user-visible strings say "Settings › Folders" or head a section "Folders".
- **SC-008**: On a fixture where every file is 3–5 MB, the size sort offers at least 5 bands, and on the
  standard fixtures no band holds more than half of the files. On a fixture whose files span three weeks,
  the date sort shows day bands; on one spanning ten years, year bands.
- **SC-009**: No default React Native icon remains in the app; the installed APK shows the SyncScope icon
  in the launcher, recent apps and app settings on API 31.

## Assumptions

- Dates are local last-modified times, banded in the device's time zone; the label formats follow the
  `MM.YYYY` style the user asked for.
- Size bands are dynamic (user decision, 2026-10-05). The exact method (for example quantiles of the
  sizes snapped to round values) is chosen in planning, within FR-007a.
- The owner provides the icon's source image when User Story 7 is built: ideally a square image of at
  least 1024 × 1024 px, with a transparent background or a separate background colour. Until then the
  story waits; the rest of the feature does not depend on it.
- The empty-picker bug is assumed to come from how the app opens the Android picker (its starting folder
  or flags) or from the picker's own handling of very large folders. The picker's screen belongs to
  Android, so a loading indicator and cancel-on-back may only be possible if the cause is on the app's
  side; planning finds the cause first and otherwise falls back to the hint (FR-015).
- Remote folders are typed as paths or picked with the server folder browser (clarification
  2026-10-05); both fill the same field.
- Several remote folders change the v1 scope statement "one remote root for all selected folders"
  (`docs/scope.md`, overview glossary); those docs are updated with this feature. R024 (several servers,
  per-folder mapping) stays out of scope.
- The end-to-end flows of this feature pass on API 31 and API 36 emulators, as the 006 flows do
  (`pnpm e2e:android`, D012). The API 36 *full loop* (setup, scan and delete in one flow) stays in
  feature 011.

## Provides

To [009-tree-view-image-preview](../009-tree-view-image-preview/spec.md):

- The view-mode drop-down, where tree view becomes the third choice.
- The sort drop-down and sort contract, which tree view applies to the files inside each folder.
- The scroll-position keeping on new results, which tree view follows.

To [011-full-loop-release](../011-full-loop-release/spec.md):

- A repository with several remote folders for the full-loop flow to set up through the UI.
- The many-files folder fixture and the Maestro flows for sorting and the scrollbar.
