package com.syncscope.scan

import androidx.test.core.app.ApplicationProvider
import com.syncscope.persistence.scanRun
import com.syncscope.persistence.stagingSnapshot
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Single-flight runs, cancellation, backgrounding and progress throttling (research R7, R9). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class ScanCoordinatorTest {

  private val h = ScanHarness(ApplicationProvider.getApplicationContext())
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
  private val published = mutableListOf<Long>()
  private val coordinator =
    ScanCoordinator(h.engine, h.store, scope, h.clock) { synchronized(published) { published += h.now.get() } }

  @Before
  fun setUp() = runBlocking<Unit> {
    h.configure()
    h.addSource("src-1")
    h.remote.dir(REMOTE_ROOT, remoteFile("exact.txt", 22))
    h.enumerator.files("src-1", localFile("d1", "exact.txt", size = 22), localFile("d2", "new.txt", size = 3))
  }

  @After
  fun tearDown() {
    h.remote.release()
    scope.cancel()
    h.close()
  }

  @Test
  fun aSecondStartWhileRunningIsRefused() = runBlocking<Unit> {
    h.remote.hold()
    val run = coordinator.start(ScanMode.FULL)
    awaitGate()

    assertThrows(ScanInProgress::class.java) { runBlocking { coordinator.start(ScanMode.FULL) } }

    h.remote.release()
    coordinator.awaitIdle()
    assertEquals("COMPLETED", h.store.run(run.runId)!!.terminalState)
  }

  @Test
  fun cancelEndsTheRunCancelledAndDeletesTheStagedSnapshot() = runBlocking<Unit> {
    h.remote.hold()
    val run = coordinator.start(ScanMode.FULL)
    awaitGate()

    coordinator.cancel(run.runId)

    val ended = h.store.run(run.runId)!!
    assertEquals("CANCELLED", ended.terminalState)
    assertEquals("CANCELLED", ended.phase)
    assertEquals("USER", ended.errorSummary)
    assertNull(ended.errorCode)
    assertNull("the staged snapshot is deleted", h.db.snapshotDao().forRun(run.runId))
    assertTrue("the client is closed", h.remote.created.isNotEmpty() && h.remote.created.all { it.closed })
    assertNull(h.store.activeSnapshot()!!.snapshotId)

    // Cancelling a terminal run is a no-op; an unknown ID is not.
    coordinator.cancel(run.runId)
    assertEquals("CANCELLED", h.store.run(run.runId)!!.terminalState)
    assertThrows(ScanNotFound::class.java) { runBlocking { coordinator.cancel("no-such-run") } }
  }

  @Test
  fun hostPauseCancelsTheRunAsBackgroundedAndKeepsTheActiveSnapshot() = runBlocking<Unit> {
    coordinator.start(ScanMode.FULL)
    coordinator.awaitIdle()
    val active = h.store.activeSnapshot()!!.snapshotId
    assertNotNull(active)

    h.remote.hold()
    val run = coordinator.start(ScanMode.FULL)
    awaitGate()
    coordinator.onHostPause()
    coordinator.awaitIdle()

    val ended = h.store.run(run.runId)!!
    assertEquals("CANCELLED", ended.terminalState)
    assertEquals("BACKGROUNDED", ended.errorSummary)
    assertEquals(active, h.store.activeSnapshot()!!.snapshotId)
    assertNull(h.db.snapshotDao().forRun(run.runId))
  }

  @Test
  fun hostPauseWithoutARunDoesNothing() = runBlocking<Unit> {
    coordinator.onHostPause()
    assertNull(coordinator.state())
  }

  @Test
  fun abandonedRunsAreAbortedExactlyOnce() = runBlocking<Unit> {
    h.db.scanRunDao().insert(scanRun("dead-1", generation = 1L))
    h.store.stageSnapshot(stagingSnapshot("dead-snap", "dead-1"))

    assertEquals("ABORTED", coordinator.state()!!.run.terminalState)
    assertNull(h.db.snapshotDao().forRun("dead-1"))

    // A later non-terminal row is not touched by a second call.
    h.db.scanRunDao().insert(scanRun("other", generation = 2L))
    val view = coordinator.state()!!
    assertEquals("other", view.run.runId)
    assertNull(view.run.terminalState)
  }

  @Test
  fun startAlsoAbortsAbandonedRunsFirst() = runBlocking<Unit> {
    h.db.scanRunDao().insert(scanRun("dead-1", generation = 1L))

    val run = coordinator.start(ScanMode.FULL)
    coordinator.awaitIdle()

    assertEquals("ABORTED", h.store.run("dead-1")!!.terminalState)
    assertEquals(2L, run.generation)
    assertEquals("COMPLETED", h.store.run(run.runId)!!.terminalState)
  }

  @Test
  fun progressIsPublishedAtMostOncePer250Ms() = runBlocking<Unit> {
    val count = 1_201
    h.remote.dir(REMOTE_ROOT, *Array(count) { remoteFile("f$it.txt", 10) })
    h.enumerator.files("src-1", *Array(count) { localFile("d$it", "f$it.txt") })

    coordinator.start(ScanMode.FULL)
    coordinator.awaitIdle()

    val times = synchronized(published) { published.toList() }
    assertTrue("progress was published", times.size >= 2)
    assertTrue("at most one snapshot per 250 ms: $times", times.zipWithNext().all { (a, b) -> b - a >= 250 })
    val view = coordinator.state()!!
    assertEquals("the ended run reports its final counters", count.toLong(), view.progress.localFilesMatched)
  }

  @Test
  fun stateReturnsTheRunningRunElseTheLatest() = runBlocking<Unit> {
    assertNull(coordinator.state())

    h.remote.hold()
    val run = coordinator.start(ScanMode.FULL)
    awaitGate()
    val running = coordinator.state()!!
    assertEquals(run.runId, running.run.runId)
    assertNull(running.run.terminalState)
    assertEquals("LISTING_REMOTE", running.phase)

    h.remote.release()
    coordinator.awaitIdle()
    val latest = coordinator.state()!!
    assertEquals(run.runId, latest.run.runId)
    assertEquals("COMPLETED", latest.run.terminalState)
    assertEquals("PUBLISHED", latest.phase)
  }

  @Test
  fun aFailedRunKeepsItsRecoveryAction() = runBlocking<Unit> {
    h.remote.connectFailure = com.syncscope.bridge.CloudSyncErrorCode.AUTH_FAILED

    val run = coordinator.start(ScanMode.FULL)
    coordinator.awaitIdle()

    val view = coordinator.state()!!
    assertEquals(run.runId, view.run.runId)
    assertEquals("FAILED", view.run.terminalState)
    assertEquals("AUTH_FAILED", view.run.errorCode)
    assertEquals("Check the credentials and try again.", view.failureAction)
  }

  @Test
  fun runExclusiveIsRefusedWithScanInProgressWhileARunIsActive() = runBlocking<Unit> {
    h.remote.hold()
    coordinator.start(ScanMode.FULL)
    awaitGate()
    var ran = false

    assertTrue(coordinator.isBusy())
    assertThrows(ScanInProgress::class.java) { runBlocking { coordinator.runExclusive { ran = true } } }
    assertFalse("the refused block never runs", ran)

    h.remote.release()
    coordinator.awaitIdle()
    assertFalse(coordinator.isBusy())
  }

  @Test
  fun startIsRefusedWithDeletionInProgressWhileAnExclusiveBlockRuns() = runBlocking<Unit> {
    val entered = CompletableDeferred<Unit>()
    val release = CompletableDeferred<Unit>()
    val exclusive = scope.async { coordinator.runExclusive { entered.complete(Unit); release.await(); "done" } }
    withTimeout(10_000) { entered.await() }

    assertTrue(coordinator.isBusy())
    assertThrows(DeletionInProgress::class.java) { runBlocking { coordinator.start(ScanMode.FULL) } }
    assertNull("no run was created", h.store.latestRun())

    release.complete(Unit)
    assertEquals("done", exclusive.await())
    assertFalse(coordinator.isBusy())
  }

  @Test
  fun aSecondExclusiveBlockIsRefusedWhileTheFirstRuns() = runBlocking<Unit> {
    val entered = CompletableDeferred<Unit>()
    val release = CompletableDeferred<Unit>()
    val first = scope.async { coordinator.runExclusive { entered.complete(Unit); release.await() } }
    withTimeout(10_000) { entered.await() }
    var secondRan = false

    assertThrows(DeletionInProgress::class.java) { runBlocking { coordinator.runExclusive { secondRan = true } } }
    assertFalse("only one prepare or execute runs at a time", secondRan)
    assertTrue(coordinator.isBusy())

    release.complete(Unit)
    first.await()
    assertEquals(7, coordinator.runExclusive { 7 })
  }

  @Test
  fun anExclusiveBlockThatThrowsStillReleasesTheCoordinator() = runBlocking<Unit> {
    assertThrows(IllegalStateException::class.java) {
      runBlocking { coordinator.runExclusive<Unit> { throw IllegalStateException("boom") } }
    }

    assertFalse(coordinator.isBusy())
    val run = coordinator.start(ScanMode.FULL)
    coordinator.awaitIdle()
    assertEquals("COMPLETED", h.store.run(run.runId)!!.terminalState)
  }

  @Test
  fun isBusyIsFalseWhenIdle() {
    assertFalse(coordinator.isBusy())
  }

  private suspend fun awaitGate() {
    withTimeout(10_000) { h.remote.reachedGate.await() }
  }
}
