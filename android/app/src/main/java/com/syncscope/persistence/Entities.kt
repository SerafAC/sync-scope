package com.syncscope.persistence

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * One scan attempt. `generation` is the monotonic fence that makes a late
 * publication from a superseded run detectable; it is globally unique.
 */
@Entity(
  tableName = "scan_run",
  indices = [Index(value = ["generation"], unique = true)],
)
data class ScanRunEntity(
  @PrimaryKey val runId: String,
  val generation: Long,
  val configRevision: Long,
  val includeHidden: Boolean,
  val phase: String,
  val startedAtMillis: Long,
  val finishedAtMillis: Long?,
  val terminalState: String?,
  val errorCode: String?,
  val errorSummary: String?,
  /** `FULL` or `LOCAL_REFRESH` (schema version 2; version 1 rows read `FULL`). */
  @ColumnInfo(defaultValue = "FULL") val mode: String = "FULL",
)

/**
 * A staged or published view of one scan run. Rows are invisible to readers
 * until `publishable` flips inside the publish transaction.
 */
@Entity(
  tableName = "snapshot",
  indices = [Index(value = ["scanRunId"], unique = true)],
  foreignKeys = [
    ForeignKey(
      entity = ScanRunEntity::class,
      parentColumns = ["runId"],
      childColumns = ["scanRunId"],
      onDelete = ForeignKey.CASCADE,
    )
  ],
)
data class SnapshotEntity(
  @PrimaryKey val snapshotId: String,
  val scanRunId: String,
  val completedAtMillis: Long?,
  val coverage: String,
  val configRevision: Long,
  val includeHidden: Boolean,
  val publishable: Boolean,
  /**
   * When the remote listing this snapshot matches against finished (schema version 2). A LOCAL_REFRESH
   * copies it from the snapshot it refreshes; null for version 1 rows.
   */
  val remoteListedAtMillis: Long?,
)

/** A user-granted SAF tree. `canonicalRoot` collapses aliases of one location. */
@Entity(
  tableName = "source_root",
  indices = [Index(value = ["canonicalRoot"], unique = true)],
)
data class SourceRootEntity(
  @PrimaryKey val sourceId: String,
  val treeUri: String,
  val authority: String,
  val volumeId: String,
  val documentPath: String,
  val canonicalRoot: String,
  val alias: String,
  val canWrite: Boolean,
  val addedAtMillis: Long,
)

@Entity(
  tableName = "local_node",
  indices = [
    Index(value = ["snapshotId", "name", "sizeBytes"]),
    Index(value = ["snapshotId", "status", "name"]),
    Index(value = ["snapshotId", "sourceId", "parentId", "kind", "name"]),
    Index(value = ["snapshotId", "kind", "modifiedUtcMillis"]),
    Index(value = ["sourceId"]),
  ],
  foreignKeys = [
    ForeignKey(
      entity = SnapshotEntity::class,
      parentColumns = ["snapshotId"],
      childColumns = ["snapshotId"],
      onDelete = ForeignKey.CASCADE,
    ),
    ForeignKey(
      entity = SourceRootEntity::class,
      parentColumns = ["sourceId"],
      childColumns = ["sourceId"],
    ),
  ],
)
data class LocalNodeEntity(
  @PrimaryKey val entryId: String,
  val snapshotId: String,
  val sourceId: String,
  val parentId: String?,
  val kind: String,
  val documentUri: String,
  val documentId: String,
  val name: String,
  val mimeType: String?,
  val sizeBytes: Long?,
  val modifiedUtcMillis: Long?,
  val precisionMillis: Long,
  val status: String,
  val issueCode: String?,
)

/**
 * Collapsed remote identity: every remote file bucketed by the protocol's
 * discovered timestamp precision. Duplicates collapse into `duplicateCount`.
 */
@Entity(
  tableName = "remote_match_key",
  indices = [
    Index(value = ["snapshotId", "name", "sizeBytes"]),
    Index(
      value = ["snapshotId", "name", "sizeBytes", "precisionMillis", "bucket"],
      unique = true,
    ),
  ],
  foreignKeys = [
    ForeignKey(
      entity = SnapshotEntity::class,
      parentColumns = ["snapshotId"],
      childColumns = ["snapshotId"],
      onDelete = ForeignKey.CASCADE,
    )
  ],
)
data class RemoteMatchKeyEntity(
  @PrimaryKey(autoGenerate = true) val matchKeyId: Long,
  val snapshotId: String,
  val name: String,
  val sizeBytes: Long,
  val precisionMillis: Long,
  val bucket: Long,
  val duplicateCount: Long,
)

@Entity(
  tableName = "remote_node",
  indices = [Index(value = ["snapshotId", "path"])],
  foreignKeys = [
    ForeignKey(
      entity = SnapshotEntity::class,
      parentColumns = ["snapshotId"],
      childColumns = ["snapshotId"],
      onDelete = ForeignKey.CASCADE,
    )
  ],
)
data class RemoteNodeEntity(
  @PrimaryKey(autoGenerate = true) val id: Long,
  val snapshotId: String,
  val parentId: Long?,
  val path: String,
  val name: String,
  val type: String,
  val depth: Long,
  val sizeBytes: Long?,
  val modifiedUtcMillis: Long?,
  val extra: String?,
)

/**
 * A recorded reason why a match verdict is not trustworthy for a scope
 * (whole snapshot, one source, one entry, or one match key).
 */
@Entity(
  tableName = "remote_ambiguity",
  indices = [Index(value = ["snapshotId"])],
  foreignKeys = [
    ForeignKey(
      entity = SnapshotEntity::class,
      parentColumns = ["snapshotId"],
      childColumns = ["snapshotId"],
      onDelete = ForeignKey.CASCADE,
    )
  ],
)
data class RemoteAmbiguityEntity(
  @PrimaryKey(autoGenerate = true) val id: Long,
  val snapshotId: String,
  val scope: String,
  val sourceId: String?,
  val entryId: String?,
  val matchKeyId: Long?,
  val reason: String,
) {
  companion object {
    /** A non-root remote directory could not be listed; `reason` is the error code. */
    const val SCOPE_REMOTE_DIRECTORY: String = "REMOTE_DIRECTORY"

    /** The remote walk stopped after its retries; `reason` is the error code. */
    const val SCOPE_REMOTE_LISTING: String = "REMOTE_LISTING"

    /** A source was skipped or failed mid-walk; `reason` is `GRANT_REVOKED`, `STORAGE_MISSING` or `LOCAL_UNAVAILABLE`. */
    const val SCOPE_SOURCE: String = "SOURCE"
  }
}

@Entity(
  tableName = "snapshot_counts",
  indices = [Index(value = ["snapshotId", "sourceId", "status"], unique = true)],
  foreignKeys = [
    ForeignKey(
      entity = SnapshotEntity::class,
      parentColumns = ["snapshotId"],
      childColumns = ["snapshotId"],
      onDelete = ForeignKey.CASCADE,
    )
  ],
)
data class SnapshotCountsEntity(
  @PrimaryKey(autoGenerate = true) val id: Long,
  val snapshotId: String,
  val sourceId: String?,
  val status: String,
  val count: Long,
)

/** Deletion intent/result applied on top of an immutable snapshot. */
@Entity(
  tableName = "local_deletion_overlay",
  indices = [Index(value = ["snapshotId", "localEntryId"])],
  foreignKeys = [
    ForeignKey(
      entity = SnapshotEntity::class,
      parentColumns = ["snapshotId"],
      childColumns = ["snapshotId"],
      onDelete = ForeignKey.CASCADE,
    )
  ],
)
data class LocalDeletionOverlayEntity(
  @PrimaryKey(autoGenerate = true) val id: Long,
  val snapshotId: String,
  val localEntryId: String,
  val state: String,
  val atMillis: Long,
)

/** A host key the user explicitly approved for an SFTP endpoint. */
@Entity(
  tableName = "trusted_sftp_host_key",
  indices = [Index(value = ["host", "port", "algorithm"], unique = true)],
)
data class TrustedSftpHostKeyEntity(
  @PrimaryKey(autoGenerate = true) val id: Long,
  val host: String,
  val port: Int,
  val algorithm: String,
  val keyBase64: String,
  val fingerprint: String,
  val approvedAtMillis: Long,
)

/**
 * Remote repository coordinates. Credentials never live here: only
 * `credentialVersion`, a non-secret pointer into Keystore-backed storage
 * (R003 / D013). SchemaContractTest fails the build if that changes.
 */
@Entity(tableName = "repository_config")
data class RepositoryConfigEntity(
  @PrimaryKey val id: Int = SINGLETON_ID,
  val protocol: String,
  val host: String,
  val port: Int,
  val username: String,
  val remoteRoot: String,
  val precisionMillis: Long,
  val credentialVersion: Long,
  val revision: Long = 1L,
) {
  companion object {
    const val SINGLETON_ID: Int = 0
  }
}

/**
 * Single-row pointer to the last known good snapshot. A failed refresh leaves
 * the pointer where it is and records why the data is stale.
 */
@Entity(tableName = "active_snapshot")
data class ActiveSnapshotEntity(
  @PrimaryKey val id: Int = SINGLETON_ID,
  val snapshotId: String?,
  val staleReason: String?,
  val lastAttemptSummary: String?,
  val updatedAtMillis: Long,
) {
  companion object {
    const val SINGLETON_ID: Int = 0
  }
}
