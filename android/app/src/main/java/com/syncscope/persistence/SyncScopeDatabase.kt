package com.syncscope.persistence

import android.content.Context
import androidx.room.AutoMigration
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

/**
 * The scan store. Every version exports its schema to `app/schemas/`; version 2 (feature 004) adds
 * `scan_run.mode` and `snapshot.remoteListedAtMillis` through an auto-migration, and version 3 (feature 005)
 * adds the nullable `local_node.descSynced`/`descUnsynced`/`descUnknown` directory counts the same way. There is
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
  version = 3,
  exportSchema = true,
  autoMigrations = [AutoMigration(from = 1, to = 2), AutoMigration(from = 2, to = 3)],
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
