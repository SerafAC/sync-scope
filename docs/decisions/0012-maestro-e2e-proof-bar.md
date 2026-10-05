# D012: What counts as proof that a user-visible capability works?

- **Status**: Accepted
- **Date / context**: M001 Layer 4, after verifying Maestro was already installed and wired into the e2e
  pipeline
- **Scope**: testing
- **Made by**: human
- **Revisable**: No. The user set this bar directly.

## Context

Every user-visible claim needs evidence, and the claims include irreversible deletion and folder access
through the Storage Access Framework, both of which behave differently across Android versions.

## Decision

Maestro 2.10.0 flows in `validation/maestro` drive the real APK on API 31 and API 36 emulators against live
digest-pinned protocol containers. Component tests with a mocked TurboModule are supporting evidence, never
the proof.

## Rationale

The user set this bar explicitly, including for deletion: a Maestro test is enough proof, and a mocked
`DocumentFile.delete()` is not. The infrastructure already exists — `android-flow.sh` orchestrates
containers, Metro, emulator boot, APK install and `maestro test` — but `validation/maestro` has zero flow
files, so every user-visible claim owes one. Both API levels run because SAF and scoped-storage behaviour
differ materially across that range, and folder access is the entire input side of the app. Aesthetic
quality is explicitly excluded: the user judges "slick and modern" themselves on a real device at milestone
end.

## Alternatives rejected

- Component tests with a mocked TurboModule as proof — supporting evidence only.
- A mocked `DocumentFile.delete()` as deletion proof — does not remove a real file from real storage.

## Related

- Requirements: R005, R020, R021
- Features: specs/003-local-source-selection, specs/004-scan-engine-matching,
  specs/005-gallery-list-filtering, specs/006-mvp,
  specs/008-tree-view-image-preview, specs/010-full-loop-release
