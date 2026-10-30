package com.syncscope.scan

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.syncscope.bridge.CloudSyncErrorCode
import com.syncscope.persistence.LocalNodeEntity
import com.syncscope.persistence.RemoteMatchKeyEntity
import com.syncscope.persistence.RepositoryConfigEntity
import com.syncscope.persistence.SnapshotStore
import com.syncscope.persistence.SyncScopeDatabase
import com.syncscope.persistence.localNode
import com.syncscope.persistence.scanRun
import com.syncscope.persistence.sourceRoot
import com.syncscope.persistence.stagingSnapshot
import com.syncscope.remote.FolderLister
import com.syncscope.remote.FolderListing
import com.syncscope.remote.ListingHooks
import com.syncscope.remote.RemoteClientException
import com.syncscope.remote.RemoteEntry
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The refresh re-check (FR-003, research R5, D023) over an in-memory Room database and a fake
 * [FolderLister]: which server folders it lists and in what order, the 32-folder cap, the 20 s budget,
 * how listed keys join the staged snapshot and the refresh's [MatchIndex], and that it never connects
 * without work and never throws on a server failure.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class RefreshRecheckTest {

  private lateinit var db: SyncScopeDatabase
  private lateinit var store: SnapshotStore
  private val now = AtomicLong(50_000L)
  private val lister = FakeLister(now)
  private lateinit var recheck: RefreshRecheck

  @Before
  fun setUp() = runBlocking {
    db =
      Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), SyncScopeDatabase::class.java)
        .allowMainThreadQueries()
        .build()
    store = SnapshotStore(db)
    db.sourceRootDao().insert(sourceRoot(SOURCE))
    db.sourceRootDao().insert(sourceRoot(OTHER_SOURCE))
    db.scanRunDao().insert(scanRun("run-1", 1))
    store.stageSnapshot(stagingSnapshot(ACTIVE, "run-1", remoteListedAtMillis = 1_000L))
    db.scanRunDao().insert(scanRun("run-2", 2, mode = "LOCAL_REFRESH"))
    store.stageSnapshot(stagingSnapshot(STAGED, "run-2"))
    recheck = RefreshRecheck(store, lister, clock = { now.get() })
  }

  @After
  fun tearDown() {
    db.close()
  }

  // --- Candidates ---

  @Test
  fun candidatesAreTheStoredFoldersOfSyncedNeighboursWeightedByTheirRecheckableFiles() = runBlocking {
    seed(
      // Album: 2 re-checkable files; its synced files were backed up to /s/A and /s/A2.
      directory("d-album", "Album"),
      file("a1.jpg", parent = "d-album"),
      file("a2.jpg", parent = "d-album"),
      file("x1.jpg", parent = "d-album", status = "UNSYNCED"),
      file("x2.jpg", parent = "d-album", status = "UNKNOWN", issueCode = "REMOTE_FOLDER_UNREAD"),
      // Beach: 1 re-checkable file (UNKNOWN for a listing failure).
      directory("d-beach", "Beach"),
      file("b1.jpg", parent = "d-beach"),
      file("y1.jpg", parent = "d-beach", status = "UNKNOWN", issueCode = "CONNECTION_LOST"),
      // Camera: only device-side UNKNOWN verdicts, which a listing cannot change.
      directory("d-camera", "Camera"),
      file("c1.jpg", parent = "d-camera"),
      file("z1.jpg", parent = "d-camera", status = "UNKNOWN", issueCode = "LOCAL_UNAVAILABLE"),
      file("z2.jpg", parent = "d-camera", status = "UNKNOWN", issueCode = "REMOTE_MTIME_MISSING"),
      // New: no backed-up neighbour, so no candidate (only a full scan finds it).
      directory("d-new", "New"),
      file("n1.jpg", parent = "d-new", status = "UNSYNCED"),
      // The source root: 1 re-checkable file next to a synced one.
      file("r1.jpg"),
      file("r2.jpg", status = "UNSYNCED"),
      // Another source's root holds re-checkable files but no synced one: it is not src-1's root.
      file("s1.jpg", source = OTHER_SOURCE, status = "UNSYNCED"),
      file("s2.jpg", source = OTHER_SOURCE, status = "UNSYNCED"),
    )
    keys(
      key("a1.jpg", "/s/A"),
      key("a2.jpg", "/s/A2", "/s/A"),
      key("b1.jpg", "/s/B"),
      key("c1.jpg", "/s/C"),
      key("r1.jpg", "/s/root"),
    )

    val listed = recheck.run(ACTIVE, STAGED, REPOSITORY, index())

    // /s/A and /s/A2 weigh 2 (tie broken by path), /s/B and /s/root weigh 1; /s/C is not a candidate.
    assertEquals(listOf(listOf("/s/A", "/s/A2", "/s/B", "/s/root")), lister.calls)
    assertEquals(4, listed)
    assertEquals(PRECISION, lister.precisions.single())
  }

  @Test
  fun atMost32FoldersAreListedHighestWeightFirst() = runBlocking {
    val rows = ArrayList<LocalNodeEntity>()
    val keyRows = ArrayList<RemoteMatchKeyEntity>()
    for (i in 0 until 40) {
      val folder = "f%02d".format(i)
      rows += directory("d-$folder", folder)
      rows += file("$folder-synced.jpg", parent = "d-$folder")
      rows += file("$folder-new1.jpg", parent = "d-$folder", status = "UNSYNCED")
      if (i >= 35) rows += file("$folder-new2.jpg", parent = "d-$folder", status = "UNSYNCED")
      keyRows += key("$folder-synced.jpg", "/s/$folder")
    }
    seed(*rows.toTypedArray())
    keys(*keyRows.toTypedArray())

    val listed = recheck.run(ACTIVE, STAGED, REPOSITORY, index())

    val expected = (35 until 40).map { "/s/f%02d".format(it) } + (0 until 27).map { "/s/f%02d".format(it) }
    assertEquals(RefreshRecheck.RECHECK_MAX_FOLDERS, expected.size)
    assertEquals(expected, lister.calls.single())
    assertEquals(32, listed)
  }

  @Test
  fun theBudgetKeepsTheFoldersListedSoFar() = runBlocking {
    seedFourFolders()
    lister.millisPerFolder = 8_000L
    for (folder in listOf("/s/A", "/s/B", "/s/C", "/s/D")) lister.ok(folder, remoteFile("new-${folder.last()}.jpg", 9))
    val index = index()

    val listed = recheck.run(ACTIVE, STAGED, REPOSITORY, index)

    // 0 s, 8 s and 16 s are inside the 20 s budget; at 24 s the fourth folder is not started.
    assertEquals(20_000L, RefreshRecheck.RECHECK_BUDGET_MILLIS)
    assertEquals(listOf("/s/A", "/s/B", "/s/C"), lister.listed)
    assertEquals(3, listed)
    val staged = stagedKeys()
    assertTrue(staged.containsKey("new-A.jpg") && staged.containsKey("new-B.jpg") && staged.containsKey("new-C.jpg"))
    assertFalse("a folder past the budget adds nothing", staged.containsKey("new-D.jpg"))
    assertFalse(index.containsExact("new-D.jpg", 9, MatchIndex.bucketOf(MTIME, PRECISION)))
  }

  // --- Merging ---

  @Test
  fun newKeysAreAddedAndExistingKeysAreLeftAsTheyAre() = runBlocking {
    seed(
      directory("d-album", "Album"),
      file("a1.jpg", parent = "d-album"),
      file("a2.jpg", parent = "d-album"),
      file("x1.jpg", parent = "d-album", status = "UNSYNCED"),
    )
    keys(key("a1.jpg", "/s/A", duplicates = 3), key("a2.jpg", "/s/A2", "/s/A"))
    // Both folders list a1 again and x1 for the first time; /s/A2 also lists a2.
    lister.ok("/s/A", remoteFile("a1.jpg", 10), remoteFile("x1.jpg", 10), remoteFile("x1-copy.jpg", 11))
    lister.ok("/s/A2", remoteFile("a2.jpg", 10), remoteFile("x1.jpg", 10), remoteFile("a1.jpg", 10))
    val activeBefore = activeKeys()
    val index = index()

    val listed = recheck.run(ACTIVE, STAGED, REPOSITORY, index)

    assertEquals(2, listed)
    val staged = stagedKeys()
    assertEquals("existing key unchanged", 3L, staged.getValue("a1.jpg").duplicateCount)
    assertEquals("/s/A", staged.getValue("a1.jpg").directories)
    assertEquals(1L, staged.getValue("a2.jpg").duplicateCount)
    assertEquals("/s/A2\n/s/A", staged.getValue("a2.jpg").directories)
    // A new key's directories is the folder it was first listed in.
    assertEquals("/s/A", staged.getValue("x1.jpg").directories)
    assertEquals(1L, staged.getValue("x1.jpg").duplicateCount)
    assertEquals(PRECISION, staged.getValue("x1.jpg").precisionMillis)
    assertEquals(MatchIndex.bucketOf(MTIME, PRECISION), staged.getValue("x1.jpg").bucket)
    assertEquals("/s/A", staged.getValue("x1-copy.jpg").directories)
    assertEquals(4, staged.size)
    assertEquals("the active snapshot is never written", activeBefore, activeKeys())

    // The refresh's index holds the new keys too, so the unchanged Matcher finds them.
    val bucket = MatchIndex.bucketOf(MTIME, PRECISION)
    assertTrue(index.containsExact("x1.jpg", 10, bucket))
    assertEquals(listOf("/s/A"), index.directoriesOf("x1.jpg", 10, bucket))
    assertEquals(listOf("/s/A2", "/s/A"), index.directoriesOf("a2.jpg", 10, bucket))
    assertEquals(4, index.keyCount)
  }

  @Test
  fun aFolderThatCannotBeListedAddsNothingAndTheOthersStillCount() = runBlocking {
    seedFourFolders()
    lister.unchecked("/s/A", CloudSyncErrorCode.DIRECTORY_UNREADABLE)
    lister.gone("/s/B")
    lister.ok("/s/C", remoteFile("new-C.jpg", 9))
    lister.ok("/s/D")

    val listed = recheck.run(ACTIVE, STAGED, REPOSITORY, index())

    assertEquals("only folders listed successfully count", 2, listed)
    assertTrue(stagedKeys().containsKey("new-C.jpg"))
  }

  // --- No work, no connection ---

  @Test
  fun nothingToRecheckDoesNotConnect() = runBlocking {
    seed(directory("d-album", "Album"), file("a1.jpg", parent = "d-album"), file("z1.jpg", parent = "d-album", status = "UNKNOWN", issueCode = "LOCAL_UNAVAILABLE"))
    keys(key("a1.jpg", "/s/A"))

    assertEquals(0, recheck.run(ACTIVE, STAGED, REPOSITORY, index()))
    assertTrue(lister.calls.isEmpty())
  }

  @Test
  fun noCandidateFolderDoesNotConnect() = runBlocking {
    seed(
      // No synced neighbour.
      directory("d-new", "New"),
      file("n1.jpg", parent = "d-new", status = "UNSYNCED"),
      // A synced neighbour whose key has no stored folders (a scan from before schema version 4).
      directory("d-old", "Old"),
      file("o1.jpg", parent = "d-old"),
      file("o2.jpg", parent = "d-old", status = "UNSYNCED"),
    )
    keys(key("o1.jpg"))

    assertEquals(0, recheck.run(ACTIVE, STAGED, REPOSITORY, index()))
    assertTrue(lister.calls.isEmpty())
  }

  // --- Failures never fail the refresh ---

  @Test
  fun aConnectionAuthenticationOrHostKeyFailureSkipsTheRecheck() = runBlocking {
    seedFourFolders()
    val before = stagedKeys().keys
    for (code in
      listOf(
        CloudSyncErrorCode.CONNECTION_REFUSED,
        CloudSyncErrorCode.CONNECTION_TIMEOUT,
        CloudSyncErrorCode.AUTH_FAILED,
        CloudSyncErrorCode.SFTP_HOST_KEY_UNVERIFIED,
        CloudSyncErrorCode.SFTP_HOST_KEY_CHANGED,
        CloudSyncErrorCode.CREDENTIAL_UNAVAILABLE,
      )) {
      lister.connectFailure = RemoteClientException(code, "Server rejected the session", null)

      assertEquals("$code skips the re-check", 0, recheck.run(ACTIVE, STAGED, REPOSITORY, index()))
    }
    assertEquals(before, stagedKeys().keys)
  }

  // --- Helpers ---

  private suspend fun seedFourFolders() {
    val rows = ArrayList<LocalNodeEntity>()
    for (name in listOf("A", "B", "C", "D")) {
      rows += directory("d-$name", name)
      rows += file("$name-synced.jpg", parent = "d-$name")
      rows += file("new-$name.jpg", parent = "d-$name", size = 9, status = "UNSYNCED")
    }
    seed(*rows.toTypedArray())
    keys(*listOf("A", "B", "C", "D").map { key("$it-synced.jpg", "/s/$it") }.toTypedArray())
  }

  private suspend fun seed(vararg rows: LocalNodeEntity) {
    db.localNodeDao().insertAll(rows.toList())
  }

  /** Stores [rows] in the active snapshot and copies them to the staged one, as `COPYING_REMOTE` does. */
  private suspend fun keys(vararg rows: RemoteMatchKeyEntity) {
    store.stageMatchKeys(rows.toList())
    store.copyRemoteState(ACTIVE, STAGED)
  }

  private suspend fun index(): MatchIndex = MatchIndex.fromRows(store.matchKeys(STAGED), PRECISION)

  private suspend fun stagedKeys(): Map<String, RemoteMatchKeyEntity> = store.matchKeys(STAGED).associateBy { it.name }

  private suspend fun activeKeys() =
    store.matchKeys(ACTIVE).map { listOf(it.name, it.sizeBytes, it.bucket, it.duplicateCount, it.directories) }.toSet()

  private fun file(
    name: String,
    parent: String? = null,
    source: String = SOURCE,
    size: Long = 10L,
    status: String = "SYNCED",
    issueCode: String? = null,
  ): LocalNodeEntity =
    localNode(ACTIVE, source, "e-$source-$name", name, parentId = parent, sizeBytes = size, modifiedUtcMillis = MTIME, status = status, issueCode = issueCode)
      .copy(precisionMillis = PRECISION)

  private fun directory(entryId: String, name: String): LocalNodeEntity =
    localNode(ACTIVE, SOURCE, entryId, name, kind = "DIRECTORY", sizeBytes = null, modifiedUtcMillis = null, status = "UNKNOWN")
      .copy(precisionMillis = PRECISION)

  private fun key(name: String, vararg directories: String, duplicates: Long = 1L, size: Long = 10L) =
    RemoteMatchKeyEntity(
      matchKeyId = 0,
      snapshotId = ACTIVE,
      name = name,
      sizeBytes = size,
      precisionMillis = PRECISION,
      bucket = MatchIndex.bucketOf(MTIME, PRECISION),
      duplicateCount = duplicates,
      directories = if (directories.isEmpty()) null else MatchIndex.joinDirectories(directories.toList()),
    )

  /**
   * A scripted [FolderLister]: each folder is listed once, in order, while [ListingHooks.keepGoing] allows;
   * each listing advances [clock] by [millisPerFolder]. An unscripted folder lists empty.
   */
  private class FakeLister(private val clock: AtomicLong) : FolderLister {
    val calls = mutableListOf<List<String>>()
    val precisions = mutableListOf<Long>()
    val listed = mutableListOf<String>()
    var connectFailure: RemoteClientException? = null
    var millisPerFolder = 0L
    private val scripted = HashMap<String, (Long) -> FolderListing>()

    fun ok(folder: String, vararg entries: RemoteEntry) {
      scripted[folder] = { precision -> FolderListing.Listed(MatchIndex(precision).also { index -> entries.forEach { index.add(it, folder) } }) }
    }

    fun unchecked(folder: String, code: CloudSyncErrorCode) {
      scripted[folder] = { FolderListing.Unchecked(code) }
    }

    fun gone(folder: String) {
      scripted[folder] = { FolderListing.Gone }
    }

    override suspend fun listFolders(
      repository: RepositoryConfigEntity,
      precisionMillis: Long,
      folders: List<String>,
      hooks: ListingHooks,
    ): Map<String, FolderListing> {
      calls += folders
      precisions += precisionMillis
      connectFailure?.let { throw it }
      val result = LinkedHashMap<String, FolderListing>()
      for (folder in folders.distinct()) {
        if (!hooks.keepGoing()) break
        val listing = scripted[folder]?.invoke(precisionMillis) ?: FolderListing.Listed(MatchIndex(precisionMillis))
        listed += folder
        clock.addAndGet(millisPerFolder)
        result[folder] = listing
        hooks.onListed(folder, listing)
      }
      return result
    }
  }

  private companion object {
    const val SOURCE = "src-1"
    const val OTHER_SOURCE = "src-2"
    const val ACTIVE = "snap-active"
    const val STAGED = "snap-staged"
    const val PRECISION = 1_000L

    val REPOSITORY =
      RepositoryConfigEntity(
        protocol = "SFTP",
        host = REMOTE_HOST,
        port = 2222,
        username = "alice",
        remoteRoots = "/s",
        precisionMillis = PRECISION,
        credentialVersion = 1L,
      )
  }
}
