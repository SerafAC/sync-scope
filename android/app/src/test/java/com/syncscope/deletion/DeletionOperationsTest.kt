package com.syncscope.deletion

import com.syncscope.bridge.CloudSyncContracts
import com.syncscope.bridge.CloudSyncErrorCode
import com.syncscope.persistence.RepositoryConfigEntity
import com.syncscope.persistence.SnapshotEntity
import com.syncscope.remote.RemoteClientException
import com.syncscope.remote.RemoteRoots
import com.syncscope.scan.DeletionInProgress
import com.syncscope.scan.ScanInProgress
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Research R13 / data-model "Deletion plan": prepare refusals, grouping, totals, the plan's lifecycle and
 * execution, over a fake store, re-check, deleter, exclusivity gate and clock.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class DeletionOperationsTest {

  private val store = FakeSnapshots()
  private val recheck = FakeRecheck()
  private val deleter = FakeDeleter()
  private val gate = FakeGate()
  private var now = 1_000_000L
  private var repository: RepositoryConfigEntity? = repository(revision = 3)
  private var writable = setOf("src-1")
  private var tokens = 0

  private val operations =
    DeletionOperations(
      snapshots = store,
      repository = { repository },
      recheck = recheck,
      deleter = deleter,
      exclusive = gate,
      writableSources = { writable },
      clock = { now },
      newToken = { "token-${++tokens}" },
    )

  // --- prepare refusals ---

  @Test
  fun aSnapshotThatIsNotActiveIsStaleGeneration() = runBlocking {
    store.snapshots["old"] = snapshotEntity("old")
    store.add(synced("e1"))
    assertEquals(refused(CloudSyncErrorCode.STALE_GENERATION), operations.prepare("old", listOf("e1")))
  }

  @Test
  fun anUnknownOrStagedSnapshotIsNotFound() = runBlocking {
    assertEquals(refused(CloudSyncErrorCode.SNAPSHOT_NOT_FOUND), operations.prepare("nope", listOf("e1")))
    store.snapshots["staged"] = snapshotEntity("staged").copy(publishable = false)
    assertEquals(refused(CloudSyncErrorCode.SNAPSHOT_NOT_FOUND), operations.prepare("staged", listOf("e1")))
  }

  @Test
  fun aSnapshotFromAnotherRepositoryRevisionIsRepositoryChanged() = runBlocking {
    store.add(synced("e1"))
    repository = repository(revision = 4)
    assertEquals(refused(CloudSyncErrorCode.REPOSITORY_CHANGED), operations.prepare(SNAPSHOT, listOf("e1")))
    assertTrue("no re-check without a matching repository", recheck.calls.isEmpty())
  }

  @Test
  fun noRepositoryIsNotConfigured() = runBlocking {
    store.add(synced("e1"))
    repository = null
    assertEquals(refused(CloudSyncErrorCode.REPOSITORY_NOT_CONFIGURED), operations.prepare(SNAPSHOT, listOf("e1")))
  }

  @Test
  fun busyRefusesWithTheBusyCode() = runBlocking {
    store.add(synced("e1"))
    gate.refuseWith = ScanInProgress()
    assertEquals(refused(CloudSyncErrorCode.SCAN_IN_PROGRESS), operations.prepare(SNAPSHOT, listOf("e1")))
    gate.refuseWith = DeletionInProgress()
    assertEquals(refused(CloudSyncErrorCode.DELETION_IN_PROGRESS), operations.prepare(SNAPSHOT, listOf("e1")))
    assertTrue(recheck.calls.isEmpty())
  }

  @Test
  fun emptyIdsAreInvalidQuery() = runBlocking {
    assertEquals(refused(CloudSyncErrorCode.INVALID_QUERY), operations.prepare(SNAPSHOT, emptyList()))
  }

  @Test
  fun aConnectionFailureFailsThePrepareAndLeavesNoPlan() = runBlocking {
    store.add(synced("e1"))
    val first = ready(operations.prepare(SNAPSHOT, listOf("e1")))
    val failure = RemoteClientException(CloudSyncErrorCode.CONNECTION_REFUSED, "refused", null)
    recheck.failure = failure

    val outcome = operations.prepare(SNAPSHOT, listOf("e1"))

    assertSame(failure, (outcome as PrepareOutcome.RemoteFailed).error)
    assertEquals(executeRefused(CloudSyncErrorCode.PLAN_NOT_FOUND), operations.execute(first.token, false))
    assertTrue(deleter.attempted.isEmpty())
  }

  // --- grouping and totals ---

  @Test
  fun rowsAreGroupedByStatusAndTheRecheck() = runBlocking {
    store.add(synced("s1", size = 100), synced("s2", size = 200), synced("s3", size = 300), synced("s4", size = 400))
    store.add(unsynced("u1", size = 10), unknown("k1", size = 5), unknown("k2", size = 6))
    store.add(directory("d1"))
    recheck.split = { rows ->
      RecheckResult(
        toDelete = rows.filter { it.entryId == "s1" },
        unsynced = rows.filter { it.entryId == "s2" }.map { RecheckedRow(it, RecheckReason.GONE_FROM_SERVER) },
        refused =
          rows.filter { it.entryId == "s3" }.map { RecheckedRow(it, RecheckReason.RECHECK_FAILED) } +
            rows.filter { it.entryId == "s4" }.map { RecheckedRow(it, RecheckReason.SCAN_TOO_OLD) },
        movedByRecheck = 2,
      )
    }

    val plan = ready(operations.prepare(SNAPSHOT, listOf("s1", "s2", "s3", "s4", "u1", "k1", "k2", "d1", "ghost", "s1")))

    assertEquals("only SYNCED rows are re-checked", listOf("s1", "s2", "s3", "s4"), recheck.calls.single().map { it.entryId })
    assertEquals(GroupTotals(1, 100), plan.toDelete)
    assertEquals("UNSYNCED plus gone from the server", GroupTotals(2, 210), plan.unsynced)
    assertEquals("UNKNOWN rows plus failed and too-old re-checks", 4, plan.refusedCount)
    assertEquals(1, plan.scanTooOld)
    assertEquals(2, plan.movedByRecheck)
    assertEquals("the directory and the unknown ID", 2, plan.missing)
    assertEquals(0, plan.unknownSizeCount)
    assertEquals(REMOTE_LISTED_AT, plan.remoteListedAtMillis)
    assertEquals("token-1", plan.token)
  }

  @Test
  fun bytesSumKnownSizesOnly() = runBlocking {
    store.add(synced("s1", size = 100), synced("s2", size = null), unsynced("u1", size = null), unsynced("u2", size = 7))

    val plan = ready(operations.prepare(SNAPSHOT, listOf("s1", "s2", "u1", "u2")))

    assertEquals(GroupTotals(2, 100), plan.toDelete)
    assertEquals(GroupTotals(2, 7), plan.unsynced)
    assertEquals(2, plan.unknownSizeCount)
  }

  @Test
  fun noSyncedRowsMeansNoRecheck() = runBlocking {
    store.add(unsynced("u1"), unknown("k1"))
    val plan = ready(operations.prepare(SNAPSHOT, listOf("u1", "k1")))
    assertTrue(recheck.calls.isEmpty())
    assertEquals(GroupTotals(0, 0), plan.toDelete)
    assertEquals(1, plan.refusedCount)
  }

  @Test
  fun aSnapshotWithoutAListingTimeUsesItsCompletion() = runBlocking {
    store.snapshots[SNAPSHOT] = snapshotEntity(SNAPSHOT).copy(remoteListedAtMillis = null, completedAtMillis = 42L)
    store.add(unsynced("u1"))
    assertEquals(42L, ready(operations.prepare(SNAPSHOT, listOf("u1"))).remoteListedAtMillis)
  }

  // --- plan lifecycle ---

  @Test
  fun aNewPrepareReplacesThePlan() = runBlocking {
    store.add(synced("s1"))
    val first = ready(operations.prepare(SNAPSHOT, listOf("s1")))
    val second = ready(operations.prepare(SNAPSHOT, listOf("s1")))
    assertNotEquals(first.token, second.token)

    assertEquals(executeRefused(CloudSyncErrorCode.PLAN_NOT_FOUND), operations.execute(first.token, false))
    assertTrue(operations.execute(second.token, false) is ExecuteOutcome.Done)
  }

  @Test
  fun anExpiredPlanIsNotFound() = runBlocking {
    store.add(synced("s1"))
    val plan = ready(operations.prepare(SNAPSHOT, listOf("s1")))
    now += CloudSyncContracts.MAX_DELETION_PLAN_AGE_MILLIS + 1

    assertEquals(executeRefused(CloudSyncErrorCode.PLAN_NOT_FOUND), operations.execute(plan.token, false))
    assertTrue(deleter.attempted.isEmpty())
  }

  @Test
  fun aPlanAtExactlyTheMaximumAgeStillRuns() = runBlocking {
    store.add(synced("s1"))
    val plan = ready(operations.prepare(SNAPSHOT, listOf("s1")))
    now += CloudSyncContracts.MAX_DELETION_PLAN_AGE_MILLIS
    assertTrue(operations.execute(plan.token, false) is ExecuteOutcome.Done)
  }

  @Test
  fun aReusedTokenIsNotFound() = runBlocking {
    store.add(synced("s1"))
    val plan = ready(operations.prepare(SNAPSHOT, listOf("s1")))
    assertTrue(operations.execute(plan.token, false) is ExecuteOutcome.Done)
    assertEquals(executeRefused(CloudSyncErrorCode.PLAN_NOT_FOUND), operations.execute(plan.token, false))
    assertEquals(1, deleter.attempted.size)
  }

  @Test
  fun anUnknownTokenIsNotFound() = runBlocking {
    assertEquals(executeRefused(CloudSyncErrorCode.PLAN_NOT_FOUND), operations.execute("never-issued", true))
  }

  @Test
  fun aMovedActiveSnapshotIsPlanStale() = runBlocking {
    store.add(synced("s1"))
    val plan = ready(operations.prepare(SNAPSHOT, listOf("s1")))
    store.active = "newer"

    assertEquals(executeRefused(CloudSyncErrorCode.PLAN_STALE), operations.execute(plan.token, false))
    assertTrue(deleter.attempted.isEmpty())
    assertTrue(store.batches.isEmpty())
  }

  // --- execute ---

  @Test
  fun unsyncedRowsAreOnlyAttemptedWhenIncluded() = runBlocking {
    store.add(synced("s1"), unsynced("u1"), unknown("k1"))
    recheck.split = { rows ->
      RecheckResult(emptyList(), emptyList(), rows.map { RecheckedRow(it, RecheckReason.RECHECK_FAILED) }, 1)
    }
    val without = ready(operations.prepare(SNAPSHOT, listOf("s1", "u1", "k1")))
    val skipped = done(operations.execute(without.token, includeUnsynced = false))
    assertTrue("refused rows are never attempted, unsynced ones only when included", deleter.attempted.isEmpty())
    assertEquals(0, skipped.deleted)
    assertTrue(skipped.failures.isEmpty())

    val with = ready(operations.prepare(SNAPSHOT, listOf("s1", "u1", "k1")))
    done(operations.execute(with.token, includeUnsynced = true))
    assertEquals(listOf("u1"), deleter.attempted.map { it.entryId })
  }

  @Test
  fun outcomesAreCommittedInChunksOfOneHundred() = runBlocking {
    val ids = (1..250).map { "s$it" }
    ids.forEach { store.add(synced(it)) }
    val plan = ready(operations.prepare(SNAPSHOT, ids))

    val result = done(operations.execute(plan.token, false))

    assertEquals(listOf(100, 100, 50), store.batches.map { it.second.size })
    assertTrue(store.batches.all { it.first == SNAPSHOT })
    assertEquals(ids, store.batches.flatMap { batch -> batch.second.map { it.row.entryId } })
    assertEquals(250, result.deleted)
  }

  @Test
  fun theResultReportsFreedBytesFailuresAndRemovedIds() = runBlocking {
    store.add(
      synced("del", size = 100),
      synced("nosize", size = null),
      synced("gone", size = 50),
      synced("changed", size = 60),
      synced("denied", size = 70, sourceId = "src-2"),
      synced("failed", size = 80),
    )
    deleter.states = mapOf(
      "gone" to DeletionState.ALREADY_GONE,
      "changed" to DeletionState.CHANGED,
      "failed" to DeletionState.FAILED,
    )
    val plan = ready(operations.prepare(SNAPSHOT, listOf("del", "nosize", "gone", "changed", "denied", "failed")))

    val result = done(operations.execute(plan.token, false))

    assertEquals(2, result.deleted)
    assertEquals("known sizes of DELETED files only", 100L, result.freedBytes)
    assertEquals(
      listOf(
        FailureView("gone", "gone.png", DeletionState.ALREADY_GONE),
        FailureView("changed", "changed.png", DeletionState.CHANGED),
        FailureView("denied", "denied.png", DeletionState.ACCESS_LOST),
        FailureView("failed", "failed.png", DeletionState.FAILED),
      ),
      result.failures,
    )
    assertEquals(listOf("del", "nosize", "gone"), result.removedEntryIds)
    assertEquals(mapOf("denied" to false, "del" to true), deleter.grants.filterKeys { it == "denied" || it == "del" })
  }

  // --- exclusivity ---

  @Test
  fun prepareAndExecuteRunInsideRunExclusive() = runBlocking {
    store.add(synced("s1"))
    recheck.onCall = { assertTrue("re-check inside the gate", gate.inside) }
    deleter.onCall = { assertTrue("delete inside the gate", gate.inside) }
    store.onRecord = { assertTrue("commit inside the gate", gate.inside) }

    val plan = ready(operations.prepare(SNAPSHOT, listOf("s1")))
    assertEquals(1, gate.entries)
    done(operations.execute(plan.token, false))
    assertEquals(2, gate.entries)
    assertFalse(gate.inside)
  }

  @Test
  fun executeWhileBusyIsRefusedAndKeepsThePlan() = runBlocking {
    store.add(synced("s1"))
    val plan = ready(operations.prepare(SNAPSHOT, listOf("s1")))
    gate.refuseWith = ScanInProgress()
    assertEquals(executeRefused(CloudSyncErrorCode.SCAN_IN_PROGRESS), operations.execute(plan.token, false))
    gate.refuseWith = null
    assertTrue(operations.execute(plan.token, false) is ExecuteOutcome.Done)
  }

  // --- helpers ---

  private fun refused(code: CloudSyncErrorCode): PrepareOutcome = PrepareOutcome.Refused(code)

  private fun executeRefused(code: CloudSyncErrorCode): ExecuteOutcome = ExecuteOutcome.Refused(code)

  private fun ready(outcome: PrepareOutcome): DeletionPlanView =
    (outcome as? PrepareOutcome.Ready ?: error("expected a plan, got $outcome")).plan

  private fun done(outcome: ExecuteOutcome): DeletionResultView =
    (outcome as? ExecuteOutcome.Done ?: error("expected a result, got $outcome")).result

  private fun repository(revision: Long) =
    RepositoryConfigEntity(
      protocol = "SFTP",
      host = "10.0.2.2",
      port = 22,
      username = "alice",
      remoteRoots = RemoteRoots.encode(listOf("/backup")),
      precisionMillis = 1_000L,
      credentialVersion = 1L,
      revision = revision,
    )

  private fun row(entryId: String, status: String, size: Long?, sourceId: String = "src-1") =
    DeletionRow(
      entryId = entryId,
      sourceId = sourceId,
      parentId = null,
      documentUri = "content://doc/$entryId",
      name = "$entryId.png",
      sizeBytes = size,
      modifiedUtcMillis = 1_704_067_200_000L,
      status = status,
    )

  private fun synced(id: String, size: Long? = 10L, sourceId: String = "src-1") = row(id, "SYNCED", size, sourceId)

  private fun unsynced(id: String, size: Long? = 10L) = row(id, "UNSYNCED", size)

  private fun unknown(id: String, size: Long? = 10L) = row(id, "UNKNOWN", size)

  /** A directory row: [FakeSnapshots.deletionRows] never returns it, as the store only loads `FILE` rows. */
  private fun directory(id: String) = row(id, "DIRECTORY", null)

  private class FakeSnapshots : DeletionSnapshots {
    val snapshots = linkedMapOf(SNAPSHOT to snapshotEntity(SNAPSHOT))
    var active: String? = SNAPSHOT
    val rows = linkedMapOf<String, DeletionRow>()
    val batches = mutableListOf<Pair<String, List<DeletionOutcome>>>()
    var onRecord: () -> Unit = {}

    fun add(vararg added: DeletionRow) = added.forEach { rows[it.entryId] = it }

    override suspend fun activeSnapshotId(): String? = active

    override suspend fun snapshot(snapshotId: String): SnapshotEntity? = snapshots[snapshotId]

    override suspend fun deletionRows(snapshotId: String, entryIds: Collection<String>): List<DeletionRow> =
      entryIds.mapNotNull { rows[it] }.filter { it.status != "DIRECTORY" }

    override suspend fun recordDeletions(snapshotId: String, outcomes: List<DeletionOutcome>) {
      onRecord()
      batches += snapshotId to outcomes
    }
  }

  private class FakeRecheck : ServerRecheck {
    val calls = mutableListOf<List<DeletionRow>>()
    var failure: RemoteClientException? = null
    var split: (List<DeletionRow>) -> RecheckResult = { RecheckResult(it, emptyList(), emptyList(), 0) }
    var onCall: () -> Unit = {}

    override suspend fun recheck(snapshotId: String, repository: RepositoryConfigEntity, synced: List<DeletionRow>): RecheckResult {
      onCall()
      calls += synced
      failure?.let { throw it }
      return split(synced)
    }
  }

  private inner class FakeDeleter : DeviceDeleter {
    val attempted = mutableListOf<DeletionRow>()
    val grants = linkedMapOf<String, Boolean>()
    var states: Map<String, DeletionState> = emptyMap()
    var onCall: () -> Unit = {}

    override fun deleteOne(row: DeletionRow, sourceCanWrite: Boolean): DeletionOutcome {
      onCall()
      attempted += row
      grants[row.entryId] = sourceCanWrite
      val state = if (!sourceCanWrite) DeletionState.ACCESS_LOST else states[row.entryId] ?: DeletionState.DELETED
      return DeletionOutcome(row, state, now)
    }
  }

  private class FakeGate : ExclusiveRunner {
    var refuseWith: Exception? = null
    var inside = false
    var entries = 0

    override suspend fun <T> runExclusive(block: suspend () -> T): T {
      refuseWith?.let { throw it }
      entries++
      inside = true
      try {
        return block()
      } finally {
        inside = false
      }
    }
  }

  private companion object {
    const val SNAPSHOT = "snap-1"
    const val REMOTE_LISTED_AT = 900_000L

    fun snapshotEntity(id: String) =
      SnapshotEntity(
        snapshotId = id,
        scanRunId = "run-$id",
        completedAtMillis = 950_000L,
        coverage = "COMPLETE",
        configRevision = 3L,
        includeHidden = false,
        publishable = true,
        remoteListedAtMillis = REMOTE_LISTED_AT,
      )
  }
}
