# Contract: Frozen Hotspots and Preserved Acceptance

**Authority**: [spec.md](../spec.md), [D012](../../../docs/decisions/0012-maestro-e2e-proof-bar.md),
`validation/maestro/config.yaml`, and `validation/maestro/staged/pairs.txt`.

## Frozen representative measurement set

The following **eight** named existing full flows are selected before optimization or timing results.
Implementation creates the single runtime manifest at `validation/performance/hotspots.json` from
this table, freezing prerequisites, fixture parameters, boundaries and the original input fingerprint.
Do not omit or substitute a workload after seeing results.

| ID | Flow under `validation/maestro/` | Required measurement subject |
| --- | --- | --- |
| H01 | `mvp/02-setup-errors.yaml` | Empty/prefilled repository fields, secure correction and editing |
| H02 | `mvp/01-setup-sftp.yaml` | Actual setup form, connection fingerprint/trust and normal navigation |
| H03 | `sources/01-add-internal.yaml` | Launch/navigation, picker cancellation and actual SAF folder grant |
| H04 | `scan/04-reopen-refresh.yaml` | Intentional stop/relaunch, navigation and foreground refresh |
| H05 | `scan/01-clean-scan-ftp.yaml` | Affirmative running progress and completed clean scan |
| H06 | `scan/05-background-discards.yaml` | Running progress, explicit cancellation and background/foreground |
| H07 | `browse/01-gallery-thousands.yaml` | 2,000 images and 15 real gallery scrolling gestures |
| H08 | `polish/03-fast-scroll.yaml` | Gallery bands and real list-scoped size-band scrolling/jumps |

H03 starts with its existing clean-state preparation and real volume fixtures. H04/H05/H06/H07/H08
retain their existing production-path setup seams and fixture prerequisites; the runner must pass
protocol, size and scroll-manifest arguments exactly as the full suite does. H01/H02 remain real-form
subjects, not debug-seam replacements.

Measure the complete flow wall time, including its existing in-flow setup. Report external precondition
cost separately and include it in total invocation accounting. H08 has gallery and list diagnostics,
but its entire mixed-view flow stays the sample; a successful subsection cannot replace a failed flow.

Each workload runs **three before and three after on each API**: 96 scheduled scenario executions,
excluding extra GPU calibration/diagnostic runs. Restore independent input state before each repetition.
Freeze default fixture sizes and resource/cache/animation settings. Candidate rendering experiments
and changed animation settings use separate identified cohorts.

## Existing workspace inventory

All names below are ordered entries in the current config, with no declared Maestro tags.
Preserve each claim on API 31 and 36. New regression flows can add proof, not subtract original flows.

| # | Existing name (append `.yaml`) | Claims that optimization must retain |
| --- | --- | --- |
| 1 | `sources/01-add-internal` | Picker cancel persists nothing; real internal grant and Available |
| 2 | `sources/02-add-removable` | Actual removable grant; same-name volume alias; missing volume fails |
| 3 | `sources/03-reject-overlap` | Nested source rejected; conflict named; no additional row |
| 4 | `sources/04-restart-persists` | Sources survive restart in original order |
| 5 | `sources/05-revoked-unavailable` | Actual OS grant release; rows remain with Access lost |
| 6 | `sources/06-regrant` | Wrong-folder rejection; same-folder availability/alias; original picker start |
| 7 | `sources/07-remove` | Cancel retains source; confirmed removal |
| 8 | `scan/01-clean-scan-ftp` | Required running progress; completion; matching/duplicates/Unicode; 4/3/0 |
| 9 | `scan/01-clean-scan-sftp` | Same clean-scan claims over SFTP |
| 10 | `scan/01-clean-scan-webdav` | Same clean-scan claims over WebDAV |
| 11 | `scan/02-partial-listing-ftp` | Partial completion; unread warning; 1/0/6 and no false Unsynced |
| 12 | `scan/02-partial-listing-sftp` | Same partial-listing claims over SFTP |
| 13 | `scan/02-partial-listing-webdav` | Same partial-listing claims over WebDAV |
| 14 | `scan/03-rescan` | Full rescan increases generation/completion time |
| 15 | `scan/04-reopen-refresh` | Actual reopen LOCAL_REFRESH; new generation; remote timestamp unchanged |
| 16 | `scan/05-background-discards` | Explicit/Home cancellation preserves completed summary/listing |
| 17 | `scan/06-unreachable-fails` | Authentication failure/recovery and previous results retained |
| 18 | `scan/07-revoked-source` | Skipped Access lost source named; no-readable-source scan disabled |
| 19 | `browse/01-gallery-thousands` | 2,000 images, 15 scrolls beyond initial page, tiles/counts |
| 20 | `browse/02-gallery-filters` | Image-only 6/3/3/0; filters and duplicate-only origin badges |
| 21 | `browse/03-gallery-issues-unknown` | Partial 6/3/0/3; Unknown in Issues, not false Unsynced |
| 22 | `browse/04-list-browse` | Nonimages in 7/3/4/0; folders/breadcrumbs; zero-match folders; shared filter |
| 23 | `mvp/01-setup-ftp` | Actual form, unencrypted warning, summary, prefilled edits/password empty |
| 24 | `mvp/01-setup-sftp` | Actual form, fingerprint, Trust/Reject controls, successful trust, no warning |
| 25 | `mvp/01-setup-webdav` | Actual form, fixture HTTPS off, unencrypted warning and connection |
| 26 | `mvp/02-setup-errors` | Wrong-password error, other fields retained/password cleared, fix, discard |
| 27 | `mvp/03-first-run` | No-seam checklist/form/DCIM picker/grant/scan/results |
| 28 | `mvp/04-select-size` | Toggle/long-press/all, exact bytes, hidden selection, view/folder/Back |
| 29 | `mvp/05-delete-synced` | Real deletion/recheck, Unknown safety, survivors, stronger Unsynced warning |
| 30 | `mvp/90-release-smoke` | No-seam setup/picker/scan/results and launcher; release qualifications below |
| 31 | `mvp/91-release-update` | Relaunch retention/single-root/rescan; release qualifications below |
| 32 | `polish/01-sort` | Six sorts/both views, defaults, independent sort/filter, folders first |
| 33 | `polish/02-sort-persists` | View/per-view sort survives restart; filter resets |
| 34 | `polish/03-fast-scroll` | Gallery date/name bands; scoped list size bands; ≥5 labels; short list no bar |
| 35 | `polish/04-remote-folders-webdav` | Multi-root form/matching/deletion, base path, remove/overlap |
| 36 | `polish/05-remote-folder-unread-ftp` | One unread root → Unknown; all unread → failure retaining results |
| 37 | `polish/06-remote-browse-sftp` | Unsaved browser/trust/navigation/field selection/credential recovery |
| 38 | `polish/07-results-updated-keeps-place` | Visible list/hidden gallery anchors restored on updated snapshot |
| 39 | `polish/08-add-large-folder` | Real 10,000-file DCIM/Big picker, hint and grant before listing ends |

Workspace execution of release-named flows uses the debug APK too. It does not prove standalone
signed installation or in-place APK update; those claims require the existing release-smoke mode.
Retain documented existing deviations from feature 007, including non-Maestro accessibility/unknown
metadata cases. Do not relabel supporting unit tests as new real-device proof.

## Seven staged parts and mandatory hooks

Paths below are relative to `validation/maestro/staged/`. Preserve each scenario's app/fixture state:

| Sequence | Parts and intervening hooks | Required proof |
| --- | --- | --- |
| Remote removed | `06-recheck-removed-a.yaml` → `remove-recheck-file.sh` → `06-recheck-removed-b.yaml` | Missing remote beach leaves backed-up group; sunset alone deleted; beach remains/rescans Unsynced |
| Server offline | `07-delete-offline-a.yaml` → pause SFTP → `07-delete-offline-b.yaml` → resume SFTP → `07-delete-offline-c.yaml` | Failure/Retry, no delete confirmation/deletion, later scan proves survivors |
| Device changed | `08-changed-a.yaml` → `change-device-files.sh` → `08-changed-b.yaml` | Same in-memory plan rejects already-gone and changed-since-scan files |

Hooks live in `scripts/validation/hooks/`; use the registry/runner as their authority. Only first parts
clear state. Do not reseed between parts. `08-changed-b` must not launch/restart the app.
Register SFTP resume before pause and restore remote recheck fixtures on all exit paths.

## Helper and progress proof additions

Focused real-form regression coverage on **both APIs** must cover empty/prefilled/secure/numeric
input, cursor start/middle/end, partial selection and remote-root strings longer than 128 characters.
Nonsecure exact values are mandatory; prove secure values with synthetic-credential authentication
and safe masked/clearing assertions where available. A missing Select all action cannot become
optional success. Keep existing helper behavior until its replacement passes the matrix.

Navigation-only helpers must not launch/reset. Callers retain required restart, seam-to-MainActivity,
grant-release and staged lifecycle transitions.

For running-state subjects, require **progress visible → expected terminal outcome → progress absent**.
For genuinely fast scans, require a new run/generation and expected terminal outcome; disappearance
alone or an optional running wait is insufficient. Existing completed results must survive cancellation
and backgrounding as before. Normal and validation builds share the same app-side progress UI.

## Requirement / scenario mapping

| Spec requirement or story | Named proof / report |
| --- | --- |
| US1.1, FR-002/003/011/012, SC-001/005 | H01–H08 × three before/after × both APIs; phase/leaf comparison and tradeoff report |
| US1.2, FR-004, SC-004 | H01/H02 and new real field matrix; deterministic helper models |
| US1.3 | H03/H04; source restart, grant-release, seam return and staged no-launch assertions |
| US1.4, FR-006 | H05/H06; three clean protocols, rescan/reopen and background/cancel assertions |
| US1.5, FR-001/007/009, SC-002 | All source, setup and deletion flows, seven staged parts, protocol audits/manifests |
| US2.1/2/3, FR-005, SC-003 | Candidate verification plus H03/H07/H08 and all workload calibration; final-input `rankingFingerprint`; `acceleration-fault-check.mjs` hardware-fallback/all-options-fail runtime cases and ownership fakes |
| US3.1 | Synthetic nested-record tests; wall-phase reconciliation and nonadditive helper report |
| US3.2, FR-008 | Separate polling/rendering profiles; conditional unit regressions and defer decisions |
| US3.3, FR-010 | Implemented DEVELOPMENT/docs/CHANGELOG instructions and measured report |

Success requires executed original claims, not merely 39 plus seven filenames or a green measurement
subset. A missing/failed/optional mandatory assertion is a failed acceptance gate.
Best-working-renderer acceptance additionally requires ranking evidence matching the final app/helper/
workload/configuration. The automated fault harness in [acceleration.md](./acceleration.md) supplies
separate fallback/exhaustion proof; its expected failure results never count as successful ordinary
validation, calibration or timing samples.
