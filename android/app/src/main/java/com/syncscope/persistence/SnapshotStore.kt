package com.syncscope.persistence

import androidx.room.withTransaction
import androidx.sqlite.db.SimpleSQLiteQuery

/** One row of a browse page, mirroring `FileEntryDto` on the JS side. */
data class FileEntry(
  val entryId: String,
  val sourceId: String,
  val parentId: String?,
  val kind: String,
  val name: String,
  val mimeType: String?,
  val sizeBytes: Long?,
  val modifiedUtcMillis: Long?,
  val status: String,
  val issueCode: String?,
)

/** A bounded page of entries, mirroring `FilePageDto` on the JS side. */
data class FilePage(
  val entries: List<FileEntry>,
  val nextPageToken: String?,
  val counts: List<StatusCount>?,
)

/**
 * Write and read path for scan snapshots.
 *
 * Staging is invisible: rows are written against a snapshot whose
 * `publishable` flag is still false, and only [publish] — one transaction —
 * flips that flag, stamps the run terminal, and swaps the active pointer. A
 * run that was superseded by a newer generation, or that already reached a
 * terminal state, cannot publish and cannot disturb the last known good
 * pointer.
 */
class SnapshotStore(private val db: SyncScopeDatabase) {

  suspend fun beginRun(run: ScanRunEntity) {
    db.scanRunDao().insert(run)
  }

  suspend fun stageSnapshot(snapshot: SnapshotEntity) {
    db.snapshotDao().insert(snapshot)
  }

  suspend fun stageLocalNodes(nodes: List<LocalNodeEntity>) {
    if (nodes.isEmpty()) return
    db.localNodeDao().insertAll(nodes)
  }

  suspend fun stageMatchKeys(keys: List<RemoteMatchKeyEntity>) {
    if (keys.isEmpty()) return
    db.remoteMatchKeyDao().insertAll(keys)
  }

  suspend fun stageRemoteNodes(nodes: List<RemoteNodeEntity>) {
    if (nodes.isEmpty()) return
    db.remoteNodeDao().insertAll(nodes)
  }

  /**
   * Makes the run's staged snapshot the active one. Throws
   * [StaleGenerationException] — leaving the previous pointer untouched — when
   * the run is unknown, already terminal, or carries a generation that has
   * been superseded.
   */
  suspend fun publish(
    runId: String,
    generation: Long,
    configRevision: Long,
    terminalState: String,
    nowMillis: Long,
  ) {
    db.withTransaction {
      val run =
        db.scanRunDao().byId(runId) ?: throw StaleGenerationException("unknown scan run '$runId'")
      if (run.terminalState != null) {
        throw StaleGenerationException(
          "scan run '$runId' already reached terminal state '${run.terminalState}'"
        )
      }
      if (run.generation != generation) {
        throw StaleGenerationException(
          "scan run '$runId' has generation ${run.generation}, publication claimed $generation"
        )
      }
      val newest = db.scanRunDao().maxGeneration() ?: generation
      if (generation < newest) {
        throw StaleGenerationException(
          "generation $generation was superseded by generation $newest"
        )
      }
      if (run.configRevision != configRevision) {
        throw StaleGenerationException(
          "scan run '$runId' ran against config revision ${run.configRevision}, not $configRevision"
        )
      }
      val snapshot =
        db.snapshotDao().forRun(runId)
          ?: throw SnapshotNotFoundException("scan run '$runId' staged no snapshot")

      db.snapshotDao().markPublishable(snapshot.snapshotId, nowMillis)
      db.scanRunDao()
        .markTerminal(
          runId = runId,
          terminalState = terminalState,
          finishedAtMillis = nowMillis,
          errorCode = null,
          errorSummary = null,
          phase = "PUBLISHED",
        )
      db.activeSnapshotDao()
        .put(
          ActiveSnapshotEntity(
            snapshotId = snapshot.snapshotId,
            staleReason = null,
            lastAttemptSummary = null,
            updatedAtMillis = nowMillis,
          )
        )
    }
  }

  /**
   * Records a failed refresh. The last known good snapshot keeps serving
   * reads; the pointer only gains the reason it is stale and the summary of
   * the attempt that failed, so the UI can say *why* data is old.
   */
  suspend fun recordFailedAttempt(
    runId: String,
    generation: Long,
    terminalState: String,
    errorCode: String?,
    summary: String?,
    staleReason: String?,
    nowMillis: Long,
  ) {
    db.withTransaction {
      val run =
        db.scanRunDao().byId(runId) ?: throw StaleGenerationException("unknown scan run '$runId'")
      if (run.terminalState != null) {
        throw StaleGenerationException(
          "scan run '$runId' already reached terminal state '${run.terminalState}'"
        )
      }
      if (run.generation != generation) {
        throw StaleGenerationException(
          "scan run '$runId' has generation ${run.generation}, failure claimed $generation"
        )
      }
      db.scanRunDao()
        .markTerminal(
          runId = runId,
          terminalState = terminalState,
          finishedAtMillis = nowMillis,
          errorCode = errorCode,
          errorSummary = summary,
          phase = "FAILED",
        )
      val current = db.activeSnapshotDao().get()
      db.activeSnapshotDao()
        .put(
          ActiveSnapshotEntity(
            snapshotId = current?.snapshotId,
            staleReason = staleReason,
            lastAttemptSummary = summary,
            updatedAtMillis = nowMillis,
          )
        )
    }
  }

  suspend fun activeSnapshot(): ActiveSnapshotEntity? = db.activeSnapshotDao().get()

  /**
   * Reclaims runs left non-terminal by process death: marks them ABORTED and
   * drops their staging snapshot, which cascades away every staged row. The
   * active pointer is never touched, and a second call is a no-op.
   */
  suspend fun abortAbandonedRuns(nowMillis: Long) {
    db.withTransaction {
      for (run in db.scanRunDao().nonTerminal()) {
        db.snapshotDao().deleteForRun(run.runId)
        db.scanRunDao()
          .markTerminal(
            runId = run.runId,
            terminalState = "ABORTED",
            finishedAtMillis = nowMillis,
            errorCode = null,
            errorSummary = null,
            phase = "ABORTED",
          )
      }
    }
  }

  /**
   * Keyset-paginated read over a published snapshot. Staged snapshots are not
   * readable: they raise [SnapshotNotFoundException]. A page token is only
   * accepted for the snapshot and query it was minted for.
   */
  suspend fun queryFilePage(
    snapshotId: String,
    query: SnapshotQuery,
    pageToken: String?,
  ): FilePage {
    val snapshot = db.snapshotDao().byId(snapshotId)
    if (snapshot == null || !snapshot.publishable) {
      throw SnapshotNotFoundException("snapshot '$snapshotId' is not published")
    }
    val fingerprint = query.fingerprint()
    val cursor =
      pageToken?.let {
        val decoded = PageTokenCodec.decode(it)
        PageTokenCodec.requireMatches(decoded, snapshotId, fingerprint)
        decoded
      }

    val limit = query.effectivePageSize()
    val args = mutableListOf<Any?>(snapshotId)
    val where = StringBuilder("snapshotId = ?")

    when (query.filter) {
      FileFilter.ALL -> Unit
      FileFilter.SYNCED -> where.append(" AND status = 'SYNCED'")
      FileFilter.UNSYNCED -> where.append(" AND status = 'UNSYNCED'")
      FileFilter.ISSUES_UNKNOWN -> where.append(" AND (status = 'UNKNOWN' OR issueCode IS NOT NULL)")
    }
    if (query.view == FileView.GALLERY) {
      where.append(" AND kind = 'FILE' AND (mimeType LIKE 'image/%' OR mimeType LIKE 'video/%')")
    }
    query.sourceId?.let {
      where.append(" AND sourceId = ?")
      args += it
    }
    query.parentId?.let {
      where.append(" AND parentId = ?")
      args += it
    }
    query.search?.takeIf { it.isNotEmpty() }?.let {
      where.append(" AND name LIKE ? ESCAPE '\\'")
      args += "%${escapeLike(it)}%"
    }

    val ascending = query.sort == FileSort.NAME_ASC || query.sort == FileSort.TIME_ASC
    val sortColumn =
      when (query.sort) {
        FileSort.NAME_ASC,
        FileSort.NAME_DESC -> "name"
        FileSort.TIME_ASC,
        FileSort.TIME_DESC -> "COALESCE(modifiedUtcMillis, -1)"
      }
    val direction = if (ascending) "ASC" else "DESC"
    val comparator = if (ascending) ">" else "<"

    if (cursor != null) {
      where.append(" AND ($sortColumn $comparator ? OR ($sortColumn = ? AND entryId $comparator ?))")
      args += cursor.sortKey
      args += cursor.sortKey
      args += cursor.lastEntryId
    }

    // One extra row tells us whether a further page exists without a count.
    val sql =
      "SELECT * FROM local_node WHERE $where ORDER BY $sortColumn $direction, entryId $direction LIMIT ${limit + 1}"
    val rows = db.localNodeDao().page(SimpleSQLiteQuery(sql, args.toTypedArray()))

    val hasMore = rows.size > limit
    val pageRows = if (hasMore) rows.subList(0, limit) else rows
    val nextPageToken =
      pageRows.lastOrNull()?.takeIf { hasMore }?.let {
        PageTokenCodec.encode(
          snapshotId = snapshotId,
          queryFingerprint = fingerprint,
          sortKey = sortValueOf(it, query.sort),
          lastEntryId = it.entryId,
        )
      }

    return FilePage(
      entries = pageRows.map { it.toFileEntry() },
      nextPageToken = nextPageToken,
      // Counts ride along with the first page so rows and totals share a read.
      counts = if (cursor == null) db.localNodeDao().statusCounts(snapshotId) else null,
    )
  }

  private fun sortValueOf(node: LocalNodeEntity, sort: FileSort): String =
    when (sort) {
      FileSort.NAME_ASC,
      FileSort.NAME_DESC -> node.name
      FileSort.TIME_ASC,
      FileSort.TIME_DESC -> (node.modifiedUtcMillis ?: -1L).toString()
    }

  private fun escapeLike(value: String): String =
    value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

  private fun LocalNodeEntity.toFileEntry(): FileEntry =
    FileEntry(
      entryId = entryId,
      sourceId = sourceId,
      parentId = parentId,
      kind = kind,
      name = name,
      mimeType = mimeType,
      sizeBytes = sizeBytes,
      modifiedUtcMillis = modifiedUtcMillis,
      status = status,
      issueCode = issueCode,
    )
}
