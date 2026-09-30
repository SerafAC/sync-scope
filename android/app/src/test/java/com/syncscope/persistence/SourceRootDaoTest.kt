package com.syncscope.persistence

import android.content.Context
import android.database.sqlite.SQLiteException
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class SourceRootDaoTest {

  private lateinit var db: SyncScopeDatabase
  private lateinit var dao: SourceRootDao

  @Before
  fun setUp() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    db =
      Room.inMemoryDatabaseBuilder(context, SyncScopeDatabase::class.java)
        .allowMainThreadQueries()
        .build()
    dao = db.sourceRootDao()
  }

  @After
  fun tearDown() {
    db.close()
  }

  @Test
  fun deleteWithScanDataRemovesOnlyTheSourcesRows() = runBlocking {
    seed()

    dao.deleteWithScanData("src-a")

    assertNull(dao.byId("src-a"))
    assertNotNull(dao.byId("src-b"))
    assertEquals(listOf("b1", "b2"), ids("SELECT entryId FROM local_node ORDER BY entryId"))
    assertEquals(listOf("b1"), ids("SELECT localEntryId FROM local_deletion_overlay ORDER BY localEntryId"))
    assertEquals(
      listOf("SNAPSHOT:", "SOURCE:src-b"),
      ids("SELECT scope || ':' || IFNULL(sourceId, '') FROM remote_ambiguity ORDER BY scope, sourceId"),
    )
    assertEquals(
      listOf(":SYNCED", "src-b:SYNCED"),
      ids("SELECT IFNULL(sourceId, '') || ':' || status FROM snapshot_counts ORDER BY sourceId"),
    )
    // Snapshots and match keys are not per-source and stay.
    assertEquals(listOf("snap-1", "snap-2"), ids("SELECT snapshotId FROM snapshot ORDER BY snapshotId"))
    assertEquals(1L, db.remoteMatchKeyDao().countFor("snap-1"))
  }

  @Test
  fun deleteWithScanDataRollsBackWhenAStepFails() = runBlocking {
    seed()
    // Fail the last step (the source_root delete) after the child rows have been deleted.
    db.openHelper.writableDatabase.execSQL(
      "CREATE TRIGGER fail_source_delete BEFORE DELETE ON source_root BEGIN SELECT RAISE(ABORT, 'boom'); END"
    )

    assertThrows(SQLiteException::class.java) { runBlocking { dao.deleteWithScanData("src-a") } }

    assertNotNull(dao.byId("src-a"))
    assertEquals(listOf("a1", "a2", "a3", "b1", "b2"), ids("SELECT entryId FROM local_node ORDER BY entryId"))
    assertEquals(
      listOf("a1", "a3", "b1"),
      ids("SELECT localEntryId FROM local_deletion_overlay ORDER BY localEntryId"),
    )
    assertEquals(3L, count("remote_ambiguity"))
    assertEquals(3L, count("snapshot_counts"))
  }

  @Test
  fun deleteWithScanDataOnASourceWithoutScanData() = runBlocking {
    dao.insert(sourceRoot("src-a"))
    dao.deleteWithScanData("src-a")
    assertNull(dao.byId("src-a"))
  }

  @Test
  fun byCanonicalRootFindsAnExactMatch() = runBlocking {
    dao.insert(sourceRoot("src-a", canonicalRoot = "com.android.externalstorage.documents/primary:DCIM"))
    dao.insert(sourceRoot("src-b", canonicalRoot = "com.android.externalstorage.documents/primary:DCIM/Camera"))

    assertEquals("src-a", dao.byCanonicalRoot("com.android.externalstorage.documents/primary:DCIM")?.sourceId)
    assertEquals(
      "src-b",
      dao.byCanonicalRoot("com.android.externalstorage.documents/primary:DCIM/Camera")?.sourceId,
    )
    assertNull(dao.byCanonicalRoot("com.android.externalstorage.documents/primary:DCI"))
    assertNull(dao.byCanonicalRoot("com.android.externalstorage.documents/primary:dcim"))
  }

  /**
   * Two snapshots; source A has nodes in both, source B in the first only. Every per-source table
   * gets rows for both sources plus snapshot-wide rows that no source removal may touch.
   */
  private suspend fun seed() {
    db.scanRunDao().insert(scanRun("run-1", 1L))
    db.snapshotDao().insert(stagingSnapshot("snap-1", "run-1"))
    db.scanRunDao().insert(scanRun("run-2", 2L))
    db.snapshotDao().insert(stagingSnapshot("snap-2", "run-2"))
    dao.insert(sourceRoot("src-a"))
    dao.insert(sourceRoot("src-b"))

    db.localNodeDao().insertAll(
      listOf(
        localNode("snap-1", "src-a", "a1", "one.jpg"),
        localNode("snap-1", "src-a", "a2", "two.jpg"),
        localNode("snap-2", "src-a", "a3", "three.jpg"),
        localNode("snap-1", "src-b", "b1", "one.jpg"),
        localNode("snap-2", "src-b", "b2", "four.jpg"),
      )
    )
    db.localDeletionOverlayDao().insertAll(
      listOf(
        LocalDeletionOverlayEntity(0, "snap-1", "a1", "PENDING", 1L),
        LocalDeletionOverlayEntity(0, "snap-2", "a3", "DONE", 1L),
        LocalDeletionOverlayEntity(0, "snap-1", "b1", "PENDING", 1L),
      )
    )
    db.remoteAmbiguityDao().insertAll(
      listOf(
        RemoteAmbiguityEntity(0, "snap-1", "SOURCE", "src-a", null, null, "r"),
        RemoteAmbiguityEntity(0, "snap-1", "SOURCE", "src-b", null, null, "r"),
        RemoteAmbiguityEntity(0, "snap-1", "SNAPSHOT", null, null, null, "r"),
      )
    )
    db.snapshotCountsDao().insertAll(
      listOf(
        SnapshotCountsEntity(0, "snap-1", "src-a", "SYNCED", 2L),
        SnapshotCountsEntity(0, "snap-1", "src-b", "SYNCED", 1L),
        SnapshotCountsEntity(0, "snap-1", null, "SYNCED", 3L),
      )
    )
    db.remoteMatchKeyDao().insertAll(listOf(RemoteMatchKeyEntity(0, "snap-1", "one.jpg", 10L, 1L, 2L, 1L)))
  }

  private fun ids(sql: String): List<String> =
    db.openHelper.readableDatabase.query(sql).use { c ->
      buildList { while (c.moveToNext()) add(c.getString(0)) }
    }

  private fun count(table: String): Long =
    db.openHelper.readableDatabase.query("SELECT COUNT(*) FROM $table").use { c ->
      c.moveToFirst()
      c.getLong(0)
    }
}
