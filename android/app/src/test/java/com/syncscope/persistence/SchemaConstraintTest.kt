package com.syncscope.persistence

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class SchemaConstraintTest {

  private lateinit var db: SyncScopeDatabase

  @Before
  fun setUp() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    db =
      Room.inMemoryDatabaseBuilder(context, SyncScopeDatabase::class.java)
        .allowMainThreadQueries()
        .build()
  }

  @After
  fun tearDown() {
    db.close()
  }

  @Test
  fun foreignKeysAreEnforced(): Unit = runBlocking {
    db.scanRunDao().insert(scanRun("run-1", generation = 1))
    db.snapshotDao().insert(stagingSnapshot("snap-1", "run-1"))

    // local_node rows require an existing source_root parent.
    assertThrows(android.database.sqlite.SQLiteConstraintException::class.java) {
      runBlocking {
        db.localNodeDao()
          .insertAll(listOf(localNode(snapshotId = "snap-1", sourceId = "missing-source", entryId = "e1", name = "a.txt")))
      }
    }

    // And an existing snapshot parent.
    db.sourceRootDao().upsert(sourceRoot("src-1"))
    assertThrows(android.database.sqlite.SQLiteConstraintException::class.java) {
      runBlocking {
        db.localNodeDao()
          .insertAll(listOf(localNode(snapshotId = "snap-missing", sourceId = "src-1", entryId = "e2", name = "b.txt")))
      }
    }
  }

  @Test
  fun remoteMatchKeyFullKeyIsUnique(): Unit = runBlocking {
    seedSnapshot()
    val key =
      RemoteMatchKeyEntity(
        matchKeyId = 0,
        snapshotId = "snap-1",
        name = "photo.jpg",
        sizeBytes = 42L,
        precisionMillis = 1_000L,
        bucket = 7L,
        duplicateCount = 1L,
      )
    db.remoteMatchKeyDao().insertAll(listOf(key))

    assertThrows(android.database.sqlite.SQLiteConstraintException::class.java) {
      runBlocking { db.remoteMatchKeyDao().insertAll(listOf(key.copy(duplicateCount = 5L))) }
    }
  }

  @Test
  fun trustedHostKeyAndCanonicalRootAndGenerationAreUnique() = runBlocking {
    db.trustedSftpHostKeyDao()
      .upsert(TrustedSftpHostKeyEntity(0, "example.internal", 22, "ssh-ed25519", "QUJD", "SHA256:abc", 1_000L))
    assertThrows(android.database.sqlite.SQLiteConstraintException::class.java) {
      runBlocking {
        db.trustedSftpHostKeyDao()
          .upsert(TrustedSftpHostKeyEntity(0, "example.internal", 22, "ssh-ed25519", "QUJE", "SHA256:abd", 2_000L))
      }
    }

    db.sourceRootDao().upsert(sourceRoot("src-1", canonicalRoot = "primary:Documents"))
    assertThrows(android.database.sqlite.SQLiteConstraintException::class.java) {
      runBlocking { db.sourceRootDao().upsert(sourceRoot("src-2", canonicalRoot = "primary:Documents")) }
    }

    db.scanRunDao().insert(scanRun("run-1", generation = 9))
    assertThrows(android.database.sqlite.SQLiteConstraintException::class.java) {
      runBlocking { db.scanRunDao().insert(scanRun("run-2", generation = 9)) }
    }
    Unit
  }

  @Test
  fun deletingSnapshotCascadesToAllRunData() = runBlocking {
    seedSnapshot()
    db.localNodeDao().insertAll(listOf(localNode("snap-1", "src-1", "e1", "a.txt")))
    db.remoteNodeDao()
      .insertAll(
        listOf(
          RemoteNodeEntity(0, "snap-1", null, "/root/a.txt", "a.txt", "REGULAR_FILE", 1L, 2L, 1_000L, null)
        )
      )
    db.remoteAmbiguityDao()
      .insertAll(listOf(RemoteAmbiguityEntity(0, "snap-1", "GLOBAL", null, null, null, "coverage gap")))
    db.snapshotCountsDao()
      .insertAll(listOf(SnapshotCountsEntity(0, "snap-1", null, "SYNCED", 1L)))
    db.localDeletionOverlayDao()
      .upsertAll(listOf(LocalDeletionOverlayEntity(0, "snap-1", "e1", "DELETED", 3_000L)))

    db.snapshotDao().deleteById("snap-1")

    assertEquals(0L, db.localNodeDao().countFor("snap-1"))
    assertEquals(0L, db.remoteNodeDao().countFor("snap-1"))
    assertEquals(0L, db.remoteAmbiguityDao().countFor("snap-1"))
    assertEquals(0L, db.snapshotCountsDao().forSnapshot("snap-1").size.toLong())
    assertEquals(0L, db.localDeletionOverlayDao().forSnapshot("snap-1").size.toLong())
  }

  @Test
  fun openingWrongSchemaFailsWithoutDestructiveFallback() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val name = "wrong-schema-test.db"
    context.deleteDatabase(name)
    // Create a database at the current version whose schema does not match the entities.
    context.openOrCreateDatabase(name, Context.MODE_PRIVATE, null).use { raw ->
      raw.execSQL("CREATE TABLE IF NOT EXISTS unrelated (id INTEGER PRIMARY KEY)")
      raw.version = CURRENT_SCHEMA_VERSION
    }

    val reopened =
      Room.databaseBuilder(context, SyncScopeDatabase::class.java, name)
        .allowMainThreadQueries()
        .build()

    assertThrows(IllegalStateException::class.java) {
      reopened.openHelper.writableDatabase
    }
    reopened.close()
    context.deleteDatabase(name)
  }

  private companion object {
    const val CURRENT_SCHEMA_VERSION = 2
  }

  private suspend fun seedSnapshot() {
    db.scanRunDao().insert(scanRun("run-1", generation = 1))
    db.snapshotDao().insert(stagingSnapshot("snap-1", "run-1"))
    db.sourceRootDao().upsert(sourceRoot("src-1"))
  }
}
