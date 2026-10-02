# Contract: Browse-and-filter end-to-end flows

Follows the conventions of features 003 and 004 (`DEVELOPMENT.md` › End-to-end flows, which is
authoritative). The flows live in `validation/maestro/browse/`. They reuse `subflows/configure-repository.yaml`
(the D018 seam), `subflows/add-scan-source.yaml` and `subflows/start-scan.yaml`, and add
`subflows/open-files.yaml`.

Browsing reads the local snapshot only, so the flows are protocol-agnostic and run against SFTP (as 004's
non-protocol flows do). The three protocols are already covered by 004's clean and partial flows.

## Fixtures (research R13)

| Device source | Contents | Status against remote root `gallery` |
| --- | --- | --- |
| `SyncScopeE2E/Gallery` | `sunset.png`, `beach.png`, `album/forest.png` | SYNCED |
| | `harbor.png`, `album/notes.txt`, `drafts/draft.png` | UNSYNCED |
| `SyncScopeE2E/GalleryTwin` | `sunset.png` (a different size from the remote copy) | UNSYNCED, name twin |
| `SyncScopeE2E/GalleryBulk` | `g0000.png` … `g1999.png` | UNSYNCED |

Remote root `gallery-partial` is `gallery` plus a `restricted/` directory (`0700`, host-owned, as in 004's
`scan/partial`). Against it, every file that does not match becomes UNKNOWN.

Expected chip counts (`All / Synced / Unsynced / Issues`) with sources Gallery + GalleryTwin:

| Remote root | Gallery view (images only) | List view (all files) |
| --- | --- | --- |
| `gallery` | 6 / 3 / 3 / 0 | 7 / 3 / 4 / 0 |
| `gallery-partial` | 6 / 3 / 0 / 3 | 7 / 3 / 0 / 4 |

## Selectors

Every control has an accessibility label, and that label is its Maestro selector (FR-004, SC-003).

| Element | Label |
| --- | --- |
| View switch | `Gallery view`, `List view` |
| Filter chips | `Filter All, <n>`, `Filter Synced, <n>`, `Filter Unsynced, <n>`, `Filter Issues or unknown, <n>` |
| Gallery tile | `<name>, <Synced \| Unsynced \| Unknown>`; with a badge: `<name>, <status>, from <alias>` |
| Origin badge | `Origin <alias>` |
| List: source row | `Folder <alias>, <n> matching` |
| List: directory row | `Folder <name>, <n> matching`; dimmed rows add `, no matches` |
| List: file row | `<name>, <status>` |
| Breadcrumb | `Breadcrumb All folders`, `Breadcrumb <alias>`, `Breadcrumb <name>` |
| Empty states | `No files match this filter`, `No scan results yet` |
| Loading / error | `Loading files` (first-page indicator), `Retry` (error state button) |
| Snackbar | `Results updated` |

## Acceptance scenario mapping

Each flow starts from `clearState`, configures SFTP through the seam with the remote root named below, adds
the listed sources, runs a scan, and opens the Files tab. Each flow is added to
`validation/maestro/config.yaml` by the task that creates it, never before the file exists.

| Spec item | Flow | Remote root, sources | Asserts |
| --- | --- | --- | --- |
| Scenario 1; FR-001 (virtualized, paged) | `01-gallery-thousands.yaml` | `gallery`; GalleryBulk | `Filter All, 2000`; tiles render; after 15 scroll gestures, a `g\d{4}\.png, Unsynced` tile is still visible (pages kept loading) |
| Scenario 2; FR-003; SC-002 | `02-gallery-filters.yaml` | `gallery`; Gallery, GalleryTwin | Chip counts 6 / 3 / 3 / 0. `Synced` shows `beach.png`, `forest.png`, `sunset.png` and no `harbor.png`. `Unsynced` shows `harbor.png`, `draft.png` and the twin `sunset.png`. `Issues` shows `No files match this filter` |
| Scenario 2; FR-003; SC-002 (unknown set) | `03-gallery-issues-unknown.yaml` | `gallery-partial`; Gallery, GalleryTwin | Chip counts 6 / 3 / 0 / 3; `Issues` shows `harbor.png`, `draft.png`, `sunset.png, Unknown, from GalleryTwin` |
| Scenario 3; FR-001; clarification 1 | `02-gallery-filters.yaml` | as above | Under `All`: `Origin Gallery` and `Origin GalleryTwin` are visible on the two `sunset.png` tiles; `beach.png, Synced` has no `from` suffix |
| Scenario 4; FR-002; clarification 3 | `04-list-browse.yaml` | `gallery`; Gallery, GalleryTwin | `List view` → `Folder Gallery, 6 matching` → `Folder album, 2 matching` → `forest.png, Synced`; `Breadcrumb Gallery` returns; `Breadcrumb All folders` returns to sources. Under `Synced`: `Folder drafts, 0 matching, no matches` is visible and opens to `No files match this filter`. Back on `Gallery view`, the `Synced` chip is still selected (FR-003) |
| FR-005; clarification 4 | `05-results-updated.yaml` | `gallery`; Gallery | In list view inside `album`, go to Scan → `Rescan from scratch` → wait for the summary → back to Files: `Results updated` is shown, and `Breadcrumb album` and `forest.png, Synced` are still visible |
| Scenario 5; FR-004; SC-003 | all flows | — | Every tap above uses an accessibility label; no flow taps by text or by coordinates |

Bucket edges, the descendant-count invariant, the duplicate probe, counts scoping, relocation-by-name and
the stale-response guard are proven by JVM and Jest tests. A Maestro flow cannot set those up
deterministically.
