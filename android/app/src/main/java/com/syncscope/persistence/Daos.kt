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

  /** The run with the highest generation: the running one, else the most recent. */
  @Query("SELECT * FROM scan_run ORDER BY generation DESC LIMIT 1") suspend fun latest(): ScanRunEntity?

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

  @Query("UPDATE snapshot SET remoteListedAtMillis = :remoteListedAtMillis WHERE snapshotId = :snapshotId")
  suspend fun setRemoteListedAt(snapshotId: String, remoteListedAtMillis: Long?): Int
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

  @Query("SELECT * FROM source_root WHERE canonicalRoot = :canonicalRoot")
  abstract suspend fun byCanonicalRoot(canonicalRoot: String): SourceRootEntity?

  @Query(
    "DELETE FROM local_deletion_overlay WHERE localEntryId IN (SELECT entryId FROM local_node WHERE sourceId = :sourceId)"
  )
  protected abstract suspend fun deleteDeletionOverlaysFor(sourceId: String): Int

  @Query("DELETE FROM remote_ambiguity WHERE sourceId = :sourceId")
  protected abstract suspend fun deleteAmbiguitiesFor(sourceId: String): Int

  @Query("DELETE FROM snapshot_counts WHERE sourceId = :sourceId")
  protected abstract suspend fun deleteSnapshotCountsFor(sourceId: String): Int

  @Query("DELETE FROM local_node WHERE sourceId = :sourceId")
  protected abstract suspend fun deleteLocalNodesFor(sourceId: String): Int

  @Query("DELETE FROM source_root WHERE sourceId = :sourceId")
  protected abstract suspend fun deleteById(sourceId: String): Int

  /**
   * Removal cascade (research R7, FR-005): one transaction removing the source's scan data, then
   * the row. Order matters: `local_node.sourceId` references `source_root` without a cascade, and
   * the overlay rows are found through the source's `local_node` entries. Snapshots, match keys
   * and other sources' rows are untouched. Any failure rolls every step back.
   */
  @Transaction
  open suspend fun deleteWithScanData(sourceId: String) {
    deleteDeletionOverlaysFor(sourceId)
    deleteAmbiguitiesFor(sourceId)
    deleteSnapshotCountsFor(sourceId)
    deleteLocalNodesFor(sourceId)
    deleteById(sourceId)
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

  @Query("SELECT * FROM remote_match_key WHERE snapshotId = :snapshotId")
  suspend fun forSnapshot(snapshotId: String): List<RemoteMatchKeyEntity>

  /** LOCAL_REFRESH: copies every match key of [fromSnapshotId] into [toSnapshotId] (new row IDs). */
  @Query(
    """
    INSERT INTO remote_match_key (snapshotId, name, sizeBytes, precisionMillis, bucket, duplicateCount)
    SELECT :toSnapshotId, name, sizeBytes, precisionMillis, bucket, duplicateCount
      FROM remote_match_key
     WHERE snapshotId = :fromSnapshotId
    """
  )
  suspend fun copy(fromSnapshotId: String, toSnapshotId: String)
}

@Dao
interface RemoteAmbiguityDao {
  @Insert(onConflict = OnConflictStrategy.ABORT) suspend fun insertAll(rows: List<RemoteAmbiguityEntity>)

  @Query("SELECT COUNT(*) FROM remote_ambiguity WHERE snapshotId = :snapshotId")
  suspend fun countFor(snapshotId: String): Long

  @Query("SELECT * FROM remote_ambiguity WHERE snapshotId = :snapshotId ORDER BY id")
  suspend fun forSnapshot(snapshotId: String): List<RemoteAmbiguityEntity>

  /**
   * LOCAL_REFRESH: copies the remote-scope rows ([RemoteAmbiguityEntity.SCOPE_REMOTE_DIRECTORY],
   * [RemoteAmbiguityEntity.SCOPE_REMOTE_LISTING]) of [fromSnapshotId] into [toSnapshotId]. `SOURCE` rows
   * are recomputed by the refresh, never copied. Remote-scope rows carry no match key, so none dangles.
   */
  @Query(
    """
    INSERT INTO remote_ambiguity (snapshotId, scope, sourceId, entryId, matchKeyId, reason)
    SELECT :toSnapshotId, scope, sourceId, entryId, NULL, reason
      FROM remote_ambiguity
     WHERE snapshotId = :fromSnapshotId AND scope IN ('REMOTE_DIRECTORY', 'REMOTE_LISTING')
     ORDER BY id
    """
  )
  suspend fun copyRemoteScope(fromSnapshotId: String, toSnapshotId: String)
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

  /** Every key trusted for an endpoint, whatever its algorithm. */
  @Query("SELECT * FROM trusted_sftp_host_key WHERE host = :host AND port = :port")
  abstract suspend fun forHost(host: String, port: Int): List<TrustedSftpHostKeyEntity>

  @Query(
    "DELETE FROM trusted_sftp_host_key WHERE host = :host AND port = :port AND algorithm != :algorithm"
  )
  abstract suspend fun deleteOtherAlgorithms(host: String, port: Int, algorithm: String)

  /**
   * Records an explicit user approval as the endpoint's only trusted key. Re-approving
   * after a change reuses the existing row's id, so [upsert] updates rather than
   * colliding with the unique index; keys of other algorithms are dropped so a
   * superseded key can never verify again.
   */
  @Transaction
  open suspend fun replaceEndpointKey(key: TrustedSftpHostKeyEntity) {
    deleteOtherAlgorithms(key.host, key.port, key.algorithm)
    val existing = forEndpoint(key.host, key.port, key.algorithm)
    upsert(key.copy(id = existing?.id ?: 0L))
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

  /**
   * Records discovered precision only if the row is still the [revision] that was tested,
   * so a save that lands mid-test is never overwritten. Returns the rows updated (0 or 1).
   */
  @Query("UPDATE repository_config SET precisionMillis = :precisionMillis WHERE id = 0 AND revision = :revision")
  suspend fun updatePrecision(revision: Long, precisionMillis: Long): Int
}
