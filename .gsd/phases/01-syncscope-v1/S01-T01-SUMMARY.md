---
id: T01
parent: S01
milestone: M001
key_files:
  - android/app/src/main/java/com/syncscope/persistence/Entities.kt
  - android/app/src/main/java/com/syncscope/persistence/Daos.kt
  - android/app/src/main/java/com/syncscope/persistence/SyncScopeDatabase.kt
  - android/app/src/main/java/com/syncscope/persistence/SnapshotQuery.kt
  - android/app/src/main/java/com/syncscope/persistence/PageTokenCodec.kt
  - android/app/src/main/java/com/syncscope/persistence/SnapshotStore.kt
  - android/app/src/main/java/com/syncscope/persistence/PersistenceExceptions.kt
  - android/app/schemas/com.syncscope.persistence.SyncScopeDatabase/1.json
key_decisions:
  - Fix the gate's missing SDK location with a gitignored android/local.properties (sdk.dir) rather than relying on ANDROID_HOME, because the verification gate shell does not inherit it
duration:
verification_result: passed
completed_at:
blocker_discovered: false
---

# T01: Room persistence layer (10+2 entities, DAOs, SyncScopeDatabase v1 with exported schema, SnapshotQuery, PageTokenCodec, SnapshotStore) passes all six persistence test classes; gate SDK-location failure fixed via gitignored android/local.properties

**Room persistence layer (10+2 entities, DAOs, SyncScopeDatabase v1 with exported schema, SnapshotQuery, PageTokenCodec, SnapshotStore) passes all six persistence test classes; gate SDK-location failure fixed via gitignored android/local.properties**

## What Happened

The prior attempt left the full com.syncscope.persistence implementation in place (Entities.kt, Daos.kt, SyncScopeDatabase.kt, SnapshotQuery.kt, PageTokenCodec.kt, SnapshotStore.kt, PersistenceExceptions.kt) plus the KSP-exported app/schemas/com.syncscope.persistence.SyncScopeDatabase/1.json. The verification gate failed only because it runs Gradle in a shell without ANDROID_HOME, so AGP could not locate the SDK ("SDK location not found"). Repair: wrote android/local.properties with sdk.dir=/home/adi/Android/Sdk (the file is gitignored at .gitignore:15-16, so it is machine-local and never committed). Re-ran the exact gate command with ANDROID_HOME and ANDROID_SDK_ROOT explicitly unset to reproduce the gate environment: BUILD SUCCESSFUL, schema present, no password fieldPath in the schema. The stale-worker recovery was an interrupted attempt; no code changes were needed beyond the environment repair.

## Verification

Ran the gate command `cd android && ./gradlew :app:testDebugUnitTest --no-daemon && test -f app/schemas/.../1.json && ! grep -qi '"fieldPath": "password' ...` with ANDROID_HOME unset. Exit 0. JUnit results: FoundationUnitTest 1/1, PageTokenCodecTest 5/5, SchemaConstraintTest 5/5, SchemaContractTest 6/6, SnapshotQueryTest 3/3, SnapshotStoreTest 5/5, with 0 failures and 0 errors.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `cd android && ./gradlew :app:testDebugUnitTest --no-daemon && test -f app/schemas/com.syncscope.persistence.SyncScopeDatabase/1.json && ! grep -qi '"fieldPath": "password' app/schemas/com.syncscope.persistence.SyncScopeDatabase/1.json (ANDROID_HOME unset)` | 0 | pass | 30244ms |

## Deviations

No code deviations. Added a machine-local, gitignored android/local.properties, which contradicts MEM017's "no local.properties" advice because the gate environment does not export ANDROID_HOME.

## Known Issues

android/local.properties is gitignored, so fresh worktrees must recreate it (or export ANDROID_HOME) before gate runs. MEM017 should be updated to say so.

## Files Created/Modified

- `android/app/src/main/java/com/syncscope/persistence/Entities.kt`
- `android/app/src/main/java/com/syncscope/persistence/Daos.kt`
- `android/app/src/main/java/com/syncscope/persistence/SyncScopeDatabase.kt`
- `android/app/src/main/java/com/syncscope/persistence/SnapshotQuery.kt`
- `android/app/src/main/java/com/syncscope/persistence/PageTokenCodec.kt`
- `android/app/src/main/java/com/syncscope/persistence/SnapshotStore.kt`
- `android/app/src/main/java/com/syncscope/persistence/PersistenceExceptions.kt`
- `android/app/schemas/com.syncscope.persistence.SyncScopeDatabase/1.json`
<!-- gsd:state-version=88:0 -->
