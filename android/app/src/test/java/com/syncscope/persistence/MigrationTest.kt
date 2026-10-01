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
  }
}
