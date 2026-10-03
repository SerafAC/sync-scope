package com.syncscope.deletion

import android.util.Log
import com.syncscope.bridge.CloudSyncContracts
import com.syncscope.bridge.CloudSyncErrorCode
import com.syncscope.persistence.RepositoryConfigEntity
import com.syncscope.persistence.SnapshotEntity
import com.syncscope.persistence.SnapshotStore
import com.syncscope.remote.RemoteClientException
import com.syncscope.scan.DeletionInProgress
import com.syncscope.scan.ScanInProgress
import java.util.UUID

/** What a deletion reads from and writes to the snapshot store (implemented by [SnapshotStore]). */
interface DeletionSnapshots {
  /** The active snapshot's ID, or null when nothing was published yet. */
  suspend fun activeSnapshotId(): String?

  suspend fun snapshot(snapshotId: String): SnapshotEntity?

  /** The `FILE` rows of [snapshotId] among [entryIds]; directories and unknown IDs are left out. */
  suspend fun deletionRows(snapshotId: String, entryIds: Collection<String>): List<DeletionRow>

  /** Commits one batch of at most [SnapshotStore.MAX_DELETIONS_PER_BATCH] outcomes (research R14). */
  suspend fun recordDeletions(snapshotId: String, outcomes: List<DeletionOutcome>)
}

/** The pre-delete server re-check (implemented by [DeletionRecheck]). */
fun interface ServerRecheck {
  suspend fun recheck(snapshotId: String, repository: RepositoryConfigEntity, synced: List<DeletionRow>): RecheckResult
}

/** Verifies and deletes one device file (implemented by [LocalDeleter]). */
fun interface DeviceDeleter {
  fun deleteOne(row: DeletionRow, sourceCanWrite: Boolean): DeletionOutcome
}

/**
 * The scan coordinator's single-run gate (FR-021): [runExclusive] throws [ScanInProgress] while a scan
 * runs and [DeletionInProgress] while another exclusive block runs, and then never runs the block.
 */
interface ExclusiveRunner {
  suspend fun <T> runExclusive(block: suspend () -> T): T
}

/** Count and known-size byte total of one plan group. */
data class GroupTotals(val count: Int, val bytes: Long)

/** The bridge view of a stored plan (`DeletionPlanDto`). No document URI or remote path is in it. */
data class DeletionPlanView(
  val token: String,
  val toDelete: GroupTotals,
  val unsynced: GroupTotals,
  val refusedCount: Int,
  val scanTooOld: Int,
  val movedByRecheck: Int,
  val missing: Int,
  val unknownSizeCount: Int,
  val remoteListedAtMillis: Long,
)

/** One attempted file that was not deleted (`DeletionFailureDto`). */
data class FailureView(val entryId: String, val name: String, val reason: DeletionState)

/** The outcome of an execute (`DeletionResultDto`). */
data class DeletionResultView(
  val deleted: Int,
  val freedBytes: Long,
  val failures: List<FailureView>,
  val removedEntryIds: List<String>,
)

sealed interface PrepareOutcome {
  data class Ready(val plan: DeletionPlanView) : PrepareOutcome

  /** A refusal with a fixed contract code; no plan exists afterwards when it came from inside the gate. */
  data class Refused(val code: CloudSyncErrorCode) : PrepareOutcome

  /** The re-check could not connect (credentials, authentication, connection, TLS, host key). */
  data class RemoteFailed(val error: RemoteClientException, val repository: RepositoryConfigEntity) : PrepareOutcome
}

sealed interface ExecuteOutcome {
  data class Done(val result: DeletionResultView) : ExecuteOutcome

  data class Refused(val code: CloudSyncErrorCode) : ExecuteOutcome
}

/**
 * Two-phase local deletion (research R12, R13; data-model "Deletion plan").
 *
 * [prepare] checks the snapshot and the repository, groups the selected `FILE` rows, re-checks the
 * `SYNCED` ones on the server and keeps the result as the single in-memory plan, replacing any older one.
 * [execute] runs a plan once: it deletes `toDelete`, plus `unsynced` only when the user included them,
 * never `refused`, and commits removals every [SnapshotStore.MAX_DELETIONS_PER_BATCH] files so an
 * interrupted run leaves every committed batch consistent. Both run inside [ExclusiveRunner.runExclusive],
 * so no scan and no other deletion step can overlap them.
 *
 * Only codes and counts are logged (D011).
 */
class DeletionOperations(
  private val snapshots: DeletionSnapshots,
  private val repository: suspend () -> RepositoryConfigEntity?,
  private val recheck: ServerRecheck,
  private val deleter: DeviceDeleter,
  private val exclusive: ExclusiveRunner,
  /** The IDs of the sources this app may write to (a persisted write grant on the source's tree). */
  private val writableSources: suspend () -> Set<String>,
  private val clock: () -> Long = System::currentTimeMillis,
  private val newToken: () -> String = { UUID.randomUUID().toString() },
) {

  private class Plan(
    val token: String,
    val snapshotId: String,
    val createdAtMillis: Long,
    val toDelete: List<DeletionRow>,
    val unsynced: List<DeletionRow>,
  )

  @Volatile private var plan: Plan? = null

  suspend fun prepare(snapshotId: String, entryIds: List<String>): PrepareOutcome {
    if (entryIds.isEmpty()) return PrepareOutcome.Refused(CloudSyncErrorCode.INVALID_QUERY)
    return gated({ PrepareOutcome.Refused(it) }) {
      // A new prepare replaces the plan, and a refused one leaves none (data-model "Plan lifecycle").
      plan = null
      prepareInside(snapshotId, entryIds.distinct())
    }
  }

  private suspend fun prepareInside(snapshotId: String, ids: List<String>): PrepareOutcome {
    val snapshot = snapshots.snapshot(snapshotId)
    if (snapshot == null || !snapshot.publishable) return PrepareOutcome.Refused(CloudSyncErrorCode.SNAPSHOT_NOT_FOUND)
    if (snapshots.activeSnapshotId() != snapshotId) return PrepareOutcome.Refused(CloudSyncErrorCode.STALE_GENERATION)
    val repo = repository() ?: return PrepareOutcome.Refused(CloudSyncErrorCode.REPOSITORY_NOT_CONFIGURED)
    if (snapshot.configRevision != repo.revision) return PrepareOutcome.Refused(CloudSyncErrorCode.REPOSITORY_CHANGED)

    val rows = snapshots.deletionRows(snapshotId, ids)
    val byStatus = rows.groupBy { it.status }
    val synced = byStatus[STATUS_SYNCED].orEmpty()
    val checked =
      if (synced.isEmpty()) {
        RecheckResult(emptyList(), emptyList(), emptyList(), 0)
      } else {
        try {
          recheck.recheck(snapshotId, repo, synced)
        } catch (failure: RemoteClientException) {
          Log.w(TAG, "deletion prepare failed: ${failure.code}")
          return PrepareOutcome.RemoteFailed(failure, repo)
        }
      }
    val unsynced = byStatus[STATUS_UNSYNCED].orEmpty() + checked.unsynced.map { it.row }
    val unknownCount = byStatus[STATUS_UNKNOWN].orEmpty().size
    val stored = Plan(newToken(), snapshotId, clock(), checked.toDelete, unsynced)
    plan = stored
    Log.i(
      TAG,
      "deletion prepared: toDelete=${stored.toDelete.size} unsynced=${unsynced.size} " +
        "refused=${unknownCount + checked.refused.size} missing=${ids.size - rows.size}",
    )
    return PrepareOutcome.Ready(
      DeletionPlanView(
        token = stored.token,
        toDelete = totals(stored.toDelete),
        unsynced = totals(unsynced),
        refusedCount = unknownCount + checked.refused.size,
        scanTooOld = checked.refused.count { it.reason == RecheckReason.SCAN_TOO_OLD },
        movedByRecheck = checked.movedByRecheck,
        missing = ids.size - rows.size,
        unknownSizeCount = (stored.toDelete + unsynced).count { it.sizeBytes == null },
        // Version 1 snapshots have no listing time; their completion is the closest honest anchor.
        remoteListedAtMillis = snapshot.remoteListedAtMillis ?: snapshot.completedAtMillis ?: 0L,
      )
    )
  }

  suspend fun execute(planToken: String, includeUnsynced: Boolean): ExecuteOutcome =
    gated({ ExecuteOutcome.Refused(it) }) { executeInside(planToken, includeUnsynced) }

  private suspend fun executeInside(planToken: String, includeUnsynced: Boolean): ExecuteOutcome {
    val current = plan?.takeIf { it.token == planToken } ?: return ExecuteOutcome.Refused(CloudSyncErrorCode.PLAN_NOT_FOUND)
    // Single use: whatever happens next, this token is spent.
    plan = null
    if (clock() - current.createdAtMillis > CloudSyncContracts.MAX_DELETION_PLAN_AGE_MILLIS) {
      return ExecuteOutcome.Refused(CloudSyncErrorCode.PLAN_NOT_FOUND)
    }
    if (snapshots.activeSnapshotId() != current.snapshotId) return ExecuteOutcome.Refused(CloudSyncErrorCode.PLAN_STALE)

    val writable = writableSources()
    val rows = if (includeUnsynced) current.toDelete + current.unsynced else current.toDelete
    val outcomes = ArrayList<DeletionOutcome>(rows.size)
    val batch = ArrayList<DeletionOutcome>(SnapshotStore.MAX_DELETIONS_PER_BATCH)
    for (row in rows) {
      val outcome = deleter.deleteOne(row, row.sourceId in writable)
      outcomes += outcome
      batch += outcome
      if (batch.size == SnapshotStore.MAX_DELETIONS_PER_BATCH) {
        snapshots.recordDeletions(current.snapshotId, batch.toList())
        batch.clear()
      }
    }
    if (batch.isNotEmpty()) snapshots.recordDeletions(current.snapshotId, batch.toList())

    val deleted = outcomes.filter { it.state == DeletionState.DELETED }
    val result =
      DeletionResultView(
        deleted = deleted.size,
        freedBytes = deleted.sumOf { it.row.sizeBytes ?: 0L },
        failures =
          outcomes.filter { it.state != DeletionState.DELETED }.map { FailureView(it.row.entryId, it.row.name, it.state) },
        removedEntryIds = outcomes.filter { it.state.removesRow }.map { it.row.entryId },
      )
    Log.i(TAG, "deletion executed: attempted=${rows.size} deleted=${result.deleted} failed=${result.failures.size}")
    return ExecuteOutcome.Done(result)
  }

  /** Runs [block] inside the gate; a busy coordinator becomes [refuse] with its code. */
  private suspend fun <T> gated(refuse: (CloudSyncErrorCode) -> T, block: suspend () -> T): T =
    try {
      exclusive.runExclusive(block)
    } catch (_: ScanInProgress) {
      refuse(CloudSyncErrorCode.SCAN_IN_PROGRESS)
    } catch (_: DeletionInProgress) {
      refuse(CloudSyncErrorCode.DELETION_IN_PROGRESS)
    }

  private fun totals(rows: List<DeletionRow>) = GroupTotals(rows.size, rows.sumOf { it.sizeBytes ?: 0L })

  private companion object {
    const val TAG = "CloudSync"
    const val STATUS_SYNCED = "SYNCED"
    const val STATUS_UNSYNCED = "UNSYNCED"
    const val STATUS_UNKNOWN = "UNKNOWN"
  }
}
