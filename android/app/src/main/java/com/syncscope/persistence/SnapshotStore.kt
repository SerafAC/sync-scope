package com.syncscope.persistence

import androidx.room.withTransaction
import androidx.sqlite.db.SimpleSQLiteQuery
import com.syncscope.deletion.DeletionOutcome
import com.syncscope.deletion.DeletionRow
import com.syncscope.deletion.DeletionSnapshots

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
  /** GALLERY reads: a `FILE` with the same name (case-sensitive) exists in another source. Always false for LIST. */
  val nameInOtherSource: Boolean = false,
  /** `DIRECTORY` rows: files beneath it matching the query's filter; null on files and on pre-v3 rows. */
  val matchingFileCount: Long? = null,
)

/**
 * Every `FILE` row a query would show, as four parallel arrays in the same order, mirroring
 * `SelectableEntriesDto` on the JS side. A size of `-1` means the size is unknown.
 */
class SelectableEntries(
  val entryIds: List<String>,
  val sizes: LongArray,
  val statuses: List<String>,
  val images: BooleanArray,
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
open class SnapshotStore(private val db: SyncScopeDatabase) : DeletionSnapshots {

  /**
   * Creates a run with generation `maxGeneration() + 1`, read and inserted in one transaction so two
   * runs can never share (or reorder) a generation. `includeHidden` is always false (research R8).
   */
  suspend fun beginRun(
    runId: String,
    mode: String,
    configRevision: Long,
    phase: String,
    startedAtMillis: Long,
  ): ScanRunEntity =
    db.withTransaction {
      val run =
        ScanRunEntity(
          runId = runId,
          generation = (db.scanRunDao().maxGeneration() ?: 0L) + 1L,
          configRevision = configRevision,
          includeHidden = false,
          phase = phase,
          startedAtMillis = startedAtMillis,
          finishedAtMillis = null,
          terminalState = null,
          errorCode = null,
          errorSummary = null,
          mode = mode,
        )
      db.scanRunDao().insert(run)
      run
    }

  /** The running run, else the most recent one. */
  suspend fun latestRun(): ScanRunEntity? = db.scanRunDao().latest()

  suspend fun run(runId: String): ScanRunEntity? = db.scanRunDao().byId(runId)

  override suspend fun snapshot(snapshotId: String): SnapshotEntity? = db.snapshotDao().byId(snapshotId)

  /** `INCOMPLETE` once any remote-scope or `SOURCE` gap was recorded (data-model "Snapshot"). */
  suspend fun setCoverage(snapshotId: String, coverage: String) {
    db.snapshotDao().setCoverage(snapshotId, coverage)
  }

  suspend fun setRemoteListedAt(snapshotId: String, remoteListedAtMillis: Long) {
    db.snapshotDao().setRemoteListedAt(snapshotId, remoteListedAtMillis)
  }

  /**
   * The precision a snapshot was matched with: every match key and `local_node` row of one snapshot
   * carries the run's single precision, so any row answers. Null when the snapshot has no rows.
   */
  open suspend fun precisionOf(snapshotId: String): Long? =
    db.remoteMatchKeyDao().anyPrecision(snapshotId) ?: db.localNodeDao().anyPrecision(snapshotId)

  suspend fun stageSnapshot(snapshot: SnapshotEntity) {
    db.snapshotDao().insert(snapshot)
  }

  open suspend fun stageLocalNodes(nodes: List<LocalNodeEntity>) {
    if (nodes.isEmpty()) return
    db.localNodeDao().insertAll(nodes)
  }

  open suspend fun stageMatchKeys(keys: List<RemoteMatchKeyEntity>) {
    if (keys.isEmpty()) return
    db.remoteMatchKeyDao().insertAll(keys)
  }

  suspend fun stageRemoteNodes(nodes: List<RemoteNodeEntity>) {
    if (nodes.isEmpty()) return
    db.remoteNodeDao().insertAll(nodes)
  }

  suspend fun stageAmbiguities(rows: List<RemoteAmbiguityEntity>) {
    if (rows.isEmpty()) return
    db.remoteAmbiguityDao().insertAll(rows)
  }

  suspend fun stageCounts(rows: List<SnapshotCountsEntity>) {
    if (rows.isEmpty()) return
    db.snapshotCountsDao().insertAll(rows)
  }

  suspend fun matchKeys(snapshotId: String): List<RemoteMatchKeyEntity> =
    db.remoteMatchKeyDao().forSnapshot(snapshotId)

  /**
   * The match key of [snapshotId] for an NFC name, size and bucket at [precisionMillis], or null; its
   * `directories` drive the pre-delete re-check (research R11, R12).
   */
  open suspend fun matchKey(snapshotId: String, nfcName: String, sizeBytes: Long, precisionMillis: Long, bucket: Long): RemoteMatchKeyEntity? =
    db.remoteMatchKeyDao().exact(snapshotId, nfcName, sizeBytes, precisionMillis, bucket)

  suspend fun ambiguities(snapshotId: String): List<RemoteAmbiguityEntity> =
    db.remoteAmbiguityDao().forSnapshot(snapshotId)

  suspend fun counts(snapshotId: String): List<SnapshotCountsEntity> =
    db.snapshotCountsDao().forSnapshot(snapshotId)

  /**
   * Reflects one batch of deletion outcomes in the published [snapshotId] without a rescan (research R14,
   * data-model "Deletion write rule"), in one transaction: a failure anywhere rolls the whole batch back.
   *
   * For each outcome whose state removes the row (`DELETED`, `ALREADY_GONE`) and whose `FILE` row still
   * exists: delete the row, decrement `snapshot_counts` for its source and for all sources, decrement the
   * matching descendant count on every ancestor directory, and insert a `local_deletion_overlay` row. The
   * stored row's source, parent and status are used, so a row already removed is never counted twice.
   * Other outcomes change nothing. At most [MAX_DELETIONS_PER_BATCH] outcomes; the caller chunks.
   */
  override suspend fun recordDeletions(snapshotId: String, outcomes: List<DeletionOutcome>) {
    require(outcomes.size <= MAX_DELETIONS_PER_BATCH) { "at most $MAX_DELETIONS_PER_BATCH outcomes per batch" }
    val removals = outcomes.filter { it.state.removesRow }
    if (removals.isEmpty()) return
    db.withTransaction {
      val nodes = db.localNodeDao()
      val parents = HashMap<String, String?>()
      val overlays = ArrayList<LocalDeletionOverlayEntity>(removals.size)
      for (outcome in removals) {
        val row = nodes.byEntry(snapshotId, outcome.row.entryId) ?: continue
        if (row.kind != KIND_FILE || nodes.deleteFile(snapshotId, row.entryId) == 0) continue
        db.snapshotCountsDao().decrement(snapshotId, row.sourceId, row.status)
        val ancestors = ArrayList<String>()
        var parent = row.parentId
        while (parent != null) {
          val directory: String = parent
          ancestors += directory
          parent = parents.getOrPut(directory) { nodes.parentOf(snapshotId, directory) }
        }
        if (ancestors.isNotEmpty()) nodes.decrementDescendantCounts(snapshotId, ancestors, row.status)
        overlays +=
          LocalDeletionOverlayEntity(
            id = 0,
            snapshotId = snapshotId,
            localEntryId = row.entryId,
            state = outcome.state.name,
            atMillis = outcome.atMillis,
          )
      }
      if (overlays.isNotEmpty()) db.localDeletionOverlayDao().insertAll(overlays)
    }
  }

  /**
   * LOCAL_REFRESH (research R2, R7): gives the staged [toSnapshotId] the remote side of
   * [fromSnapshotId] in one transaction — every match key, the remote-scope ambiguity rows (never
   * `SOURCE`, which the refresh recomputes) and `remoteListedAtMillis`, so the listing's age does not move.
   */
  suspend fun copyRemoteState(fromSnapshotId: String, toSnapshotId: String) {
    db.withTransaction {
      val from =
        db.snapshotDao().byId(fromSnapshotId)
          ?: throw SnapshotNotFoundException("snapshot '$fromSnapshotId' does not exist")
      db.remoteMatchKeyDao().copy(fromSnapshotId, toSnapshotId)
      db.remoteAmbiguityDao().copyRemoteScope(fromSnapshotId, toSnapshotId)
      db.snapshotDao().setRemoteListedAt(toSnapshotId, from.remoteListedAtMillis)
    }
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
   * Ends a run that will not publish (`CANCELLED` or `FAILED`) in one transaction: deletes its staged
   * snapshot, which cascades every staged `local_node`, `remote_match_key`, `remote_ambiguity` and
   * `snapshot_counts` row, marks the run terminal with [terminalState] as both state and phase, and
   * records [summary] as the pointer's `lastAttemptSummary`. The last known good snapshot keeps
   * serving reads. A run that is already terminal is left exactly as it is, so cancel racing a
   * failure is harmless. Throws [StaleGenerationException] for an unknown run or a wrong generation.
   */
  suspend fun discardRun(
    runId: String,
    generation: Long,
    terminalState: String,
    errorCode: String?,
    summary: String?,
    nowMillis: Long,
  ) {
    require(terminalState in DISCARD_STATES) { "discardRun cannot end a run as '$terminalState'" }
    db.withTransaction {
      val run =
        db.scanRunDao().byId(runId) ?: throw StaleGenerationException("unknown scan run '$runId'")
      if (run.generation != generation) {
        throw StaleGenerationException(
          "scan run '$runId' has generation ${run.generation}, discard claimed $generation"
        )
      }
      if (run.terminalState != null) return@withTransaction
      db.snapshotDao().deleteForRun(runId)
      db.scanRunDao()
        .markTerminal(
          runId = runId,
          terminalState = terminalState,
          finishedAtMillis = nowMillis,
          errorCode = errorCode,
          errorSummary = summary,
          phase = terminalState,
        )
      val current = db.activeSnapshotDao().get()
      db.activeSnapshotDao()
        .put(
          ActiveSnapshotEntity(
            snapshotId = current?.snapshotId,
            staleReason = current?.staleReason,
            lastAttemptSummary = summary,
            updatedAtMillis = nowMillis,
          )
        )
    }
  }

  suspend fun activeSnapshot(): ActiveSnapshotEntity? = db.activeSnapshotDao().get()

  override suspend fun activeSnapshotId(): String? = activeSnapshot()?.snapshotId

  /**
   * The `FILE` rows of [snapshotId] among [entryIds], with what a deletion plan keeps of each (data-model
   * "Deletion plan"); directories and unknown IDs are left out. Read in chunks of
   * [MAX_IDS_PER_QUERY] IDs to stay under SQLite's bound-variable limit, in the order of [entryIds].
   */
  override suspend fun deletionRows(snapshotId: String, entryIds: Collection<String>): List<DeletionRow> {
    val ids = entryIds.distinct()
    val order = ids.withIndex().associate { it.value to it.index }
    return ids.chunked(MAX_IDS_PER_QUERY).flatMap { chunk ->
      db.localNodeDao().filesByEntry(snapshotId, chunk).map {
        DeletionRow(
          entryId = it.entryId,
          sourceId = it.sourceId,
          parentId = it.parentId,
          documentUri = it.documentUri,
          name = it.name,
          sizeBytes = it.sizeBytes,
          modifiedUtcMillis = it.modifiedUtcMillis,
          status = it.status,
        )
      }
    }.sortedBy { order.getValue(it.entryId) }
  }

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
   *
   * A null `query.parentId` means "no parent filter" (`queryFiles`). [topLevelOnly] instead selects
   * the rows directly under a source root (`parentId IS NULL`, `queryTreeChildren` with no parent),
   * still narrowed by `query.sourceId`; it cannot be combined with a `parentId`.
   */
  suspend fun queryFilePage(
    snapshotId: String,
    query: SnapshotQuery,
    pageToken: String?,
    topLevelOnly: Boolean = false,
  ): FilePage {
    require(!(topLevelOnly && query.parentId != null)) { "topLevelOnly cannot be combined with a parentId" }
    val snapshot = db.snapshotDao().byId(snapshotId)
    if (snapshot == null || !snapshot.publishable) {
      throw SnapshotNotFoundException("snapshot '$snapshotId' is not published")
    }
    // A top-level token must never replay against the unfiltered query, or the other way round.
    val fingerprint = if (topLevelOnly) query.fingerprint() + "|root" else query.fingerprint()
    val cursor =
      pageToken?.let {
        val decoded = PageTokenCodec.decode(it)
        PageTokenCodec.requireMatches(decoded, snapshotId, fingerprint)
        decoded
      }

    val limit = query.effectivePageSize()
    val (where, args) = scopeOf(snapshotId, query, topLevelOnly)
    val gallery = query.view == FileView.GALLERY

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
      // A time key must bind as an integer: SQLite orders every INTEGER below every TEXT, so a text key
      // would match every row again and the pages would never end.
      val sortKey: Any =
        if (sortColumn == "name") cursor.sortKey
        else cursor.sortKey.toLongOrNull() ?: throw PageTokenMismatchException("page token carries a non-numeric time key")
      where.append(" AND ($sortColumn $comparator ? OR ($sortColumn = ? AND entryId $comparator ?))")
      args += sortKey
      args += sortKey
      args += cursor.lastEntryId
    }

    // One extra row tells us whether a further page exists without a count. The duplicate probe runs
    // on the page's rows only, outside the inner LIMIT, and is pinned to the (snapshotId, name, …)
    // index: left to itself SQLite scans the covering (snapshotId, sourceId, …) index for every row,
    // which costs ~10x the plan budget on a 50 000-file snapshot (SnapshotQueryPerformanceTest).
    val duplicateProbe =
      if (gallery) {
        "EXISTS (SELECT 1 FROM local_node d INDEXED BY $NAME_INDEX" +
          " WHERE d.snapshotId = p.snapshotId AND d.name = p.name AND d.kind = 'FILE' AND d.sourceId <> p.sourceId)"
      } else {
        "0"
      }
    val order = "ORDER BY $sortColumn $direction, entryId $direction"
    val sql =
      "SELECT p.*, $duplicateProbe AS nameInOtherSource" +
        " FROM (SELECT * FROM local_node WHERE $where $order LIMIT ${limit + 1}) AS p $order"
    val rows = db.localNodeDao().rows(SimpleSQLiteQuery(sql, args.toTypedArray()))

    val hasMore = rows.size > limit
    val pageRows = if (hasMore) rows.subList(0, limit) else rows
    val nextPageToken =
      pageRows.lastOrNull()?.takeIf { hasMore }?.node?.let {
        PageTokenCodec.encode(
          snapshotId = snapshotId,
          queryFingerprint = fingerprint,
          sortKey = sortValueOf(it, query.sort),
          lastEntryId = it.entryId,
        )
      }

    return FilePage(
      entries = pageRows.map { it.toFileEntry(query.filter) },
      nextPageToken = nextPageToken,
      // Counts ride along with the first page so rows and totals share a read. They are scoped by
      // view and source only, never by filter, parent or search, so the chips stay stable.
      counts =
        if (cursor == null) db.localNodeDao().statusCounts(snapshotId, imagesOnly = gallery, sourceId = query.sourceId)
        else null,
    )
  }

  /**
   * "Select all" (`listSelectableEntries`): every `FILE` row [query] would show, in one read. GALLERY
   * follows `queryFiles` (the filter applies to every row, images only, `sourceId`/`parentId` narrow
   * when given). LIST follows `queryTreeChildren` for one folder: the direct children of
   * `query.parentId` (the source's top level when null) in `query.sourceId`, which is required.
   * Directories are never returned; `pageSize`, `sort` and `search` are ignored. Throws
   * [SnapshotNotFoundException] when the snapshot is missing or still staged.
   */
  suspend fun selectableEntries(snapshotId: String, query: SnapshotQuery): SelectableEntries {
    val list = query.view == FileView.LIST
    require(!list || query.sourceId != null) { "a LIST selection needs a sourceId" }
    val snapshot = db.snapshotDao().byId(snapshotId)
    if (snapshot == null || !snapshot.publishable) {
      throw SnapshotNotFoundException("snapshot '$snapshotId' is not published")
    }
    val (where, args) = scopeOf(snapshotId, query.copy(search = null), topLevelOnly = list && query.parentId == null)
    where.append(" AND kind = 'FILE'")
    val sql =
      "SELECT entryId, sizeBytes, status, COALESCE(mimeType LIKE 'image/%', 0) AS isImage" +
        " FROM local_node WHERE $where"
    val rows = db.localNodeDao().selectable(SimpleSQLiteQuery(sql, args.toTypedArray()))
    val sizes = LongArray(rows.size)
    val images = BooleanArray(rows.size)
    rows.forEachIndexed { index, row ->
      sizes[index] = row.sizeBytes ?: UNKNOWN_SIZE
      images[index] = row.isImage
    }
    return SelectableEntries(
      entryIds = rows.map { it.entryId },
      sizes = sizes,
      statuses = rows.map { it.status },
      images = images,
    )
  }

  /**
   * The local document of [entryId] in a published snapshot, for `getLocalImageHandle`: its
   * `documentUri` and `mimeType`, or null when the entry is unknown or is a `DIRECTORY`. Throws
   * [SnapshotNotFoundException] when the snapshot is missing or still staged.
   */
  suspend fun imageEntry(snapshotId: String, entryId: String): ImageEntry? {
    val snapshot = db.snapshotDao().byId(snapshotId)
    if (snapshot == null || !snapshot.publishable) {
      throw SnapshotNotFoundException("snapshot '$snapshotId' is not published")
    }
    return db.localNodeDao().imageEntry(snapshotId, entryId)
  }

  companion object {
    /** [recordDeletions] takes at most this many outcomes per transaction (research R14). */
    const val MAX_DELETIONS_PER_BATCH = 100

    /** IDs bound in one `IN (…)` read; well under SQLite's 999-variable limit on old builds. */
    const val MAX_IDS_PER_QUERY = 500

    /** `sizes[i]` of a [SelectableEntries] row whose size is unknown. */
    private const val UNKNOWN_SIZE = -1L
    private val DISCARD_STATES = setOf("CANCELLED", "FAILED")
    private const val KIND_DIRECTORY = "DIRECTORY"
    private const val KIND_FILE = "FILE"
    /** Room's name for `Index(snapshotId, name, sizeBytes)` on `local_node` (schema 3.json). */
    private const val NAME_INDEX = "index_local_node_snapshotId_name_sizeBytes"
  }

  /**
   * The row scope of a browse read, shared by [queryFilePage] and [selectableEntries] so the filter,
   * view and parent rules are defined once: the snapshot, the filter (directories always pass while
   * browsing a folder, research R3), GALLERY's image-only rule, the source, the parent (or the top
   * level) and the search. Returns the `WHERE` clause and its bind arguments.
   */
  private fun scopeOf(
    snapshotId: String,
    query: SnapshotQuery,
    topLevelOnly: Boolean,
  ): Pair<StringBuilder, MutableList<Any?>> {
    val args = mutableListOf<Any?>(snapshotId)
    val where = StringBuilder("snapshotId = ?")

    val filterClause =
      when (query.filter) {
        FileFilter.ALL -> null
        FileFilter.SYNCED -> "status = 'SYNCED'"
        FileFilter.UNSYNCED -> "status = 'UNSYNCED'"
        FileFilter.ISSUES_UNKNOWN -> "(status = 'UNKNOWN' OR issueCode IS NOT NULL)"
      }
    if (filterClause != null) {
      // Browsing a folder never dead-ends: directories are always listed and the filter narrows
      // files only (research R3). A flat `queryFiles` read keeps 004's rule.
      val browsing = topLevelOnly || query.parentId != null
      where.append(if (browsing) " AND (kind = 'DIRECTORY' OR $filterClause)" else " AND $filterClause")
    }
    if (query.view == FileView.GALLERY) {
      where.append(" AND kind = 'FILE' AND mimeType LIKE 'image/%'")
    }
    query.sourceId?.let {
      where.append(" AND sourceId = ?")
      args += it
    }
    if (topLevelOnly) {
      where.append(" AND parentId IS NULL")
    }
    query.parentId?.let {
      where.append(" AND parentId = ?")
      args += it
    }
    query.search?.takeIf { it.isNotEmpty() }?.let {
      where.append(" AND name LIKE ? ESCAPE '\\'")
      args += "%${escapeLike(it)}%"
    }
    return where to args
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

  private fun LocalNodeRow.toFileEntry(filter: FileFilter): FileEntry =
    FileEntry(
      entryId = node.entryId,
      sourceId = node.sourceId,
      parentId = node.parentId,
      kind = node.kind,
      name = node.name,
      mimeType = node.mimeType,
      sizeBytes = node.sizeBytes,
      modifiedUtcMillis = node.modifiedUtcMillis,
      status = node.status,
      issueCode = node.issueCode,
      nameInOtherSource = nameInOtherSource,
      matchingFileCount = if (node.kind == KIND_DIRECTORY) matchingFileCount(node, filter) else null,
    )

  /** The directory's descendant `FILE` count for [filter]; null when any count predates schema 3. */
  private fun matchingFileCount(node: LocalNodeEntity, filter: FileFilter): Long? {
    val synced = node.descSynced ?: return null
    val unsynced = node.descUnsynced ?: return null
    val unknown = node.descUnknown ?: return null
    return when (filter) {
      FileFilter.ALL -> synced + unsynced + unknown
      FileFilter.SYNCED -> synced
      FileFilter.UNSYNCED -> unsynced
      FileFilter.ISSUES_UNKNOWN -> unknown
    }
  }
}
