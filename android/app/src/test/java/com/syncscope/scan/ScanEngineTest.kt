package com.syncscope.scan

import androidx.test.core.app.ApplicationProvider
import com.syncscope.bridge.CloudSyncErrorCode
import com.syncscope.persistence.LocalNodeEntity
import com.syncscope.persistence.Migration4To5
import com.syncscope.persistence.RemoteAmbiguityEntity
import com.syncscope.persistence.SnapshotEntity
import com.syncscope.remote.HostKeyChallenge
import com.syncscope.source.SourceAvailability
import java.text.Normalizer
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The scan engine end to end over an in-memory Room database and fake remote / local sides. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class ScanEngineTest {

  private val h = ScanHarness(ApplicationProvider.getApplicationContext())

  @After
  fun tearDown() {
    h.close()
  }

  // --- FULL ---

  @Test
  fun cleanRunPublishesACompleteSnapshotWithRolledUpDirectories() = runBlocking {
    h.configure()
    h.addSource("src-1")
    h.remote.dir(REMOTE_ROOT, remoteFile("exact.txt", 22), remoteDir("a"), remoteFile(nfd("é-decomposed.txt"), 7))
    h.remote.dir("$REMOTE_ROOT/a", remoteFile("reusable.jpg", 27))
    h.enumerator.files(
      "src-1",
      localFile("d-exact", "exact.txt", size = 22, mtime = MTIME + 400),
      localFile("d-nfc", "é-decomposed.txt", size = 7),
      localDir("d-photos", "Photos"),
      localDir("d-empty", "Empty"),
      localFile("d-reuse", "reusable.jpg", size = 27, parent = "d-photos"),
      localFile("d-new", "new.jpg", size = 5, parent = "d-photos"),
      localDir("d-nested", "Nested", parent = "d-photos"),
      localFile("d-unread", "unreadable.txt", size = null, parent = "d-nested"),
    )

    val outcome = h.scan()

    val snapshotId = (outcome as ScanOutcome.Published).snapshotId
    val snapshot = h.db.snapshotDao().byId(snapshotId)!!
    assertTrue(snapshot.publishable)
    assertEquals("COMPLETE", snapshot.coverage)
    assertNotNull(snapshot.remoteListedAtMillis)
    assertEquals(snapshotId, h.store.activeSnapshot()!!.snapshotId)
    val run = h.db.scanRunDao().byId(snapshot.scanRunId)!!
    assertEquals("COMPLETED", run.terminalState)
    assertEquals("PUBLISHED", run.phase)
    assertEquals("FULL", run.mode)

    val nodes = h.nodes(snapshotId).associateBy { it.name }
    assertEquals(8, nodes.size)
    assertVerdict(nodes, "exact.txt", "SYNCED", null)
    assertVerdict(nodes, "é-decomposed.txt", "SYNCED", null)
    assertVerdict(nodes, "reusable.jpg", "SYNCED", null)
    assertVerdict(nodes, "new.jpg", "UNSYNCED", null)
    assertVerdict(nodes, "unreadable.txt", "UNKNOWN", "LOCAL_UNAVAILABLE")
    assertVerdict(nodes, "Nested", "UNKNOWN", null)
    assertVerdict(nodes, "Photos", "UNKNOWN", null)
    assertVerdict(nodes, "Empty", "SYNCED", null)
    assertEquals("DIRECTORY", nodes.getValue("Photos").kind)

    // parentId holds the parent's entryId; direct children of the source root have none.
    val photos = nodes.getValue("Photos").entryId
    assertNull(nodes.getValue("exact.txt").parentId)
    assertNull(nodes.getValue("Photos").parentId)
    assertEquals(photos, nodes.getValue("reusable.jpg").parentId)
    assertEquals(photos, nodes.getValue("Nested").parentId)
    assertEquals(nodes.getValue("Nested").entryId, nodes.getValue("unreadable.txt").parentId)
    assertFalse("entryId is not the document ID", nodes.values.any { it.entryId == it.documentId })
    assertTrue(nodes.getValue("reusable.jpg").documentUri.startsWith("content://"))

    // Precision is discovered, stamped on every row and written back to the config.
    assertTrue(nodes.values.all { it.precisionMillis == 1_000L })
    assertTrue(h.db.remoteMatchKeyDao().forSnapshot(snapshotId).all { it.precisionMillis == 1_000L })
    assertEquals(1_000L, h.db.repositoryConfigDao().get()!!.precisionMillis)

    // Every staged match key carries the remote directories its files were listed in (research R11).
    val staged = h.store.matchKeyBatches.flatten().associateBy { it.name }
    assertEquals(REMOTE_ROOT, staged.getValue("exact.txt").directories)
    assertEquals(REMOTE_ROOT, staged.getValue("é-decomposed.txt").directories)
    assertEquals("$REMOTE_ROOT/a", staged.getValue("reusable.jpg").directories)
    assertEquals(
      staged.values.associate { it.name to it.directories },
      h.db.remoteMatchKeyDao().forSnapshot(snapshotId).associate { it.name to it.directories },
    )

    val counts = h.store.counts(snapshotId)
    fun count(sourceId: String?, status: String) = counts.single { it.sourceId == sourceId && it.status == status }.count
    assertEquals(3L, count(null, "SYNCED"))
    assertEquals(1L, count(null, "UNSYNCED"))
    assertEquals(1L, count(null, "UNKNOWN"))
    assertEquals(3L, count("src-1", "SYNCED"))
    assertEquals(1L, count("src-1", "UNKNOWN"))

    assertTrue("every client is closed", h.remote.created.all { it.closed })
    assertEquals("one pacing call per local file, none per directory", 5, h.pauses.get())
  }

  @Test
  fun webdavHttpsRepositoryIsScannedOverHttps() = runBlocking {
    h.configure(protocol = "WEBDAV", webdavHttps = true)
    h.addSource("src-1")
    h.remote.dir(REMOTE_ROOT, remoteFile("exact.txt", 22))

    assertTrue(h.scan() is ScanOutcome.Published)
    assertTrue("the scan keeps the saved HTTPS setting", h.remote.created.first().connectedTo!!.webdavHttps)
  }

  @Test
  fun unreadableRemoteSubdirectoryPublishesAnIncompleteSnapshot() = runBlocking {
    h.configure()
    h.addSource("src-1")
    h.remote.dir(REMOTE_ROOT, remoteDir("restricted"), remoteDir("readable"))
    h.remote.fail("$REMOTE_ROOT/restricted", CloudSyncErrorCode.DIRECTORY_UNREADABLE)
    h.remote.dir("$REMOTE_ROOT/readable", remoteFile("exact.txt", 22))
    h.enumerator.files("src-1", localFile("d1", "exact.txt", size = 22), localFile("d2", "only-here.txt", size = 3))

    val snapshotId = (h.scan() as ScanOutcome.Published).snapshotId

    assertEquals("INCOMPLETE", h.db.snapshotDao().byId(snapshotId)!!.coverage)
    val nodes = h.nodes(snapshotId).associateBy { it.name }
    assertVerdict(nodes, "exact.txt", "SYNCED", null)
    assertVerdict(nodes, "only-here.txt", "UNKNOWN", "DIRECTORY_UNREADABLE")
    val ambiguities = h.store.ambiguities(snapshotId)
    assertEquals(listOf(RemoteAmbiguityEntity.SCOPE_REMOTE_DIRECTORY to "DIRECTORY_UNREADABLE"), ambiguities.map { it.scope to it.reason })
    assertEquals(snapshotId, h.store.activeSnapshot()!!.snapshotId)
  }

  @Test
  fun rootListingFailureFailsTheRunAndKeepsThePreviousSnapshot() = runBlocking {
    h.configure()
    h.addSource("src-1")
    h.remote.dir(REMOTE_ROOT, remoteFile("exact.txt", 22))
    h.enumerator.files("src-1", localFile("d1", "exact.txt", size = 22))
    val previous = (h.scan() as ScanOutcome.Published).snapshotId

    h.remote.fail(REMOTE_ROOT, CloudSyncErrorCode.AUTH_FAILED)
    val ticket = h.engine.begin(ScanMode.FULL)
    val outcome = h.engine.execute(ticket, ScanProgress(h.clock), RunControl())

    assertEquals(CloudSyncErrorCode.AUTH_FAILED, (outcome as ScanOutcome.Failed).code)
    val run = h.db.scanRunDao().byId(ticket.run.runId)!!
    assertEquals("FAILED", run.terminalState)
    assertEquals("AUTH_FAILED", run.errorCode)
    assertFalse("the summary is redacted", run.errorSummary!!.contains(REMOTE_HOST))
    assertNull("the staged snapshot is deleted", h.db.snapshotDao().forRun(ticket.run.runId))
    assertEquals(0L, h.db.localNodeDao().countFor(ticket.snapshotId))
    assertEquals(previous, h.store.activeSnapshot()!!.snapshotId)
    assertEquals(1L, h.db.localNodeDao().countFor(previous))
    assertTrue(h.remote.created.all { it.closed })
  }

  // --- several remote folders (research R14) ---

  @Test
  fun everyFolderIsWalkedAndMatched() = runBlocking {
    h.configure(roots = listOf("/a", "/b"))
    h.addSource("src-1")
    h.remote.dir("/a", remoteFile("one.jpg", 1))
    h.remote.dir("/b", remoteFile("two.jpg", 2))
    h.enumerator.files("src-1", localFile("d1", "one.jpg", size = 1), localFile("d2", "two.jpg", size = 2), localFile("d3", "new.jpg", size = 3))

    val snapshotId = (h.scan() as ScanOutcome.Published).snapshotId

    assertEquals("COMPLETE", h.db.snapshotDao().byId(snapshotId)!!.coverage)
    val nodes = h.nodes(snapshotId).associateBy { it.name }
    assertVerdict(nodes, "one.jpg", "SYNCED", null)
    assertVerdict(nodes, "two.jpg", "SYNCED", null)
    assertVerdict(nodes, "new.jpg", "UNSYNCED", null)
    assertTrue(h.store.ambiguities(snapshotId).isEmpty())
    assertEquals(listOf("/a", "/b"), h.remote.created.first().connectedTo!!.rootPaths)
  }

  @Test
  fun anUnreadFolderPublishesAnIncompleteSnapshotWithRemoteFolderUnreadVerdicts() = runBlocking {
    h.configure(roots = listOf("/a", "/b"))
    h.addSource("src-1")
    h.remote.dir("/a", remoteFile("exact.txt", 22))
    h.remote.fail("/b", CloudSyncErrorCode.DIRECTORY_UNREADABLE)
    h.enumerator.files("src-1", localFile("d1", "exact.txt", size = 22), localFile("d2", "elsewhere.txt", size = 3))

    val outcome = h.scan()

    val snapshotId = (outcome as ScanOutcome.Published).snapshotId
    assertEquals(snapshotId, h.store.activeSnapshot()!!.snapshotId)
    assertEquals("INCOMPLETE", h.db.snapshotDao().byId(snapshotId)!!.coverage)
    val nodes = h.nodes(snapshotId).associateBy { it.name }
    assertVerdict(nodes, "exact.txt", "SYNCED", null)
    assertVerdict(nodes, "elsewhere.txt", "UNKNOWN", "REMOTE_FOLDER_UNREAD")
    assertFalse("never UNSYNCED (D006)", nodes.values.any { it.status == "UNSYNCED" })
    val gap = h.store.ambiguities(snapshotId).single()
    assertEquals(RemoteAmbiguityEntity.SCOPE_REMOTE_FOLDER, gap.scope)
    assertEquals("DIRECTORY_UNREADABLE", gap.reason)
    assertEquals("/b", gap.remotePath)
  }

  @Test
  fun withoutAnUnreadFolderTheFirstFailureCodeStays() = runBlocking {
    h.configure(roots = listOf("/a", "/b"))
    h.addSource("src-1")
    h.remote.dir("/a", remoteDir("restricted"))
    h.remote.fail("/a/restricted", CloudSyncErrorCode.DIRECTORY_UNREADABLE)
    h.remote.dir("/b", remoteFile("exact.txt", 22))
    h.enumerator.files("src-1", localFile("d1", "only-here.txt", size = 3))

    val snapshotId = (h.scan() as ScanOutcome.Published).snapshotId

    assertVerdict(h.nodes(snapshotId).associateBy { it.name }, "only-here.txt", "UNKNOWN", "DIRECTORY_UNREADABLE")
    assertNull(h.store.ambiguities(snapshotId).single().remotePath)
  }

  @Test
  fun everyFolderFailingFailsTheRunWithTheFirstFoldersCodeAndKeepsThePreviousSnapshot() = runBlocking {
    h.configure(roots = listOf("/a", "/b"))
    h.addSource("src-1")
    h.remote.dir("/a", remoteFile("exact.txt", 22))
    h.remote.dir("/b")
    h.enumerator.files("src-1", localFile("d1", "exact.txt", size = 22))
    val previous = (h.scan() as ScanOutcome.Published).snapshotId

    h.remote.fail("/a", CloudSyncErrorCode.REMOTE_ROOT_NOT_FOUND)
    h.remote.fail("/b", CloudSyncErrorCode.DIRECTORY_UNREADABLE)
    val outcome = h.scan()

    assertEquals(CloudSyncErrorCode.REMOTE_ROOT_NOT_FOUND, (outcome as ScanOutcome.Failed).code)
    assertEquals(previous, h.store.activeSnapshot()!!.snapshotId)
  }

  @Test
  fun refreshCopiesRemoteFolderGapsWithTheirPathsAndKeepsTheVerdicts() = runBlocking {
    h.configure(roots = listOf("/a", "/b"))
    h.addSource("src-1")
    h.remote.dir("/a", remoteFile("exact.txt", 22))
    h.remote.fail("/b", CloudSyncErrorCode.DIRECTORY_UNREADABLE)
    h.enumerator.files("src-1", localFile("d1", "exact.txt", size = 22))
    h.scan()
    h.enumerator.files("src-1", localFile("d1", "exact.txt", size = 22), localFile("d2", "brand-new.txt", size = 4))

    val refreshed = (h.scan(ScanMode.LOCAL_REFRESH) as ScanOutcome.Published).snapshotId

    val gaps = h.store.ambiguities(refreshed)
    assertEquals(
      listOf(Triple(RemoteAmbiguityEntity.SCOPE_REMOTE_FOLDER, "DIRECTORY_UNREADABLE", "/b")),
      gaps.map { Triple(it.scope, it.reason, it.remotePath) },
    )
    assertEquals("INCOMPLETE", h.db.snapshotDao().byId(refreshed)!!.coverage)
    val nodes = h.nodes(refreshed).associateBy { it.name }
    assertVerdict(nodes, "exact.txt", "SYNCED", null)
    assertVerdict(nodes, "brand-new.txt", "UNKNOWN", "REMOTE_FOLDER_UNREAD")
  }

  @Test
  fun connectFailureFailsTheRunWithTheTypedCodeAndARedactedMessage() = runBlocking {
    h.configure()
    h.addSource("src-1")
    h.remote.connectFailure = CloudSyncErrorCode.CONNECTION_REFUSED

    val outcome = h.scan() as ScanOutcome.Failed

    assertEquals(CloudSyncErrorCode.CONNECTION_REFUSED, outcome.code)
    assertFalse(outcome.message.contains(REMOTE_HOST))
    assertFalse(outcome.message.contains(REMOTE_ROOT))
    assertEquals("Check the credentials and try again.", outcome.action)
    val run = h.db.scanRunDao().latest()!!
    assertEquals("FAILED", run.terminalState)
    assertEquals("CONNECTION_REFUSED", run.errorCode)
    assertNull(h.db.snapshotDao().forRun(run.runId))
    assertNull(h.store.activeSnapshot()!!.snapshotId)
    assertTrue(h.remote.created.single().closed)
  }

  @Test
  fun unapprovedHostKeyFailsTheRun() = runBlocking {
    h.configure()
    h.addSource("src-1")
    h.remote.hostKeyChallenge = HostKeyChallenge("c1", REMOTE_HOST, 2222, "ssh-ed25519", "AAAA", "SHA256:x", null, 1L)

    val outcome = h.scan() as ScanOutcome.Failed

    assertEquals(CloudSyncErrorCode.SFTP_HOST_KEY_UNVERIFIED, outcome.code)
    assertEquals("FAILED", h.db.scanRunDao().latest()!!.terminalState)
  }

  @Test
  fun skippedSourceIsRecordedAndOtherSourcesAreScanned() = runBlocking {
    h.configure()
    h.addSource("src-1")
    h.addSource("src-2")
    h.remote.dir(REMOTE_ROOT, remoteFile("exact.txt", 22))
    h.enumerator.skip("src-1", SourceAvailability.GRANT_REVOKED)
    h.enumerator.files("src-2", localFile("d1", "exact.txt", size = 22))

    val snapshotId = (h.scan() as ScanOutcome.Published).snapshotId

    val ambiguities = h.store.ambiguities(snapshotId)
    assertEquals(1, ambiguities.size)
    assertEquals(RemoteAmbiguityEntity.SCOPE_SOURCE, ambiguities[0].scope)
    assertEquals("src-1", ambiguities[0].sourceId)
    assertEquals("GRANT_REVOKED", ambiguities[0].reason)
    val nodes = h.nodes(snapshotId)
    assertTrue(nodes.none { it.sourceId == "src-1" })
    assertEquals(listOf("src-2"), nodes.map { it.sourceId })
    assertEquals("INCOMPLETE", h.db.snapshotDao().byId(snapshotId)!!.coverage)
  }

  @Test
  fun enumeratorFailingMidWalkKeepsTheYieldedRows() = runBlocking {
    h.configure()
    h.addSource("src-1")
    h.addSource("src-2")
    h.remote.dir(REMOTE_ROOT)
    h.enumerator.failing(
      "src-1",
      SecurityException("Permission Denial: content://com.android.externalstorage.documents/document/primary%3ASecret"),
      localFile("d1", "one.txt"),
      localFile("d2", "two.txt"),
    )
    h.enumerator.files("src-2", localFile("d3", "three.txt"))

    val snapshotId = (h.scan() as ScanOutcome.Published).snapshotId

    val nodes = h.nodes(snapshotId)
    assertEquals(setOf("one.txt", "two.txt"), nodes.filter { it.sourceId == "src-1" }.map { it.name }.toSet())
    assertEquals(listOf("three.txt"), nodes.filter { it.sourceId == "src-2" }.map { it.name })
    val ambiguity = h.store.ambiguities(snapshotId).single()
    assertEquals(RemoteAmbiguityEntity.SCOPE_SOURCE, ambiguity.scope)
    assertEquals("src-1", ambiguity.sourceId)
    assertEquals("LOCAL_UNAVAILABLE", ambiguity.reason)
  }

  @Test
  fun hiddenLocalEntriesAndTheirSubtreesAreNotStored() = runBlocking {
    h.configure()
    h.addSource("src-1")
    h.remote.dir(REMOTE_ROOT)
    h.enumerator.files(
      "src-1",
      localFile("d1", "visible.jpg"),
      localFile("d2", ".nomedia"),
      localDir("d3", ".thumbnails"),
      localFile("d4", "thumb.jpg", parent = "d3"),
      localDir("d5", "inner", parent = "d3"),
      localFile("d6", "deep.jpg", parent = "d5"),
    )

    val snapshotId = (h.scan() as ScanOutcome.Published).snapshotId

    assertEquals(listOf("visible.jpg"), h.nodes(snapshotId).map { it.name })
  }

  @Test
  fun rowsAreWrittenInBatchesOf500AndProgressIsThrottled() = runBlocking {
    h.configure()
    h.addSource("src-1")
    val count = 1_201
    h.remote.dir(REMOTE_ROOT, *Array(count) { remoteFile("f$it.txt", 10) })
    h.enumerator.files("src-1", *Array(count) { localFile("d$it", "f$it.txt") })
    val published = mutableListOf<Long>()
    val progress = ScanProgress(h.clock) { published += h.now.get() }

    val snapshotId = (h.scan(progress = progress) as ScanOutcome.Published).snapshotId

    val fileBatches = h.store.localBatches.map { batch -> batch.count { it.kind == "FILE" } }.filter { it > 0 }
    assertEquals(listOf(500, 500, 201), fileBatches)
    assertEquals(listOf(500, 500, 201), h.store.matchKeyBatches.map { it.size })
    assertEquals(count.toLong(), h.store.counts(snapshotId).single { it.sourceId == null && it.status == "SYNCED" }.count)
    assertTrue("progress was published", published.size >= 2)
    assertTrue("at most one update per 250 ms: $published", published.zipWithNext().all { (a, b) -> b - a >= 250 })
  }

  @Test
  fun ambiguityReasonsNeverCarryLocalIdentifiers() = runBlocking {
    h.configure()
    h.addSource("src-1")
    h.addSource("src-2")
    h.addSource("src-3")
    h.remote.dir(REMOTE_ROOT, remoteDir("restricted"))
    h.remote.fail("$REMOTE_ROOT/restricted", CloudSyncErrorCode.DIRECTORY_UNREADABLE)
    h.enumerator.failing("src-1", SecurityException("denied content://x/document/d1"), localFile("d1", "a.txt"))
    h.enumerator.skip("src-2", SourceAvailability.STORAGE_MISSING)
    h.enumerator.files("src-3", localFile("d9", "b.txt"))

    val snapshotId = (h.scan() as ScanOutcome.Published).snapshotId

    val identifiers = h.nodes(snapshotId).flatMap { listOf(it.entryId, it.documentId, it.documentUri) }
    val ambiguities = h.store.ambiguities(snapshotId)
    assertEquals(3, ambiguities.size)
    for (ambiguity in ambiguities) {
      for (id in identifiers) assertFalse("${ambiguity.reason} leaks $id", ambiguity.reason.contains(id))
      assertNull(ambiguity.entryId)
    }
  }

  // --- LOCAL_REFRESH ---

  @Test
  fun refreshFromACompleteSnapshotReusesTheRemoteListing() = runBlocking {
    h.configure()
    h.addSource("src-1")
    h.remote.dir(REMOTE_ROOT, remoteFile("exact.txt", 22), remoteFile("reusable.jpg", 27), remoteDir("b"))
    h.remote.dir("$REMOTE_ROOT/b", remoteFile("reusable.jpg", 27))
    h.enumerator.files("src-1", localFile("d1", "exact.txt", size = 22))
    val first = (h.scan() as ScanOutcome.Published).snapshotId
    val clients = h.remote.created.size
    h.enumerator.files("src-1", localFile("d1", "exact.txt", size = 22), localFile("d2", "new.txt", size = 4))

    val refreshed = (h.scan(ScanMode.LOCAL_REFRESH) as ScanOutcome.Published).snapshotId

    assertEquals("no remote client is created", clients, h.remote.created.size)
    suspend fun keys(id: String) = h.db.remoteMatchKeyDao().forSnapshot(id).map { listOf(it.name, it.sizeBytes, it.bucket, it.duplicateCount, it.precisionMillis, it.directories) }.toSet()
    assertEquals(keys(first), keys(refreshed))
    assertEquals(
      "$REMOTE_ROOT\n$REMOTE_ROOT/b",
      h.db.remoteMatchKeyDao().forSnapshot(refreshed).single { it.name == "reusable.jpg" }.directories,
    )
    val old: SnapshotEntity = h.db.snapshotDao().byId(first)!!
    val new: SnapshotEntity = h.db.snapshotDao().byId(refreshed)!!
    assertEquals(old.remoteListedAtMillis, new.remoteListedAtMillis)
    assertEquals("COMPLETE", new.coverage)
    assertEquals(refreshed, h.store.activeSnapshot()!!.snapshotId)
    assertEquals("LOCAL_REFRESH", h.db.scanRunDao().byId(new.scanRunId)!!.mode)
    val nodes = h.nodes(refreshed).associateBy { it.name }
    assertVerdict(nodes, "exact.txt", "SYNCED", null)
    assertVerdict(nodes, "new.txt", "UNSYNCED", null)
    assertTrue(nodes.values.all { it.precisionMillis == 1_000L })
  }

  @Test
  fun refreshFromAnIncompleteSnapshotKeepsUnmatchedFilesUnknown() = runBlocking {
    h.configure()
    h.addSource("src-1")
    h.addSource("src-2")
    h.remote.dir(REMOTE_ROOT, remoteDir("restricted"), remoteFile("exact.txt", 22))
    h.remote.fail("$REMOTE_ROOT/restricted", CloudSyncErrorCode.DIRECTORY_UNREADABLE)
    h.enumerator.files("src-1", localFile("d1", "exact.txt", size = 22))
    h.enumerator.skip("src-2", SourceAvailability.GRANT_REVOKED)
    h.scan()
    h.enumerator.files("src-1", localFile("d1", "exact.txt", size = 22), localFile("d2", "brand-new.txt", size = 4))
    h.enumerator.files("src-2")

    val refreshed = (h.scan(ScanMode.LOCAL_REFRESH) as ScanOutcome.Published).snapshotId

    val ambiguities = h.store.ambiguities(refreshed)
    assertEquals(
      "remote-scope rows are carried, SOURCE rows are recomputed",
      listOf(RemoteAmbiguityEntity.SCOPE_REMOTE_DIRECTORY to "DIRECTORY_UNREADABLE"),
      ambiguities.map { it.scope to it.reason },
    )
    assertEquals("INCOMPLETE", h.db.snapshotDao().byId(refreshed)!!.coverage)
    val nodes = h.nodes(refreshed).associateBy { it.name }
    assertVerdict(nodes, "exact.txt", "SYNCED", null)
    assertVerdict(nodes, "brand-new.txt", "UNKNOWN", "DIRECTORY_UNREADABLE")
  }

  @Test
  fun refreshWithoutAnActiveSnapshotIsRefusedWithoutCreatingARun() = runBlocking {
    h.configure()
    h.addSource("src-1")

    assertThrows(RefreshUnavailable::class.java) { runBlocking { h.engine.begin(ScanMode.LOCAL_REFRESH) } }
    assertNull(h.db.scanRunDao().latest())
  }

  @Test
  fun refreshAfterTheRepositoryChangedIsRefused() = runBlocking {
    val config = h.configure()
    h.addSource("src-1")
    h.remote.dir(REMOTE_ROOT)
    h.scan()
    val before = h.db.scanRunDao().latest()!!
    h.db.repositoryConfigDao().put(config.copy(revision = 2L))

    assertThrows(RefreshUnavailable::class.java) { runBlocking { h.engine.begin(ScanMode.LOCAL_REFRESH) } }
    assertEquals(before.runId, h.db.scanRunDao().latest()!!.runId)
  }

  // --- directory descendant counts (schema version 3) ---

  @Test
  fun fullAndRefreshSnapshotsCarryDescendantCountsOnDirectoriesOnly() = runBlocking {
    h.configure()
    h.addSource("src-1")
    h.remote.dir(REMOTE_ROOT, remoteFile("exact.txt", 22), remoteDir("a"))
    h.remote.dir("$REMOTE_ROOT/a", remoteFile("reusable.jpg", 27))
    h.enumerator.files(
      "src-1",
      localFile("d-exact", "exact.txt", size = 22),
      localFile("d-top-new", "top-new.txt", size = 3),
      localDir("d-photos", "Photos"),
      localDir("d-empty", "Empty"),
      localFile("d-reuse", "reusable.jpg", size = 27, parent = "d-photos"),
      localFile("d-new", "new.jpg", size = 5, parent = "d-photos"),
      localDir("d-nested", "Nested", parent = "d-photos"),
      localFile("d-unread", "unreadable.txt", size = null, parent = "d-nested"),
      localDir("d-deep", "Deep", parent = "d-nested"),
      localFile("d-deep-new", "deep-new.png", size = 9, parent = "d-deep"),
    )
    // Hand-computed: Photos ⊃ {reusable SYNCED, new UNSYNCED, Nested ⊃ {unreadable UNKNOWN, Deep ⊃ {deep-new
    // UNSYNCED}}}; Empty has nothing; the two top-level files count in no directory.
    val expected =
      mapOf(
        "Photos" to Triple(1L, 2L, 1L),
        "Nested" to Triple(0L, 1L, 1L),
        "Deep" to Triple(0L, 1L, 0L),
        "Empty" to Triple(0L, 0L, 0L),
      )

    val full = (h.scan() as ScanOutcome.Published).snapshotId
    assertDescendantCounts(full, expected)

    val refreshed = (h.scan(ScanMode.LOCAL_REFRESH) as ScanOutcome.Published).snapshotId
    assertTrue(full != refreshed)
    assertEquals("LOCAL_REFRESH", h.db.scanRunDao().byId(h.db.snapshotDao().byId(refreshed)!!.scanRunId)!!.mode)
    assertDescendantCounts(refreshed, expected)
  }

  private suspend fun assertDescendantCounts(snapshotId: String, expected: Map<String, Triple<Long, Long, Long>>) {
    val nodes = h.nodes(snapshotId)
    val directories = nodes.filter { it.kind == "DIRECTORY" }
    assertEquals(expected.keys, directories.map { it.name }.toSet())
    for (dir in directories) {
      assertNotNull("${dir.name}.descSynced", dir.descSynced)
      assertNotNull("${dir.name}.descUnsynced", dir.descUnsynced)
      assertNotNull("${dir.name}.descUnknown", dir.descUnknown)
      assertEquals(dir.name, expected.getValue(dir.name), Triple(dir.descSynced, dir.descUnsynced, dir.descUnknown))
    }
    val files = nodes.filter { it.kind == "FILE" }
    assertEquals(6, files.size)
    for (file in files) {
      assertNull("${file.name}.descSynced", file.descSynced)
      assertNull("${file.name}.descUnsynced", file.descUnsynced)
      assertNull("${file.name}.descUnknown", file.descUnknown)
    }
  }

  // --- sortName (schema version 5, research R2) ---

  @Test
  fun fullAndRefreshScansWriteSortNameOnEveryFileAndDirectory() = runBlocking {
    h.configure()
    h.addSource("src-1")
    h.remote.dir(REMOTE_ROOT, remoteFile("exact.txt", 22))
    h.enumerator.files(
      "src-1",
      localFile("d-exact", "exact.txt", size = 22),
      localFile("d-accent", "Émile.jpg", size = 3),
      localFile("d-digit", "2024 trip.png", size = 4),
      localDir("d-photos", "Photos"),
      localDir("d-umlaut", "Älter", parent = "d-photos"),
      localFile("d-inner", "Zebra.JPG", size = 5, parent = "d-umlaut"),
    )

    val full = (h.scan() as ScanOutcome.Published).snapshotId
    assertSortNames(full, 6)
    val byName = h.nodes(full).associateBy { it.name }
    assertEquals("1emile.jpg", byName.getValue("Émile.jpg").sortName)
    assertEquals("1alter", byName.getValue("Älter").sortName)
    assertEquals("02024 trip.png", byName.getValue("2024 trip.png").sortName)

    val refreshed = (h.scan(ScanMode.LOCAL_REFRESH) as ScanOutcome.Published).snapshotId
    assertTrue(full != refreshed)
    assertSortNames(refreshed, 6)
  }

  @Test
  fun refreshOverASnapshotMigratedFromVersion4RewritesSortNameOnEveryRow() = runBlocking {
    h.configure()
    h.addSource("src-1")
    h.remote.dir(REMOTE_ROOT, remoteFile("exact.txt", 22))
    h.enumerator.files(
      "src-1",
      localFile("d-exact", "exact.txt", size = 22),
      localFile("d-accent", "Émile.jpg", size = 3),
      localDir("d-umlaut", "Älter"),
      localFile("d-inner", "Zebra.JPG", size = 5, parent = "d-umlaut"),
    )
    val migrated = (h.scan() as ScanOutcome.Published).snapshotId
    // Stand in for a version-4 snapshot: the migration's SQL key does not fold accents, so `É` and `Ä` sit
    // under `#` (whether SQLite lowercases them depends on its build, so only the band is checked).
    Migration4To5().onPostMigrate(h.db.openHelper.writableDatabase)
    val before = h.nodes(migrated).associate { it.name to it.sortName }
    assertTrue(before.getValue("Émile.jpg"), before.getValue("Émile.jpg").startsWith("0"))
    assertTrue(before.getValue("Älter"), before.getValue("Älter").startsWith("0"))
    assertEquals("1zebra.jpg", before.getValue("Zebra.JPG"))

    // Nothing changed on the device: the refresh still rewrites every row of the new snapshot.
    val refreshed = (h.scan(ScanMode.LOCAL_REFRESH) as ScanOutcome.Published).snapshotId

    assertSortNames(refreshed, 4)
    val after = h.nodes(refreshed).associate { it.name to it.sortName }
    assertEquals("1emile.jpg", after.getValue("Émile.jpg"))
    assertEquals("1alter", after.getValue("Älter"))
    assertEquals("1exact.txt", after.getValue("exact.txt"))
  }

  private suspend fun assertSortNames(snapshotId: String, expectedRows: Int) {
    val nodes = h.nodes(snapshotId)
    assertEquals(expectedRows, nodes.size)
    for (node in nodes) assertEquals("${node.kind} ${node.name}", SortName.of(node.name), node.sortName)
  }

  // --- start preconditions ---

  @Test
  fun beginRefusesAMissingRepositoryCredentialOrSources() = runBlocking {
    assertThrows(RepositoryNotConfigured::class.java) { runBlocking { h.engine.begin(ScanMode.FULL) } }
    h.configure(credentialVersion = 99L)
    assertThrows(CredentialUnavailable::class.java) { runBlocking { h.engine.begin(ScanMode.FULL) } }
    h.configure()
    assertThrows(NoSourcesSelected::class.java) { runBlocking { h.engine.begin(ScanMode.FULL) } }
    assertNull(h.db.scanRunDao().latest())
  }

  private fun nfd(name: String) = Normalizer.normalize(name, Normalizer.Form.NFD)

  private fun assertVerdict(nodes: Map<String, LocalNodeEntity>, name: String, status: String, issueCode: String?) {
    val node = nodes[name] ?: throw AssertionError("no row named $name")
    assertEquals("$name status", status, node.status)
    assertEquals("$name issueCode", issueCode, node.issueCode)
  }
}
