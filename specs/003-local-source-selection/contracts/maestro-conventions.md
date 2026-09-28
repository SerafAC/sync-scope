# Contract: Maestro flow conventions (first established here)

This feature creates `validation/maestro/`. Later features' flows follow these rules (R020,
[D012](../../../docs/decisions/0012-maestro-e2e-proof-bar.md)). Once it exists, the durable copy lives in
`DEVELOPMENT.md` (end-to-end section), and this page is the design record.

## Layout

```text
validation/maestro/
├── config.yaml                 # executionOrder.flowsOrder + continueOnFailure: false
├── subflows/                   # reusable steps, never run on their own
│   ├── pick-folder.yaml        # drives DocumentsUI; params VOLUME, PATH
│   └── open-sources.yaml       # launches the app and opens Settings > Folders
└── sources/                    # one directory per feature area
    ├── 01-add-internal.yaml
    ├── 02-add-removable.yaml
    ├── 03-reject-overlap.yaml
    ├── 04-restart-persists.yaml
    ├── 05-revoked-unavailable.yaml
    ├── 06-regrant.yaml
    └── 07-remove.yaml
```

Flow file names are `NN-<verb>-<object>.yaml`. `NN` is the order within the directory, and `config.yaml`
lists the full order explicitly.

## Selectors

- **App UI**: select by `id:` using React Native `testID`, named `<screen>.<element>[.<qualifier>]` in
  lower camel case. Examples: `sources.add`, `sources.row`, `sources.row.alias`, `sources.row.status`,
  `sources.row.regrant`, `sources.row.remove`, `sources.dialog.confirm`, `sources.dialog.cancel`,
  `sources.error`. Repeated rows share an ID and are disambiguated with `childOf` or `index`.
- **System UI (DocumentsUI, permission dialogs)**: select by visible text, and only inside `subflows/`.
  Version differences are handled there with `runFlow: when:` branches, never in feature flows.

## Assertions

- Assert what the user sees: the `alias` text, the status chip text ("Available", "Access lost",
  "Storage missing") and error messages. Do not assert internal IDs.
- Every flow that relies on state from an earlier flow says so in a leading comment, for example
  `# requires: 01-add-internal`.
- Only the first flow of a run uses `launchApp: clearState: true`. A restart is `stopApp` then `launchApp`
  without `clearState`.

## Test-only seams

- A seam lives only in `android/app/src/debug/`, is reached through a `syncscope-debug://` deep link
  (`openLink`), and is recorded in `docs/decisions/`. It must reproduce a real OS state, never fake app
  state. The first seam is `syncscope-debug://release-grants` (research R11).

## Fixtures

- Device fixtures are created by `scripts/validation/device-fixtures.sh` before `maestro test`, never by
  a flow. Fixture folders live under `SyncScopeE2E/` on each volume.

## Acceptance-scenario mapping

| Spec scenario | Flow |
| --- | --- |
| US1-1 add a folder | `sources/01-add-internal.yaml` |
| Edge case: picker cancelled | `sources/01-add-internal.yaml` (back out of the picker first; the list stays empty) |
| US1-2 removable storage | `sources/02-add-removable.yaml` (also asserts the disambiguated alias) |
| Edge case: overlap rejected | `sources/03-reject-overlap.yaml` |
| US1-3 persists across restart | `sources/04-restart-persists.yaml` |
| US1-4 revoked shows unavailable | `sources/05-revoked-unavailable.yaml` |
| US1-5 re-grant same folder / US1-6 re-grant a different folder | `sources/06-regrant.yaml` (mismatch first, then success) |
| FR-005 remove with confirmation | `sources/07-remove.yaml` (removes the unavailable SD row: cancel keeps it, confirm removes it) |
| US1-7 passes on API 31 and API 36 | the whole directory under `pnpm e2e:android` |
