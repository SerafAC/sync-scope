package com.syncscope.persistence

import androidx.room.Dao
import androidx.room.Embedded
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.RawQuery
import androidx.room.Transaction
import androidx.room.Update
import androidx.sqlite.db.SimpleSQLiteQuery
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

  @Query("UPDATE snapshot SET coverage = :coverage WHERE snapshotId = :snapshotId")
  suspend fun setCoverage(snapshotId: String, coverage: String): Int

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

  /** Grouped `FILE` totals; built by [statusCounts], which owns the scope rules. */
  @RawQuery suspend fun statusCountsRaw(query: SupportSQLiteQuery): List<StatusCount>

  @RawQuery suspend fun page(query: SupportSQLiteQuery): List<LocalNodeEntity>

  /** A browse page: each row plus its `nameInOtherSource` probe (`0` for LIST reads). */
  @RawQuery suspend fun rows(query: SupportSQLiteQuery): List<LocalNodeRow>

  /**
   * "Select all" rows: `SELECT entryId, sizeBytes, status, mimeType LIKE 'image/%' AS isImage`, scoped by
   * [SnapshotStore]'s shared where-clause builder (contracts/cloudsync-mvp.md "listSelectableEntries").
   */
  @RawQuery suspend fun selectable(query: SupportSQLiteQuery): List<SelectableRow>

  @Query("SELECT precisionMillis FROM local_node WHERE snapshotId = :snapshotId LIMIT 1")
  suspend fun anyPrecision(snapshotId: String): Long?

  /** One row of [snapshotId] by its entry ID; null when it does not exist (or was removed by a deletion). */
  @Query("SELECT * FROM local_node WHERE snapshotId = :snapshotId AND entryId = :entryId")
  suspend fun byEntry(snapshotId: String, entryId: String): LocalNodeEntity?

  /** The `FILE` rows of [snapshotId] among [entryIds] (at most a few hundred per call). */
  @Query("SELECT * FROM local_node WHERE snapshotId = :snapshotId AND kind = 'FILE' AND entryId IN (:entryIds)")
  suspend fun filesByEntry(snapshotId: String, entryIds: List<String>): List<LocalNodeEntity>

  /** The parent entry ID of a row; null for a direct child of its source root or an unknown entry. */
  @Query("SELECT parentId FROM local_node WHERE snapshotId = :snapshotId AND entryId = :entryId")
  suspend fun parentOf(snapshotId: String, entryId: String): String?

  /** Deletion write rule step 1 (data-model): removes one `FILE` row; returns the number removed (0 or 1). */
  @Query("DELETE FROM local_node WHERE snapshotId = :snapshotId AND entryId = :entryId AND kind = 'FILE'")
  suspend fun deleteFile(snapshotId: String, entryId: String): Int

  /**
   * Deletion write rule step 3: takes one file of [status] off the descendant count of each directory in
   * [directoryIds]. Pre-v3 `NULL` counts stay `NULL` (`NULL - 1` is `NULL`).
   */
  @Query(
    """
    UPDATE local_node SET
      descSynced = CASE WHEN :status = 'SYNCED' THEN descSynced - 1 ELSE descSynced END,
      descUnsynced = CASE WHEN :status = 'UNSYNCED' THEN descUnsynced - 1 ELSE descUnsynced END,
      descUnknown = CASE WHEN :status = 'UNKNOWN' THEN descUnknown - 1 ELSE descUnknown END
    WHERE snapshotId = :snapshotId AND kind = 'DIRECTORY' AND entryId IN (:directoryIds)
    """
  )
  suspend fun decrementDescendantCounts(snapshotId: String, directoryIds: List<String>, status: String): Int

  /** The document behind a `FILE` row, for local image handles; null for a directory or an unknown entry. */
  @Query(
    "SELECT documentUri, mimeType FROM local_node WHERE snapshotId = :snapshotId AND entryId = :entryId AND kind = 'FILE'"
  )
  suspend fun imageEntry(snapshotId: String, entryId: String): ImageEntry?
}

/** One "Select all" row: the fields a selection keeps, nothing that locates the document. */
data class SelectableRow(val entryId: String, val sizeBytes: Long?, val status: String, val isImage: Boolean)

/** The local document of one `FILE` row. Never crosses the bridge. */
data class ImageEntry(val documentUri: String, val mimeType: String?)

/** Row projection for grouped status totals. */
data class StatusCount(val status: String, val count: Long)

/** A `local_node` row with the gallery duplicate probe selected alongside it. */
data class LocalNodeRow(
  @Embedded val node: LocalNodeEntity,
  val nameInOtherSource: Boolean,
)

/**
 * First-page counts (data-model.md "Read rules"): `FILE` rows of [snapshotId] by status, narrowed to
 * `image/` MIME types when [imagesOnly] (GALLERY) and to [sourceId] when given. Never narrowed by filter, parent
 * or search.
 */
suspend fun LocalNodeDao.statusCounts(snapshotId: String, imagesOnly: Boolean, sourceId: String?): List<StatusCount> {
  val args = mutableListOf<Any?>(snapshotId)
  val where = StringBuilder("snapshotId = ? AND kind = 'FILE'")
  if (imagesOnly) where.append(" AND mimeType LIKE 'image/%'")
  if (sourceId != null) {
    where.append(" AND sourceId = ?")
    args += sourceId
  }
  return statusCountsRaw(
    SimpleSQLiteQuery("SELECT status AS status, COUNT(*) AS count FROM local_node WHERE $where GROUP BY status", args.toTypedArray())
  )
}

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

  /** The one key of [snapshotId] with exactly this name, size, precision and bucket (the unique index). */
  @Query(
    """
    SELECT * FROM remote_match_key
    WHERE snapshotId = :snapshotId AND name = :name AND sizeBytes = :sizeBytes
      AND precisionMillis = :precisionMillis AND bucket = :bucket
    """
  )
  suspend fun exact(snapshotId: String, name: String, sizeBytes: Long, precisionMillis: Long, bucket: Long): RemoteMatchKeyEntity?

  @Query("SELECT precisionMillis FROM remote_match_key WHERE snapshotId = :snapshotId LIMIT 1")
  suspend fun anyPrecision(snapshotId: String): Long?

  @Query("SELECT * FROM remote_match_key WHERE snapshotId = :snapshotId")
  suspend fun forSnapshot(snapshotId: String): List<RemoteMatchKeyEntity>

  /** LOCAL_REFRESH: copies every match key of [fromSnapshotId] into [toSnapshotId] (new row IDs). */
  @Query(
    """
    INSERT INTO remote_match_key (snapshotId, name, sizeBytes, precisionMillis, bucket, duplicateCount, directories)
    SELECT :toSnapshotId, name, sizeBytes, precisionMillis, bucket, duplicateCount, directories
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

  /**
   * Deletion write rule step 2: takes one file of [status] off the [sourceId] row and off the all-sources
   * (`sourceId IS NULL`) row.
   */
  @Query(
    """
    UPDATE snapshot_counts SET count = count - 1
    WHERE snapshotId = :snapshotId AND status = :status AND (sourceId = :sourceId OR sourceId IS NULL)
    """
  )
  suspend fun decrement(snapshotId: String, sourceId: String, status: String): Int
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
