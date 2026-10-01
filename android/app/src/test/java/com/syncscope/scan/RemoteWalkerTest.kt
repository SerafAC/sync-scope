package com.syncscope.scan

import com.syncscope.bridge.CloudSyncErrorCode
import com.syncscope.remote.ConnectOutcome
import com.syncscope.remote.PrecisionFinding
import com.syncscope.remote.RemoteClient
import com.syncscope.remote.RemoteClientException
import com.syncscope.remote.RemoteConfig
import com.syncscope.remote.RemoteEntry
import com.syncscope.remote.RemoteEntryType
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** Research R5: breadth-first walk, retry policy and the FAILED boundary, against a scripted fake client. */
class RemoteWalkerTest {

  private val script = Script()
  private val backoffs = mutableListOf<Long>()
  private val walker = RemoteWalker(delay = { backoffs += it })

  @Test
  fun completeWalkIndexesEveryRegularFileAndNeverFollowsOther() = runBlocking {
    script.ok("/root", file("exact.txt", 22), dir("a"), dir("b"), other("link"))
    script.ok("/root/a", file("reusable.jpg", 27))
    script.ok("/root/b", file("reusable.jpg", 27), dir("c"))
    script.ok("/root/b/c", file("deep.txt", 4))

    val result = walk()

    assertEquals(ListingState.Complete, result.listing)
    assertTrue(result.ambiguities.isEmpty())
    assertEquals(3, result.index.keyCount)
    val rows = result.index.toRows("snap").associateBy { it.name }
    assertEquals(2L, rows.getValue("reusable.jpg").duplicateCount)
    assertEquals(listOf("/root", "/root/a", "/root/b", "/root/b/c"), script.listed)
    assertFalse("OTHER is never listed", script.listed.any { it.endsWith("link") })
  }

  @Test
  fun rootWithTrailingSlashJoinsCleanly() = runBlocking {
    script.ok("/", dir("a"))
    script.ok("/a", file("x", 1))
    val result = walker.walk(session(), "/", PRECISION)
    assertEquals(listOf("/", "/a"), script.listed)
    assertEquals(1, result.index.keyCount)
  }

  @Test
  fun rootFailureRaisesRootListingFailed() {
    for (code in listOf(CloudSyncErrorCode.AUTH_FAILED, CloudSyncErrorCode.CONNECTION_REFUSED, CloudSyncErrorCode.DIRECTORY_UNREADABLE)) {
      val script = Script()
      script.fail("/root", code)
      val failure = assertThrows(RootListingFailed::class.java) {
        runBlocking { RemoteWalker(delay = {}).walk(RemoteSession(script.client()) { script.client() }, "/root", PRECISION) }
      }
      assertEquals(code, failure.code)
      assertEquals(0, script.reconnects)
    }
  }

  @Test
  fun rootTransientFailureRetriesThenRaisesRootListingFailed() {
    repeat(3) { script.fail("/root", CloudSyncErrorCode.CONNECTION_TIMEOUT) }
    val failure = assertThrows(RootListingFailed::class.java) { runBlocking { walk() } }
    assertEquals(CloudSyncErrorCode.CONNECTION_TIMEOUT, failure.code)
    assertEquals(listOf(1_000L, 2_000L), backoffs)
  }

  @Test
  fun unreadableSubdirectoryAddsOneAmbiguityAndTheWalkContinues() = runBlocking {
    script.ok("/root", dir("restricted"), dir("readable"))
    script.fail("/root/restricted", CloudSyncErrorCode.DIRECTORY_UNREADABLE)
    script.ok("/root/readable", file("exact.txt", 22))

    val result = walk()

    assertEquals(ListingState.Incomplete(CloudSyncErrorCode.DIRECTORY_UNREADABLE), result.listing)
    assertEquals(listOf(WalkAmbiguity.remoteDirectory(CloudSyncErrorCode.DIRECTORY_UNREADABLE)), result.ambiguities)
    assertEquals(1, result.index.keyCount)
    assertEquals(0, script.reconnects)
    assertTrue(backoffs.isEmpty())
  }

  @Test
  fun serverErrorOnASubdirectoryIsADirectoryAmbiguity() = runBlocking {
    script.ok("/root", dir("x"))
    script.fail("/root/x", CloudSyncErrorCode.SERVER_ERROR)
    val result = walk()
    assertEquals(listOf(WalkAmbiguity.remoteDirectory(CloudSyncErrorCode.SERVER_ERROR)), result.ambiguities)
    assertEquals(ListingState.Incomplete(CloudSyncErrorCode.SERVER_ERROR), result.listing)
  }

  @Test
  fun connectionLostRetriesWithBackoffAndRecovers() = runBlocking {
    script.ok("/root", dir("a"))
    script.fail("/root/a", CloudSyncErrorCode.CONNECTION_LOST)
    script.ok("/root/a", file("x", 1))

    val result = walk()

    assertEquals(ListingState.Complete, result.listing)
    assertTrue(result.ambiguities.isEmpty())
    assertEquals(listOf(1_000L), backoffs)
    assertEquals(1, script.reconnects)
    assertEquals(1, result.index.keyCount)
    assertEquals(1, script.closed.size)
  }

  @Test
  fun threeFailuresStopTheWalkWithAListingAmbiguity() = runBlocking {
    script.ok("/root", dir("a"), dir("b"))
    repeat(3) { script.fail("/root/a", CloudSyncErrorCode.CONNECTION_LOST) }
    script.ok("/root/b", file("never.txt", 1))

    val result = walk()

    assertEquals(ListingState.Incomplete(CloudSyncErrorCode.CONNECTION_LOST), result.listing)
    assertEquals(listOf(WalkAmbiguity.remoteListing(CloudSyncErrorCode.CONNECTION_LOST)), result.ambiguities)
    assertEquals(listOf(1_000L, 2_000L), backoffs)
    assertEquals(2, script.reconnects)
    assertEquals(3, script.listed.count { it == "/root/a" })
    assertFalse("the walk stopped", "/root/b" in script.listed)
  }

  @Test
  fun firstFailureCodeIsKeptWhenALaterOneStopsTheWalk() = runBlocking {
    script.ok("/root", dir("a"), dir("b"))
    script.fail("/root/a", CloudSyncErrorCode.DIRECTORY_UNREADABLE)
    repeat(3) { script.fail("/root/b", CloudSyncErrorCode.CONNECTION_TIMEOUT) }
    val result = walk()
    assertEquals(ListingState.Incomplete(CloudSyncErrorCode.DIRECTORY_UNREADABLE), result.listing)
    assertEquals(
      listOf(
        WalkAmbiguity.remoteDirectory(CloudSyncErrorCode.DIRECTORY_UNREADABLE),
        WalkAmbiguity.remoteListing(CloudSyncErrorCode.CONNECTION_TIMEOUT),
      ),
      result.ambiguities,
    )
  }

  @Test
  fun authFailedDuringReconnectIsNeverRetried() = runBlocking {
    script.ok("/root", dir("a"))
    script.fail("/root/a", CloudSyncErrorCode.CONNECTION_LOST)
    script.reconnectFailures += CloudSyncErrorCode.AUTH_FAILED

    val result = walk()

    assertEquals(1, script.reconnects)
    assertEquals(listOf(1_000L), backoffs)
    assertEquals(listOf(WalkAmbiguity.remoteListing(CloudSyncErrorCode.AUTH_FAILED)), result.ambiguities)
    assertEquals(ListingState.Incomplete(CloudSyncErrorCode.AUTH_FAILED), result.listing)
  }

  @Test
  fun authFailedOnASubdirectoryListIsNeverRetried() = runBlocking {
    script.ok("/root", dir("a"))
    script.fail("/root/a", CloudSyncErrorCode.AUTH_FAILED)
    val result = walk()
    assertEquals(0, script.reconnects)
    assertTrue(backoffs.isEmpty())
    assertEquals(listOf(WalkAmbiguity.remoteListing(CloudSyncErrorCode.AUTH_FAILED)), result.ambiguities)
  }

  @Test
  fun transientReconnectFailureCountsAsAnAttempt() = runBlocking {
    script.ok("/root", dir("a"))
    script.fail("/root/a", CloudSyncErrorCode.CONNECTION_LOST)
    script.reconnectFailures += CloudSyncErrorCode.CONNECTION_TIMEOUT
    script.ok("/root/a", file("x", 1))
    val result = walk()
    assertEquals(ListingState.Complete, result.listing)
    assertEquals(listOf(1_000L, 2_000L), backoffs)
    assertEquals(2, script.reconnects)
  }

  @Test
  fun hiddenRemoteEntriesAreIncluded() = runBlocking {
    script.ok("/root", file(".hidden.txt", 3), dir(".git"))
    script.ok("/root/.git", file("HEAD", 41))
    val result = walk()
    val names = result.index.toRows("snap").map { it.name }.toSet()
    assertEquals(setOf(".hidden.txt", "HEAD"), names)
  }

  @Test
  fun progressReportsDirectoriesAndFilesListed() = runBlocking {
    script.ok("/root", file("a", 1), file("b", 2), dir("d"), other("l"))
    script.ok("/root/d", file("c", 3))
    val progress = mutableListOf<WalkProgress>()
    walker.walk(session(), "/root", PRECISION) { progress += it }
    assertEquals(listOf(WalkProgress(1, 2), WalkProgress(2, 3)), progress)
  }

  private suspend fun walk(): WalkResult = walker.walk(session(), "/root", PRECISION)

  private fun session() = RemoteSession(script.client()) { script.reconnect() }

  private fun file(name: String, size: Long) = RemoteEntry(name, size, MTIME, RemoteEntryType.REGULAR_FILE)

  private fun dir(name: String) = RemoteEntry(name, 0, MTIME, RemoteEntryType.DIRECTORY)

  private fun other(name: String) = RemoteEntry(name, 0, MTIME, RemoteEntryType.OTHER)

  /** Per-directory queues of outcomes, shared by every client the walker reconnects to. */
  private class Script {
    val outcomes = mutableMapOf<String, ArrayDeque<Any>>()
    val listed = mutableListOf<String>()
    val closed = mutableListOf<FakeClient>()
    val reconnectFailures = ArrayDeque<CloudSyncErrorCode>()
    var reconnects = 0

    fun ok(directory: String, vararg entries: RemoteEntry) {
      outcomes.getOrPut(directory) { ArrayDeque() }.addLast(entries.toList())
    }

    fun fail(directory: String, code: CloudSyncErrorCode) {
      outcomes.getOrPut(directory) { ArrayDeque() }.addLast(code)
    }

    fun client() = FakeClient(this)

    fun reconnect(): RemoteClient {
      reconnects++
      reconnectFailures.removeFirstOrNull()?.let { throw RemoteClientException(it, "reconnect failed", null) }
      return client()
    }
  }

  private class FakeClient(private val script: Script) : RemoteClient {
    override suspend fun connect(config: RemoteConfig, password: CharArray): ConnectOutcome = ConnectOutcome.Connected

    override suspend fun list(directory: String): List<RemoteEntry> {
      script.listed += directory
      val next = script.outcomes[directory]?.removeFirstOrNull() ?: error("unscripted list of $directory")
      if (next is CloudSyncErrorCode) throw RemoteClientException(next, "list failed", null)
      @Suppress("UNCHECKED_CAST")
      return next as List<RemoteEntry>
    }

    override suspend fun discoverPrecision(): PrecisionFinding = error("not used by the walker")

    override fun close() {
      script.closed += this
    }
  }

  private companion object {
    const val PRECISION = 1_000L
    const val MTIME = 1_704_067_200_000L
  }
}
