package com.syncscope.persistence

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.RawQuery
import androidx.room.Transaction
import androidx.room.Update
import androidx.sqlite.db.SupportSQLiteQuery

/**
 * Inserts use ABORT everywhere: uniqueness and foreign-key violations are
 * real defects that must surface as SQLiteConstraintException, never be
 * silently replaced or ignored.
 */

@Dao
interface ScanRunDao {
  @Insert(onConflict = OnConflictStrategy.ABORT) suspend fun insert(run: ScanRunEntity)

  @Update suspend fun update(run: ScanRunEntity)

  @Query("SELECT * FROM scan_run WHERE runId = :runId") suspend fun byId(runId: String): ScanRunEntity?

  @Query("SELECT * FROM scan_run WHERE terminalState IS NULL")
  suspend fun nonTerminal(): List<ScanRunEntity>

  @Query("SELECT MAX(generation) FROM scan_run") suspend fun maxGeneration(): Long?

  @Query(
    """
    UPDATE scan_run
       SET terminalState = :terminalState,
           finishedAtMillis = :finishedAtMillis,
           errorCode = :errorCode,
           errorSummary = :errorSummary,
           phase = :phase
     WHERE runId = :runId AND terminalState IS NULL
    """
  )
  suspend fun markTerminal(
    runId: String,
    terminalState: String,
    finishedAtMillis: Long,
    errorCode: String?,
    errorSummary: String?,
    phase: String,
  ): Int
}

@Dao
interface SnapshotDao {
  @Insert(onConflict = OnConflictStrategy.ABORT) suspend fun insert(snapshot: SnapshotEntity)

  @Query("SELECT * FROM snapshot WHERE snapshotId = :snapshotId")
  suspend fun byId(snapshotId: String): SnapshotEntity?

  @Query("SELECT * FROM snapshot WHERE scanRunId = :runId") suspend fun forRun(runId: String): SnapshotEntity?

  @Query("DELETE FROM snapshot WHERE snapshotId = :snapshotId") suspend fun deleteById(snapshotId: String): Int

  @Query("DELETE FROM snapshot WHERE scanRunId = :runId") suspend fun deleteForRun(runId: String): Int

  @Query(
    "UPDATE snapshot SET publishable = 1, completedAtMillis = :completedAtMillis WHERE snapshotId = :snapshotId"
  )
  suspend fun markPublishable(snapshotId: String, completedAtMillis: Long): Int
}

@Dao
abstract class SourceRootDao {
  @Insert(onConflict = OnConflictStrategy.ABORT) abstract suspend fun insert(root: SourceRootEntity)

  @Update abstract suspend fun update(root: SourceRootEntity)

  @Query("SELECT * FROM source_root WHERE sourceId = :sourceId")
  abstract suspend fun byId(sourceId: String): SourceRootEntity?

  @Query("SELECT * FROM source_root ORDER BY addedAtMillis") abstract suspend fun all(): List<SourceRootEntity>

  /**
   * Upsert keyed on the primary key only. A collision on the unique
   * `canonicalRoot` index belongs to a *different* sourceId and is a real
   * conflict, so it is allowed to propagate.
   */
  @Transaction
  open suspend fun upsert(root: SourceRootEntity) {
    if (byId(root.sourceId) == null) insert(root) else update(root)
  }
}

@Dao
interface LocalNodeDao {
  @Insert(onConflict = OnConflictStrategy.ABORT) suspend fun insertAll(nodes: List<LocalNodeEntity>)

  @Query("SELECT COUNT(*) FROM local_node WHERE snapshotId = :snapshotId")
  suspend fun countFor(snapshotId: String): Long

  @Query(
    "SELECT status AS status, COUNT(*) AS count FROM local_node WHERE snapshotId = :snapshotId AND kind = 'FILE' GROUP BY status"
  )
  suspend fun statusCounts(snapshotId: String): List<StatusCount>

  @RawQuery suspend fun page(query: SupportSQLiteQuery): List<LocalNodeEntity>
}

/** Row projection for grouped status totals. */
data class StatusCount(val status: String, val count: Long)

@Dao
interface RemoteNodeDao {
  @Insert(onConflict = OnConflictStrategy.ABORT) suspend fun insertAll(nodes: List<RemoteNodeEntity>)

  @Query("SELECT COUNT(*) FROM remote_node WHERE snapshotId = :snapshotId")
  suspend fun countFor(snapshotId: String): Long
}

@Dao
interface RemoteMatchKeyDao {
  @Insert(onConflict = OnConflictStrategy.ABORT) suspend fun insertAll(keys: List<RemoteMatchKeyEntity>)

  @Query("SELECT COUNT(*) FROM remote_match_key WHERE snapshotId = :snapshotId")
  suspend fun countFor(snapshotId: String): Long

  @Query(
    "SELECT * FROM remote_match_key WHERE snapshotId = :snapshotId AND name = :name AND sizeBytes = :sizeBytes"
  )
  suspend fun candidates(snapshotId: String, name: String, sizeBytes: Long): List<RemoteMatchKeyEntity>
}

@Dao
interface RemoteAmbiguityDao {
  @Insert(onConflict = OnConflictStrategy.ABORT) suspend fun insertAll(rows: List<RemoteAmbiguityEntity>)

  @Query("SELECT COUNT(*) FROM remote_ambiguity WHERE snapshotId = :snapshotId")
  suspend fun countFor(snapshotId: String): Long
}

@Dao
interface SnapshotCountsDao {
  @Insert(onConflict = OnConflictStrategy.ABORT) suspend fun insertAll(rows: List<SnapshotCountsEntity>)

  @Query("SELECT * FROM snapshot_counts WHERE snapshotId = :snapshotId")
  suspend fun forSnapshot(snapshotId: String): List<SnapshotCountsEntity>
}

@Dao
abstract class LocalDeletionOverlayDao {
  @Insert(onConflict = OnConflictStrategy.ABORT)
  abstract suspend fun insertAll(rows: List<LocalDeletionOverlayEntity>)

  @Update abstract suspend fun update(row: LocalDeletionOverlayEntity)

  @Query("SELECT * FROM local_deletion_overlay WHERE id = :id")
  abstract suspend fun byId(id: Long): LocalDeletionOverlayEntity?

  @Query("SELECT * FROM local_deletion_overlay WHERE snapshotId = :snapshotId")
  abstract suspend fun forSnapshot(snapshotId: String): List<LocalDeletionOverlayEntity>

  @Transaction
  open suspend fun upsertAll(rows: List<LocalDeletionOverlayEntity>) {
    val inserts = mutableListOf<LocalDeletionOverlayEntity>()
    for (row in rows) {
      if (row.id != 0L && byId(row.id) != null) update(row) else inserts += row
    }
    if (inserts.isNotEmpty()) insertAll(inserts)
  }
}

@Dao
abstract class TrustedSftpHostKeyDao {
  @Insert(onConflict = OnConflictStrategy.ABORT)
  abstract suspend fun insert(key: TrustedSftpHostKeyEntity)

  @Update abstract suspend fun update(key: TrustedSftpHostKeyEntity)

  @Query("SELECT * FROM trusted_sftp_host_key WHERE id = :id")
  abstract suspend fun byId(id: Long): TrustedSftpHostKeyEntity?

  @Query(
    "SELECT * FROM trusted_sftp_host_key WHERE host = :host AND port = :port AND algorithm = :algorithm"
  )
  abstract suspend fun forEndpoint(host: String, port: Int, algorithm: String): TrustedSftpHostKeyEntity?

  /**
   * Keyed on the primary key. A second key for an endpoint that is already
   * trusted is a host-key change, not an update: it must surface as a
   * constraint violation so the user is asked to approve it explicitly.
   */
  @Transaction
  open suspend fun upsert(key: TrustedSftpHostKeyEntity) {
    if (key.id != 0L && byId(key.id) != null) update(key) else insert(key)
  }
}

@Dao
interface ActiveSnapshotDao {
  @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun put(pointer: ActiveSnapshotEntity)

  @Query("SELECT * FROM active_snapshot WHERE id = 0") suspend fun get(): ActiveSnapshotEntity?
}

@Dao
interface RepositoryConfigDao {
  @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun put(config: RepositoryConfigEntity)

  @Query("SELECT * FROM repository_config WHERE id = 0") suspend fun get(): RepositoryConfigEntity?
}
