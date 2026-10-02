package com.syncscope.scan

import android.util.Log
import com.syncscope.bridge.CloudSyncEnvelope
import com.syncscope.bridge.CloudSyncErrorCode
import com.syncscope.persistence.ScanRunEntity
import com.syncscope.persistence.SnapshotStore
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableJob
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/** `startScan` while a run is active (`SCAN_IN_PROGRESS`). */
class ScanInProgress : Exception(CloudSyncErrorCode.SCAN_IN_PROGRESS.name)

/** A scan or deletion step while a deletion prepare or execute runs (`DELETION_IN_PROGRESS`, FR-021). */
class DeletionInProgress : Exception(CloudSyncErrorCode.DELETION_IN_PROGRESS.name)

/** `cancelScan` named a run that does not exist (`SCAN_NOT_FOUND`). */
class ScanNotFound : Exception(CloudSyncErrorCode.SCAN_NOT_FOUND.name)

/**
 * What `getScanState` reports about a run: its row, its live [phase] and [progress], and, for a
 * FAILED run this process saw end, the recovery [failureAction] (the row keeps only code and message).
 */
data class ScanRunView(
  val run: ScanRunEntity,
  val phase: String,
  val progress: ScanProgress.Counters,
  val failureAction: String?,
)

/**
 * Owns the at-most-one foreground run (research R7, R9): starts it as a `Job` on [scope], exposes its
 * [ScanProgress], and ends it on [cancel] (`USER`) or [onHostPause] (`BACKGROUNDED`). A cancelled run is
 * discarded under [NonCancellable], so its staged snapshot is always deleted and the active snapshot
 * never moves. Runs left behind by a dead process are aborted once, on the first [start] or [state].
 */
class ScanCoordinator(
  private val engine: ScanEngine,
  private val store: SnapshotStore,
  private val scope: CoroutineScope,
  private val clock: () -> Long = System::currentTimeMillis,
  private val onProgressPublished: (ScanProgress.Counters) -> Unit = {},
) {
  private class ActiveRun(val run: ScanRunEntity, val progress: ScanProgress, val job: CompletableJob) {
    val control = RunControl()
    @Volatile var cancelReason: String? = null

    fun cancel(reason: String) {
      if (cancelReason == null) cancelReason = reason
      job.cancel()
      control.closeClient()
    }
  }

  /** Serialises starts and the one-time abandoned-run cleanup. */
  private val mutex = Mutex()
  private var abandonedRunsAborted = false
  private val active = AtomicReference<ActiveRun?>(null)

  /** Set while a [runExclusive] block (a deletion prepare or execute) runs. */
  @Volatile private var exclusive = false

  /** The last run this process ran, kept so its final counters and failure action stay readable. */
  @Volatile private var last: ActiveRun? = null
  @Volatile private var lastFailureAction: Pair<String, String?>? = null

  /**
   * Creates and launches a run. Throws [ScanInProgress] while one is active, [DeletionInProgress] while
   * a [runExclusive] block runs, and the engine's [ScanRefused] when a precondition fails; in each case
   * no run is created.
   */
  suspend fun start(mode: ScanMode): ScanRunEntity =
    mutex.withLock {
      abortAbandonedRunsOnce()
      if (active.get() != null) throw ScanInProgress()
      if (exclusive) throw DeletionInProgress()
      val ticket = engine.begin(mode)
      val progress = ScanProgress(clock, onPublish = onProgressPublished)
      progress.phase = ticket.run.phase
      // A child Job we hold before the body runs, so a cancel can never miss it. UNDISPATCHED starts the
      // body even if that Job is cancelled first, so the cleanup below always runs.
      val handle = ActiveRun(ticket.run, progress, Job(scope.coroutineContext[Job]))
      active.set(handle)
      last = handle
      scope.launch(handle.job, CoroutineStart.UNDISPATCHED) { runToEnd(handle, ticket) }
      handle.job.complete()
      ticket.run
    }

  private suspend fun runToEnd(handle: ActiveRun, ticket: ScanTicket) {
    val run = handle.run
    try {
      when (val outcome = engine.execute(ticket, handle.progress, handle.control)) {
        is ScanOutcome.Failed -> {
          lastFailureAction = run.runId to outcome.action
          handle.progress.phase = ScanPhase.FAILED.name
        }
        is ScanOutcome.Published -> Unit
      }
    } catch (e: CancellationException) {
      discard(handle, TERMINAL_CANCELLED, null, handle.cancelReason ?: CANCEL_BACKGROUNDED)
      handle.progress.phase = ScanPhase.CANCELLED.name
      throw e
    } catch (t: Throwable) {
      Log.e(TAG, "scan run failed: ${CloudSyncEnvelope.redact(t.toString())}")
      discard(handle, ScanEngine.TERMINAL_FAILED, CloudSyncErrorCode.INTERNAL_ERROR.name, "Unexpected ${t.javaClass.simpleName}.")
      lastFailureAction = run.runId to CloudSyncEnvelope.INTERNAL_ERROR_ACTION
      handle.progress.phase = ScanPhase.FAILED.name
    } finally {
      handle.control.closeClient()
      active.compareAndSet(handle, null)
    }
  }

  private suspend fun discard(handle: ActiveRun, terminalState: String, errorCode: String?, summary: String) {
    withContext(NonCancellable) {
      try {
        store.discardRun(handle.run.runId, handle.run.generation, terminalState, errorCode, summary, clock())
      } catch (t: Exception) {
        // Nothing is promoted either way; a run left non-terminal is aborted on the next process start.
        Log.e(TAG, "could not discard scan run: ${CloudSyncEnvelope.redact(t.toString())}")
      }
    }
  }

  /**
   * Cancels the active run [runId] and waits until it is discarded. A run that already ended is a
   * no-op; an unknown ID throws [ScanNotFound].
   */
  suspend fun cancel(runId: String) {
    val handle = active.get()
    if (handle != null && handle.run.runId == runId) {
      handle.cancel(CANCEL_USER)
      handle.job.join()
      return
    }
    store.run(runId) ?: throw ScanNotFound()
  }

  /** The app left the foreground: an active run is cancelled as `BACKGROUNDED` (FR-001). */
  fun onHostPause() {
    active.get()?.cancel(CANCEL_BACKGROUNDED)
  }

  /** The running run, else the latest one, else null. */
  suspend fun state(): ScanRunView? {
    mutex.withLock { abortAbandonedRunsOnce() }
    active.get()?.let { return ScanRunView(it.run, it.progress.phase, it.progress.published, null) }
    val run = store.latestRun() ?: return null
    val mine = last?.takeIf { it.run.runId == run.runId }
    val action = lastFailureAction?.takeIf { it.first == run.runId }?.second
    return ScanRunView(run, run.phase, mine?.progress?.latest ?: ScanProgress.Counters(), action)
  }

  /**
   * Runs [block] while no scan can start and no other exclusive block can run (FR-021). Throws
   * [ScanInProgress] while a run is active and [DeletionInProgress] while another exclusive block runs;
   * in both cases [block] never runs. The coordinator is released when [block] returns or throws.
   */
  suspend fun <T> runExclusive(block: suspend () -> T): T {
    mutex.withLock {
      if (active.get() != null) throw ScanInProgress()
      if (exclusive) throw DeletionInProgress()
      exclusive = true
    }
    try {
      return block()
    } finally {
      exclusive = false
    }
  }

  /** True while a scan run or an exclusive block is active. */
  fun isBusy(): Boolean = active.get() != null || exclusive

  /** Waits for the active run, if any, to end. */
  internal suspend fun awaitIdle() {
    active.get()?.job?.join()
  }

  private suspend fun abortAbandonedRunsOnce() {
    if (abandonedRunsAborted) return
    store.abortAbandonedRuns(clock())
    abandonedRunsAborted = true
  }

  companion object {
    const val TERMINAL_CANCELLED = "CANCELLED"
    const val CANCEL_USER = "USER"
    const val CANCEL_BACKGROUNDED = "BACKGROUNDED"
    private const val TAG = "CloudSync"
  }
}
