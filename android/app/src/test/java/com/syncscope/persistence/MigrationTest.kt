package com.syncscope.persistence

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.room.testing.MigrationTestHelper
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Schema version 1 → 2 (feature 004): `scan_run.mode` and `snapshot.remoteListedAtMillis` are added by
 * the Room auto-migration against the exported schemas, keeping every existing row and index.
 *
 * Schema version 2 → 3 (feature 005): `local_node.descSynced`, `descUnsynced` and `descUnknown` are added
 * as nullable columns; every existing row survives unchanged and reads `NULL` counts.
 *
 * Schema version 3 → 4 (feature 006): `remote_match_key.directories` (nullable) and
 * `repository_config.webdavHttps` (`NOT NULL DEFAULT 0`) are added; every existing row survives, the
 * match keys read `NULL` directories and the saved repository keeps plain HTTP.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class MigrationTest {

  @get:Rule
  val helper = MigrationTestHelper(InstrumentationRegistry.getInstrumentation(), SyncScopeDatabase::class.java)

  @Test
  fun version1RowsMigrateToVersion2WithDefaults() {
    val v1 = helper.createDatabase(DB_NAME, 1)
    v1.execSQL(
      "INSERT INTO scan_run (runId, generation, configRevision, includeHidden, phase, startedAtMillis, " +
        "finishedAtMillis, terminalState, errorCode, errorSummary) " +
        "VALUES ('run-1', 7, 3, 0, 'PUBLISHED', 1000, 2000, 'COMPLETED', NULL, NULL)",
    )
    v1.execSQL(
      "INSERT INTO snapshot (snapshotId, scanRunId, completedAtMillis, coverage, configRevision, " +
        "includeHidden, publishable) VALUES ('snap-1', 'run-1', 2000, 'INCOMPLETE', 3, 0, 1)",
    )
    val indicesBefore = indices(v1)
    v1.close()

    val v2 = helper.runMigrationsAndValidate(DB_NAME, 2, true)

    val mode = column(v2, "scan_run", "mode")
    assertEquals("TEXT", mode.type)
    assertTrue("scan_run.mode must be NOT NULL", mode.notNull)
    val listedAt = column(v2, "snapshot", "remoteListedAtMillis")
    assertEquals("INTEGER", listedAt.type)
    assertTrue("snapshot.remoteListedAtMillis must be nullable", !listedAt.notNull)

    v2.query(
        "SELECT runId, generation, configRevision, includeHidden, phase, startedAtMillis, finishedAtMillis, " +
          "terminalState, errorCode, errorSummary, mode FROM scan_run",
      )
      .use { c ->
        assertEquals(1, c.count)
        c.moveToFirst()
        assertEquals("run-1", c.getString(0))
        assertEquals(7L, c.getLong(1))
        assertEquals(3L, c.getLong(2))
        assertEquals(0, c.getInt(3))
        assertEquals("PUBLISHED", c.getString(4))
        assertEquals(1000L, c.getLong(5))
        assertEquals(2000L, c.getLong(6))
        assertEquals("COMPLETED", c.getString(7))
        assertTrue(c.isNull(8))
        assertTrue(c.isNull(9))
        assertEquals("FULL", c.getString(10))
      }
    v2.query(
        "SELECT snapshotId, scanRunId, completedAtMillis, coverage, configRevision, includeHidden, " +
          "publishable, remoteListedAtMillis FROM snapshot",
      )
      .use { c ->
        assertEquals(1, c.count)
        c.moveToFirst()
        assertEquals("snap-1", c.getString(0))
        assertEquals("run-1", c.getString(1))
        assertEquals(2000L, c.getLong(2))
        assertEquals("INCOMPLETE", c.getString(3))
        assertEquals(3L, c.getLong(4))
        assertEquals(0, c.getInt(5))
        assertEquals(1, c.getInt(6))
        assertTrue(c.isNull(7))
      }
    assertEquals(indicesBefore, indices(v2))
    v2.close()
  }

  @Test
  fun version2RowsMigrateToVersion3WithNullDescendantCounts() {
    val v2 = helper.createDatabase(DB_NAME, 2)
    v2.execSQL(
      "INSERT INTO scan_run (runId, generation, configRevision, includeHidden, phase, startedAtMillis, " +
        "finishedAtMillis, terminalState, errorCode, errorSummary, mode) " +
        "VALUES ('run-1', 7, 3, 0, 'PUBLISHED', 1000, 2000, 'COMPLETED', NULL, NULL, 'FULL')",
    )
    v2.execSQL(
      "INSERT INTO snapshot (snapshotId, scanRunId, completedAtMillis, coverage, configRevision, " +
        "includeHidden, publishable, remoteListedAtMillis) VALUES ('snap-1', 'run-1', 2000, 'COMPLETE', 3, 0, 1, 1500)",
    )
    v2.execSQL(
      "INSERT INTO source_root (sourceId, treeUri, authority, volumeId, documentPath, canonicalRoot, alias, " +
        "canWrite, addedAtMillis) VALUES ('src-1', 'content://tree/1', 'auth', 'primary', 'DCIM', " +
        "'primary:DCIM', 'DCIM', 1, 10)",
    )
    v2.execSQL(
      "INSERT INTO local_node (entryId, snapshotId, sourceId, parentId, kind, documentUri, documentId, name, " +
        "mimeType, sizeBytes, modifiedUtcMillis, precisionMillis, status, issueCode) VALUES " +
        "('dir-1', 'snap-1', 'src-1', NULL, 'DIRECTORY', 'content://doc/dir', 'doc-dir', 'album', " +
        "NULL, NULL, NULL, 1000, 'UNSYNCED', NULL)",
    )
    v2.execSQL(
      "INSERT INTO local_node (entryId, snapshotId, sourceId, parentId, kind, documentUri, documentId, name, " +
        "mimeType, sizeBytes, modifiedUtcMillis, precisionMillis, status, issueCode) VALUES " +
        "('file-1', 'snap-1', 'src-1', 'dir-1', 'FILE', 'content://doc/file', 'doc-file', 'a.png', " +
        "'image/png', 70, 1704067200000, 1000, 'UNSYNCED', 'LOCAL_UNAVAILABLE')",
    )
    val rowsBefore = localNodeRows(v2, V2_LOCAL_NODE_COLUMNS)
    val indicesBefore = indices(v2)
    v2.close()

    val v3 = helper.runMigrationsAndValidate(DB_NAME, 3, true)

    for (name in listOf("descSynced", "descUnsynced", "descUnknown")) {
      val col = column(v3, "local_node", name)
      assertEquals("local_node.$name type", "INTEGER", col.type)
      assertTrue("local_node.$name must be nullable", !col.notNull)
    }
    assertEquals(rowsBefore, localNodeRows(v3, V2_LOCAL_NODE_COLUMNS))
    v3.query("SELECT entryId, descSynced, descUnsynced, descUnknown FROM local_node ORDER BY entryId").use { c ->
      assertEquals(2, c.count)
      while (c.moveToNext()) {
        assertTrue("${c.getString(0)}.descSynced", c.isNull(1))
        assertTrue("${c.getString(0)}.descUnsynced", c.isNull(2))
        assertTrue("${c.getString(0)}.descUnknown", c.isNull(3))
      }
    }
    assertEquals(indicesBefore, indices(v3))
    v3.close()
  }

  @Test
  fun version3RowsMigrateToVersion4WithNullDirectoriesAndPlainHttp() {
    val v3 = helper.createDatabase(DB_NAME, 3)
    v3.execSQL(
      "INSERT INTO scan_run (runId, generation, configRevision, includeHidden, phase, startedAtMillis, " +
        "finishedAtMillis, terminalState, errorCode, errorSummary, mode) " +
        "VALUES ('run-1', 7, 3, 0, 'PUBLISHED', 1000, 2000, 'COMPLETED', NULL, NULL, 'FULL')",
    )
    v3.execSQL(
      "INSERT INTO snapshot (snapshotId, scanRunId, completedAtMillis, coverage, configRevision, " +
        "includeHidden, publishable, remoteListedAtMillis) VALUES ('snap-1', 'run-1', 2000, 'COMPLETE', 3, 0, 1, 1500)",
    )
    v3.execSQL(
      "INSERT INTO remote_match_key (matchKeyId, snapshotId, name, sizeBytes, precisionMillis, bucket, " +
        "duplicateCount) VALUES (1, 'snap-1', 'a.png', 70, 1000, 1704067200, 2)",
    )
    v3.execSQL(
      "INSERT INTO remote_match_key (matchKeyId, snapshotId, name, sizeBytes, precisionMillis, bucket, " +
        "duplicateCount) VALUES (2, 'snap-1', 'b.png', 71, 1000, 1704067201, 1)",
    )
    v3.execSQL(
      "INSERT INTO repository_config (id, protocol, host, port, username, remoteRoot, precisionMillis, " +
        "credentialVersion, revision) VALUES (0, 'WEBDAV', 'nas.local', 80, 'me', '/backup', 1000, 4, 2)",
    )
    val keysBefore = rows(v3, "remote_match_key", V3_MATCH_KEY_COLUMNS, "matchKeyId")
    val repositoryBefore = rows(v3, "repository_config", V3_REPOSITORY_COLUMNS, "id")
    val snapshotsBefore = rows(v3, "snapshot", listOf("snapshotId", "configRevision", "remoteListedAtMillis"), "snapshotId")
    val indicesBefore = indices(v3)
    v3.close()

    val v4 = helper.runMigrationsAndValidate(DB_NAME, 4, true)

    val directories = column(v4, "remote_match_key", "directories")
    assertEquals("TEXT", directories.type)
    assertTrue("remote_match_key.directories must be nullable", !directories.notNull)
    val https = column(v4, "repository_config", "webdavHttps")
    assertEquals("INTEGER", https.type)
    assertTrue("repository_config.webdavHttps must be NOT NULL", https.notNull)

    assertEquals(keysBefore, rows(v4, "remote_match_key", V3_MATCH_KEY_COLUMNS, "matchKeyId"))
    assertEquals(repositoryBefore, rows(v4, "repository_config", V3_REPOSITORY_COLUMNS, "id"))
    assertEquals(
      snapshotsBefore,
      rows(v4, "snapshot", listOf("snapshotId", "configRevision", "remoteListedAtMillis"), "snapshotId"),
    )
    v4.query("SELECT matchKeyId, directories FROM remote_match_key ORDER BY matchKeyId").use { c ->
      assertEquals(2, c.count)
      while (c.moveToNext()) assertTrue("key ${c.getLong(0)} directories", c.isNull(1))
    }
    v4.query("SELECT webdavHttps FROM repository_config").use { c ->
      assertEquals(1, c.count)
      c.moveToFirst()
      assertEquals(0, c.getInt(0))
    }
    assertEquals(indicesBefore, indices(v4))
    v4.close()
  }

  @Test
  fun migratedDatabaseOpensWithRoomAndReadsTheEntities(): Unit = runBlocking {
    helper.createDatabase(DB_NAME, 1).apply {
      execSQL(
        "INSERT INTO scan_run (runId, generation, configRevision, includeHidden, phase, startedAtMillis, " +
          "finishedAtMillis, terminalState, errorCode, errorSummary) " +
          "VALUES ('run-1', 1, 1, 0, 'PUBLISHED', 1000, 2000, 'COMPLETED', NULL, NULL)",
      )
      close()
    }
    val context = ApplicationProvider.getApplicationContext<Context>()
    val db = Room.databaseBuilder(context, SyncScopeDatabase::class.java, DB_NAME).allowMainThreadQueries().build()
    try {
      val run = db.scanRunDao().byId("run-1")!!
      assertEquals("FULL", run.mode)
    } finally {
      db.close()
    }
  }

  @Test
  fun unknownVersionFailsInsteadOfFallingBackDestructively() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val file = context.getDatabasePath(UNKNOWN_DB_NAME)
    file.parentFile?.mkdirs()
    SQLiteDatabase.openOrCreateDatabase(file, null).use { raw ->
      raw.execSQL("CREATE TABLE keep_me (id INTEGER PRIMARY KEY)")
      raw.execSQL("INSERT INTO keep_me (id) VALUES (1)")
      raw.version = 99
    }

    val db = Room.databaseBuilder(context, SyncScopeDatabase::class.java, UNKNOWN_DB_NAME).build()
    assertThrows(IllegalStateException::class.java) { db.openHelper.writableDatabase }
    db.close()

    // Nothing was wiped: the unknown database is left exactly as it was.
    SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READONLY).use { raw ->
      assertEquals(99, raw.version)
      raw.rawQuery("SELECT COUNT(*) FROM keep_me", null).use { c ->
        c.moveToFirst()
        assertEquals(1, c.getInt(0))
      }
    }
  }

  /** Every local_node row as a map of the given columns, ordered by entryId. */
  private fun localNodeRows(db: SupportSQLiteDatabase, columns: List<String>): List<Map<String, Any?>> =
    rows(db, "local_node", columns, "entryId")

  /** Every row of [table] as a map of the given columns, ordered by [orderBy]. */
  private fun rows(
    db: SupportSQLiteDatabase,
    table: String,
    columns: List<String>,
    orderBy: String,
  ): List<Map<String, Any?>> {
    val out = mutableListOf<Map<String, Any?>>()
    db.query("SELECT ${columns.joinToString()} FROM $table ORDER BY $orderBy").use { c ->
      while (c.moveToNext()) {
        out +=
          columns.indices.associate { i ->
            columns[i] to
              when {
                c.isNull(i) -> null
                c.getType(i) == android.database.Cursor.FIELD_TYPE_INTEGER -> c.getLong(i)
                else -> c.getString(i)
              }
          }
      }
    }
    return out
  }

  private data class ColumnInfo(val type: String, val notNull: Boolean)

  private fun column(db: SupportSQLiteDatabase, table: String, name: String): ColumnInfo {
    db.query("PRAGMA table_info(`$table`)").use { c ->
      val nameIdx = c.getColumnIndexOrThrow("name")
      while (c.moveToNext()) {
        if (c.getString(nameIdx) == name) {
          return ColumnInfo(
            type = c.getString(c.getColumnIndexOrThrow("type")),
            notNull = c.getInt(c.getColumnIndexOrThrow("notnull")) == 1,
          )
        }
      }
    }
    throw AssertionError("$table.$name is missing")
  }

  /** Every index as (name, table, sql), so a changed definition is caught, not just a renamed one. */
  private fun indices(db: SupportSQLiteDatabase): Set<Triple<String, String, String?>> {
    val out = mutableSetOf<Triple<String, String, String?>>()
    db.query(
        "SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_autoindex%'",
      )
      .use { c ->
        while (c.moveToNext()) {
          out += Triple(c.getString(0), c.getString(1), if (c.isNull(2)) null else c.getString(2))
        }
      }
    assertNull(out.firstOrNull { it.first.isBlank() })
    return out
  }

  private companion object {
    const val DB_NAME = "migration-test.db"
    const val UNKNOWN_DB_NAME = "migration-test-unknown.db"
    val V2_LOCAL_NODE_COLUMNS =
      listOf(
        "entryId", "snapshotId", "sourceId", "parentId", "kind", "documentUri", "documentId", "name",
        "mimeType", "sizeBytes", "modifiedUtcMillis", "precisionMillis", "status", "issueCode",
      )
    val V3_MATCH_KEY_COLUMNS =
      listOf("matchKeyId", "snapshotId", "name", "sizeBytes", "precisionMillis", "bucket", "duplicateCount")
    val V3_REPOSITORY_COLUMNS =
      listOf(
        "id", "protocol", "host", "port", "username", "remoteRoot", "precisionMillis", "credentialVersion", "revision",
      )
  }
}
