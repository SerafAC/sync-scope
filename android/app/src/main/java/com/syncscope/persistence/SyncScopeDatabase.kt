package com.syncscope.persistence

import android.content.Context
import androidx.room.AutoMigration
import androidx.room.Database
import androidx.room.RenameColumn
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.AutoMigrationSpec
import androidx.sqlite.db.SupportSQLiteDatabase

/**
 * The scan store. Every version exports its schema to `app/schemas/`; version 2 (feature 004) adds
 * `scan_run.mode` and `snapshot.remoteListedAtMillis` through an auto-migration, and version 3 (feature 005)
 * adds the nullable `local_node.descSynced`/`descUnsynced`/`descUnknown` directory counts the same way.
 * Version 4 (feature 006) adds the nullable `remote_match_key.directories` and
 * `repository_config.webdavHttps` (default `0`) the same way. Version 5 (feature 007) renames
 * `repository_config.remoteRoot` to `remoteRoots`, adds `local_node.sortName` with the
 * `(snapshotId, kind, sizeBytes)` and `(snapshotId, kind, sortName)` indexes, and adds the nullable
 * `remote_ambiguity.remotePath`, through [Migration4To5]. There is
 * deliberately no destructive-migration fallback, so an unexpected on-disk
 * schema fails loudly instead of silently deleting a user's scan history.
 */
@Database(
  entities = [
    ScanRunEntity::class,
    SnapshotEntity::class,
    SourceRootEntity::class,
    LocalNodeEntity::class,
    RemoteNodeEntity::class,
    RemoteMatchKeyEntity::class,
    RemoteAmbiguityEntity::class,
    SnapshotCountsEntity::class,
    LocalDeletionOverlayEntity::class,
    TrustedSftpHostKeyEntity::class,
    RepositoryConfigEntity::class,
    ActiveSnapshotEntity::class,
  ],
  version = 5,
  exportSchema = true,
  autoMigrations = [
    AutoMigration(from = 1, to = 2),
    AutoMigration(from = 2, to = 3),
    AutoMigration(from = 3, to = 4),
    AutoMigration(from = 4, to = 5, spec = Migration4To5::class),
  ],
)
abstract class SyncScopeDatabase : RoomDatabase() {
  abstract fun scanRunDao(): ScanRunDao

  abstract fun snapshotDao(): SnapshotDao

  abstract fun sourceRootDao(): SourceRootDao

  abstract fun localNodeDao(): LocalNodeDao

  abstract fun remoteNodeDao(): RemoteNodeDao

  abstract fun remoteMatchKeyDao(): RemoteMatchKeyDao

  abstract fun remoteAmbiguityDao(): RemoteAmbiguityDao

  abstract fun snapshotCountsDao(): SnapshotCountsDao

  abstract fun localDeletionOverlayDao(): LocalDeletionOverlayDao

  abstract fun trustedSftpHostKeyDao(): TrustedSftpHostKeyDao

  abstract fun activeSnapshotDao(): ActiveSnapshotDao

  abstract fun repositoryConfigDao(): RepositoryConfigDao

  companion object {
    const val DATABASE_NAME: String = "syncscope.db"

    @Volatile private var instance: SyncScopeDatabase? = null

    /** Process-wide singleton. No destructive fallback, by contract. */
    fun get(context: Context): SyncScopeDatabase =
      instance
        ?: synchronized(this) {
          instance
            ?: Room.databaseBuilder(
                context.applicationContext,
                SyncScopeDatabase::class.java,
                DATABASE_NAME,
              )
              .build()
              .also { instance = it }
        }
  }
}

/**
 * Schema 4 → 5 (feature 007, research R18): the single remote folder becomes the `\n`-separated
 * `remoteRoots` list (one element), and every existing `local_node` row gets a `sortName` from the prefix rule
 * on `lower(name)`. SQLite folds ASCII only, so accents are not folded here; the next scan or `LOCAL_REFRESH`
 * rewrites every row with `SortName.of` (research R2).
 */
@RenameColumn(tableName = "repository_config", fromColumnName = "remoteRoot", toColumnName = "remoteRoots")
class Migration4To5 : AutoMigrationSpec {
  override fun onPostMigrate(db: SupportSQLiteDatabase) {
    db.execSQL(
      "UPDATE local_node SET sortName = " +
        "CASE WHEN substr(lower(name), 1, 1) BETWEEN 'a' AND 'z' THEN '1' ELSE '0' END || lower(name)",
    )
  }
}
