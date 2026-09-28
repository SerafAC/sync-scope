<!--
Sync Impact Report
- Version change: (unratified template) → 1.0.0
- Modified principles: all template placeholders replaced (initial ratification)
- Added principles:
  I. Simplicity First (KISS)
  II. Build Only What Is Needed (YAGNI)
  III. Single Source of Truth (DRY)
  IV. Unit Tests for All Code (NON-NEGOTIABLE)
  V. End-to-End Coverage of Major Requirements (NON-NEGOTIABLE)
  VI. Versioning and CHANGELOG.md
  VII. Documentation Under ./docs Is Mandatory
  VIII. README.md Is Mandatory and User-Facing
  IX. DEVELOPMENT.md Is for Developers
- Added sections: Quality Gates, Development Workflow, Governance
- Removed sections: none
- Follow-up TODOs: none in this file. Repo does not yet contain ./docs, CHANGELOG.md,
  README.md or DEVELOPMENT.md; they must be created to become compliant (see Principles VI–IX).
-->

# SyncScope Constitution

## Core Principles

### I. Simplicity First (KISS)

- Every change MUST use the simplest design that satisfies the current specification.
- Indirection (abstraction layers, generic frameworks, configuration switches, extra
  dependencies) MUST NOT be introduced unless it removes existing complexity or is required by
  a stated requirement.
- Any deliberate added complexity MUST be recorded with its justification in the feature's
  `plan.md` (Complexity Tracking) and is subject to challenge in review.

Rationale: simple code is easier to test, review and keep correct across Android versions and
cloud protocols.

### II. Build Only What Is Needed (YAGNI)

- Code MUST trace to a requirement, user story or task in the active specification.
- Speculative features, unused extension points, and "future-proofing" options MUST NOT be
  merged.
- Dead code, unused exports and unused dependencies MUST be removed when found.

Rationale: unused code still costs maintenance, tests and review attention.

### III. Single Source of Truth (DRY)

- Each piece of knowledge (business rule, sync-matching logic, constant, type, configuration
  value, version number) MUST have exactly one authoritative definition; other places MUST
  reference or derive from it.
- Duplicated logic found in review MUST be consolidated before merge, unless the duplication is
  coincidental (same shape, different meaning) and that is stated.
- Documentation MUST link to the authoritative source rather than restating volatile details.

Rationale: duplicated truth drifts, and drift in sync-status rules produces wrong answers for
users.

### IV. Unit Tests for All Code (NON-NEGOTIABLE)

- Every new or changed unit of production code (TypeScript and native Kotlin/Java) MUST ship
  with unit tests in the same change.
- Bug fixes MUST include a regression test that fails without the fix.
- Unit tests MUST be deterministic and MUST NOT depend on network, real cloud services or device
  state; such dependencies MUST be replaced with fakes or fixtures.
- A change with failing or skipped unit tests MUST NOT be merged.

Rationale: unit tests are the fastest proof that each part behaves as specified.

### V. End-to-End Coverage of Major Requirements (NON-NEGOTIABLE)

- Every major requirement (each P1 user story and each supported cloud protocol: FTP, SFTP,
  WebDAV) MUST be covered by at least one end-to-end test on a real Android runtime (emulator or
  device) against the project's validation services.
- A feature is not complete until its end-to-end tests pass; the spec's acceptance scenarios
  MUST map to named end-to-end tests.
- End-to-end tests MUST use reproducible fixtures and MUST NOT require manual steps.

Rationale: sync correctness only shows when the app, Android storage and remote servers work
together.

### VI. Versioning and CHANGELOG.md

- The software MUST be versioned with Semantic Versioning (MAJOR.MINOR.PATCH).
- The version MUST have one authoritative source (see Principle III); all build metadata
  (e.g. Android `versionName`/`versionCode`) MUST derive from or stay consistent with it.
- `CHANGELOG.md` MUST exist at the repository root, follow the Keep a Changelog structure, and
  MUST be updated in the same change for every user-visible or behaviour-changing modification,
  under an `Unreleased` section until release.
- Each release MUST bump the version and move `Unreleased` entries under that version with an
  ISO date (YYYY-MM-DD).

Rationale: users and developers must be able to tell what changed and when.

### VII. Documentation Under ./docs Is Mandatory

- Project documentation (architecture, sync-matching rules, supported protocols, configuration,
  decisions) MUST live under `./docs`.
- Any change that alters behaviour, architecture, configuration or interfaces MUST update the
  affected `./docs` pages in the same change.
- Documentation that no longer matches the code is a defect and MUST be fixed or removed.

Rationale: documentation kept next to the code, and changed with it, stays trustworthy.

### VIII. README.md Is Mandatory and User-Facing

- `README.md` MUST exist at the repository root and is written for end users first.
- It MUST open with what the app does, then how to install it, configure a cloud connection,
  select folders and read sync results; developer content MUST NOT precede user content.
- Developer setup details MUST be linked to `DEVELOPMENT.md`, not duplicated.
- User-visible changes MUST update `README.md` in the same change.

Rationale: the first page a person sees should tell them how to use the app.

### IX. DEVELOPMENT.md Is for Developers

- `DEVELOPMENT.md` MUST exist at the repository root and hold developer-facing guidance:
  prerequisites, build, running unit and end-to-end tests, validation services, release and
  versioning procedure, and contribution workflow.
- Changes to tooling, build, test or release steps MUST update `DEVELOPMENT.md` in the same
  change.
- It MUST link to `./docs` for deep technical detail rather than duplicating it.

Rationale: separating developer instructions keeps the README focused on users while keeping
onboarding reliable.

## Quality Gates

A change MUST pass all of the following before merge:

- Lint with zero warnings (`pnpm lint`) and type check (`pnpm typecheck`).
- All unit tests (`pnpm test:ci`, and `pnpm test:android:unit` when native code changes).
- End-to-end tests for every affected major requirement (`pnpm e2e:android`).
- `CHANGELOG.md`, `./docs`, `README.md` and `DEVELOPMENT.md` updated as required by
  Principles VI–IX.
- Any added complexity justified per Principle I.

## Development Workflow

- Features follow the Spec Kit flow: specify → clarify → plan → tasks → implement.
- Each `plan.md` MUST include a Constitution Check against every principle; violations MUST be
  resolved or explicitly justified before tasks are generated.
- Tests (unit and end-to-end) MUST be planned as tasks alongside the implementation tasks they
  verify, not deferred to a later phase.
- Code review MUST verify compliance with this constitution and the Quality Gates.

## Governance

- This constitution supersedes all other project practices and guidance. Where another document
  conflicts with it, this constitution wins and the other document MUST be corrected.
- Amendments are made by changing this file in a dedicated change that states the reason,
  the version bump, and any follow-up needed in dependent artifacts.
- Constitution versioning follows Semantic Versioning:
  - MAJOR: removal or backward-incompatible redefinition of a principle or governance rule.
  - MINOR: a new principle or section, or materially expanded guidance.
  - PATCH: clarifications, wording and typo fixes with no semantic change.
- Compliance is reviewed on every plan (Constitution Check) and every code review; non-compliance
  found later MUST be recorded and fixed as a task.

**Version**: 1.0.0 | **Ratified**: 2026-09-28 | **Last Amended**: 2026-09-28
