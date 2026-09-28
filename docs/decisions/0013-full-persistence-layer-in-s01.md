# D013: Does M001/S01 implement the full Room persistence layer, or only the rows its boundary map names?

- **Status**: Accepted
- **Date / context**: Planning M001/S01; research flagged this as an explicit open judgement call for the
  planner.
- **Scope**: architecture
- **Made by**: agent
- **Revisable**: Yes. If `SnapshotStore` publish/query semantics prove larger than the tests suggest, the
  query-page internals could be deferred to M001/S03, but the entity/DAO/schema set cannot be split.

## Context

M001/S01's boundary map names only the `repository_config` and `trusted_sftp_host_key` rows, but the
existing JVM test suite already pins the whole persistence API.

## Decision

M001/S01 implements the complete pinned persistence surface — all 10 entities, their DAOs,
`SyncScopeDatabase`, `SnapshotQuery`, `PageTokenCodec`, `SnapshotStore` and the three exception types — so
that the entire existing JVM test suite compiles and passes at S01 exit.

## Rationale

Six test files under `android/app/src/test/java/com/syncscope/persistence/` (582 lines) already pin this API
exactly and live in the same Kotlin package as main source, so they compile against it directly. A partial
entity set leaves `:app:testDebugUnitTest` unable to compile, which would leave S01 with no JVM verification
gate at all and would make `SchemaContractTest` — the test that enforces the credentials-never-in-Room
boundary for R003 — unrunnable. Room also generates one schema JSON per `@Database`, so the exported schema
the contract test reads cannot be produced from a partial entity set. The pinned tests specify behaviour
precisely enough that implementing them is spec-following rather than design work, and M001/S03 then
consumes a working store instead of building one mid-scan-engine.

## Alternatives rejected

- Only the `repository_config` and `trusted_sftp_host_key` rows — the JVM test suite would not compile,
  leaving no JVM gate and an unrunnable `SchemaContractTest`.

## Related

- Requirements: R003
- Features: specs/002-native-cloudsync-connect
