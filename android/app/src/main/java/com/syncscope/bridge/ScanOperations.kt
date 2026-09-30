package com.syncscope.bridge

import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.bridge.WritableMap
import com.syncscope.persistence.FileFilter
import com.syncscope.persistence.FilePage
import com.syncscope.persistence.FileSort
import com.syncscope.persistence.FileView
import com.syncscope.persistence.PageTokenMismatchException
import com.syncscope.persistence.RemoteAmbiguityEntity
import com.syncscope.persistence.RepositoryConfigDao
import com.syncscope.persistence.SnapshotEntity
import com.syncscope.persistence.SnapshotNotFoundException
import com.syncscope.persistence.SnapshotQuery
import com.syncscope.persistence.SnapshotStore
import com.syncscope.persistence.SourceRootDao
import com.syncscope.scan.FileStatus
import com.syncscope.scan.ScanCoordinator
import com.syncscope.scan.ScanEngine
import com.syncscope.scan.ScanInProgress
import com.syncscope.scan.ScanMode
import com.syncscope.scan.ScanNotFound
import com.syncscope.scan.ScanRefused
import com.syncscope.scan.ScanRunView

/**
 * startScan / cancelScan / getScanState / queryFiles / queryTreeChildren, resolved as envelopes
 * (contracts/cloudsync-scan.md "Behaviour"). No `documentId`, `documentUri`, path or host ever goes
 * into a result: rows are mapped field by field, and run errors were redacted when they were stored.
 */
class ScanOperations(
  private val coordinator: () -> ScanCoordinator,
  private val store: () -> SnapshotStore,
  private val sources: () -> SourceRootDao,
  private val repositories: () -> RepositoryConfigDao,
  private val envelope: CloudSyncEnvelope,
) {

  /** `StartScanResult`; a null [mode] means FULL. */
  suspend fun start(mode: String?): WritableMap {
    val parsed =
      if (mode == null) ScanMode.FULL
      else ScanMode.entries.firstOrNull { it.name == mode }
        ?: return envelope.error(
          CloudSyncErrorCode.INVALID_QUERY,
          "The scan mode is not recognised.",
          "Use FULL or LOCAL_REFRESH.",
          field = "mode",
        )
    return try {
      val run = coordinator().start(parsed)
      envelope.ok().apply {
        putString("runId", run.runId)
        putDouble("generation", run.generation.toDouble())
      }
    } catch (_: ScanInProgress) {
      envelope.sourceError(CloudSyncErrorCode.SCAN_IN_PROGRESS)
    } catch (e: ScanRefused) {
      refused(e.code)
    }
  }

  /** `OperationResult`: ok for an active or already ended run, `SCAN_NOT_FOUND` otherwise. */
  suspend fun cancel(runId: String): WritableMap =
    try {
      coordinator().cancel(runId)
      envelope.ok()
    } catch (_: ScanNotFound) {
      envelope.sourceError(CloudSyncErrorCode.SCAN_NOT_FOUND)
    }

  /** `ScanStateResult`: a pure read, safe to poll. */
  suspend fun state(): WritableMap {
    val view = coordinator().state()
    val snapshot = store().activeSnapshot()?.snapshotId?.let { store().snapshot(it) }?.takeIf { it.publishable }
    return envelope.ok().apply {
      if (view == null) putNull("run") else putMap("run", runDto(view))
      if (snapshot == null) putNull("active") else putMap("active", activeDto(snapshot))
    }
  }

  /** `FilePageResultDto` over a published snapshot; `querySpec.parentId` filters when given. */
  suspend fun queryFiles(snapshotId: String, querySpec: ReadableMap, pageToken: String?): WritableMap =
    page(snapshotId, querySpec, pageToken) { query -> store().queryFilePage(snapshotId, query, pageToken) }

  /** `FilePageResultDto` of [parentId]'s children; a null [parentId] lists the top level of every source. */
  suspend fun queryTreeChildren(snapshotId: String, parentId: String?, querySpec: ReadableMap, pageToken: String?): WritableMap =
    page(snapshotId, querySpec, pageToken) { query ->
      store().queryFilePage(snapshotId, query.copy(parentId = parentId), pageToken, topLevelOnly = parentId == null)
    }

  // --- startScan refusals ---

  private fun refused(code: CloudSyncErrorCode): WritableMap =
    when {
      code.defaultMessage != null -> envelope.sourceError(code)
      code == CloudSyncErrorCode.CREDENTIAL_UNAVAILABLE ->
        envelope.error(code, RepositoryOperations.CREDENTIAL_UNAVAILABLE_MESSAGE, RepositoryOperations.CREDENTIAL_UNAVAILABLE_ACTION)
      else -> envelope.error(code, RepositoryOperations.NOT_CONFIGURED_MESSAGE, RepositoryOperations.NOT_CONFIGURED_ACTION)
    }

  // --- getScanState ---

  /** `ScanRunDto`: `error` only on FAILED, `cancelReason` only on CANCELLED. */
  private fun runDto(view: ScanRunView): WritableMap {
    val run = view.run
    return envelope.map().apply {
      putString("runId", run.runId)
      putDouble("generation", run.generation.toDouble())
      putString("mode", run.mode)
      putString("phase", view.phase)
      putNullableString("terminalState", run.terminalState)
      putDouble("startedAtMillis", run.startedAtMillis.toDouble())
      putNullableNumber("finishedAtMillis", run.finishedAtMillis)
      putMap(
        "progress",
        envelope.map().apply {
          putDouble("remoteDirectoriesListed", view.progress.remoteDirectoriesListed.toDouble())
          putDouble("remoteFilesListed", view.progress.remoteFilesListed.toDouble())
          putDouble("localFilesEnumerated", view.progress.localFilesEnumerated.toDouble())
          putDouble("localFilesMatched", view.progress.localFilesMatched.toDouble())
        },
      )
      if (run.terminalState == ScanEngine.TERMINAL_FAILED) {
        putMap(
          "error",
          envelope.map().apply {
            putString("code", run.errorCode ?: CloudSyncErrorCode.INTERNAL_ERROR.name)
            putString("message", CloudSyncEnvelope.redact(run.errorSummary ?: run.errorCode ?: "The scan failed."))
            putNullableString("action", view.failureAction)
          },
        )
      } else {
        putNull("error")
      }
      val reason = run.errorSummary.takeIf { run.terminalState == ScanCoordinator.TERMINAL_CANCELLED && it in CANCEL_REASONS }
      putNullableString("cancelReason", reason)
    }
  }

  /** `ActiveSnapshotDto`; the summary reads `snapshot_counts` and `remote_ambiguity` only, never a full count. */
  private suspend fun activeDto(snapshot: SnapshotEntity): WritableMap {
    val id = snapshot.snapshotId
    val completed = snapshot.completedAtMillis ?: 0L
    val precision = store().precisionOf(id) ?: repositories().get()?.precisionMillis ?: 0L
    val totals = store().counts(id).filter { it.sourceId == null }.associate { it.status to it.count }
    val gaps = store().ambiguities(id)
    val aliases = sources().all().associate { it.sourceId to it.alias }
    val skipped = envelope.emptyArray()
    for (gap in gaps.filter { it.scope == RemoteAmbiguityEntity.SCOPE_SOURCE }) {
      val sourceId = gap.sourceId ?: continue
      val alias = aliases[sourceId] ?: continue
      skipped.pushMap(
        envelope.map().apply {
          putString("sourceId", sourceId)
          putString("alias", alias)
          putString("reason", gap.reason)
        }
      )
    }
    return envelope.map().apply {
      putString("snapshotId", id)
      putDouble("completedAtMillis", completed.toDouble())
      // Version 1 snapshots have no listing time; their completion is the closest honest anchor.
      putDouble("remoteListedAtMillis", (snapshot.remoteListedAtMillis ?: completed).toDouble())
      putDouble("precisionMillis", precision.toDouble())
      putString("coverage", snapshot.coverage)
      putMap(
        "summary",
        envelope.map().apply {
          putDouble("synced", (totals[FileStatus.SYNCED.name] ?: 0L).toDouble())
          putDouble("unsynced", (totals[FileStatus.UNSYNCED.name] ?: 0L).toDouble())
          putDouble("unknown", (totals[FileStatus.UNKNOWN.name] ?: 0L).toDouble())
          putDouble(
            "unreadableRemoteDirectories",
            gaps.count { it.scope == RemoteAmbiguityEntity.SCOPE_REMOTE_DIRECTORY }.toDouble(),
          )
          putNullableString(
            "remoteListingInterruptedBy",
            gaps.firstOrNull { it.scope == RemoteAmbiguityEntity.SCOPE_REMOTE_LISTING }?.reason,
          )
          putArray("skippedSources", skipped)
        },
      )
    }
  }

  // --- queries ---

  private suspend fun page(
    snapshotId: String,
    querySpec: ReadableMap,
    pageToken: String?,
    read: suspend (SnapshotQuery) -> FilePage,
  ): WritableMap {
    val query =
      when (val parsed = parseQuery(querySpec)) {
        is ParsedQuery.Invalid ->
          return envelope.pageError(
            CloudSyncErrorCode.INVALID_QUERY,
            "The query ${parsed.field} is invalid.",
            "Reset the filters and try again.",
          )
        is ParsedQuery.Valid -> parsed.query
      }
    val result =
      try {
        read(query)
      } catch (_: SnapshotNotFoundException) {
        return envelope.pageError(
          CloudSyncErrorCode.SNAPSHOT_NOT_FOUND,
          "That scan result is no longer available.",
          "Refresh the scan screen.",
        )
      } catch (_: PageTokenMismatchException) {
        return envelope.pageError(
          CloudSyncErrorCode.PAGE_TOKEN_MISMATCH,
          "The list changed since this page was requested.",
          "Reload the list from the top.",
        )
      }
    val entries = envelope.emptyArray()
    for (entry in result.entries) {
      entries.pushMap(
        envelope.map().apply {
          putString("entryId", entry.entryId)
          putString("sourceId", entry.sourceId)
          putNullableString("parentId", entry.parentId)
          putString("kind", entry.kind)
          putString("name", entry.name)
          putNullableString("mimeType", entry.mimeType)
          putNullableNumber("sizeBytes", entry.sizeBytes)
          putNullableNumber("modifiedUtcMillis", entry.modifiedUtcMillis)
          putString("status", entry.status)
          putNullableString("issueCode", entry.issueCode)
        }
      )
    }
    val counts =
      result.counts?.let { rows ->
        envelope.emptyArray().apply {
          for (row in rows) {
            pushMap(
              envelope.map().apply {
                putString("status", row.status)
                putDouble("count", row.count.toDouble())
              }
            )
          }
        }
      }
    return envelope.page(entries, result.nextPageToken, counts)
  }

  private sealed interface ParsedQuery {
    data class Valid(val query: SnapshotQuery) : ParsedQuery

    data class Invalid(val field: String) : ParsedQuery
  }

  /** Mirrors `QuerySpec`; a missing field takes its default, a present but unknown value is rejected. */
  private fun parseQuery(spec: ReadableMap): ParsedQuery {
    val filter = enumField(spec, "filter", FileFilter.ALL) ?: return ParsedQuery.Invalid("filter")
    val view = enumField(spec, "view", FileView.LIST) ?: return ParsedQuery.Invalid("view")
    val sort = enumField(spec, "sort", FileSort.NAME_ASC) ?: return ParsedQuery.Invalid("sort")
    val search = stringField(spec, "search")
    if (search != null && search.length > SnapshotQuery.MAX_SEARCH_LENGTH) return ParsedQuery.Invalid("search")
    val pageSize =
      if (!spec.hasKey("pageSize") || spec.isNull("pageSize")) null
      else if (spec.getType("pageSize") != ReadableType.Number) return ParsedQuery.Invalid("pageSize")
      else CloudSyncContracts.clampPageSize(spec.getDouble("pageSize"))
    return ParsedQuery.Valid(
      SnapshotQuery(
        filter = filter,
        view = view,
        sort = sort,
        sourceId = stringField(spec, "sourceId"),
        parentId = stringField(spec, "parentId"),
        search = search,
        pageSize = pageSize,
      )
    )
  }

  private inline fun <reified E : Enum<E>> enumField(spec: ReadableMap, key: String, default: E): E? {
    if (!spec.hasKey(key) || spec.isNull(key)) return default
    if (spec.getType(key) != ReadableType.String) return null
    val value = spec.getString(key)
    return enumValues<E>().firstOrNull { it.name == value }
  }

  private fun stringField(spec: ReadableMap, key: String): String? =
    if (spec.hasKey(key) && spec.getType(key) == ReadableType.String) spec.getString(key) else null

  private fun WritableMap.putNullableString(key: String, value: String?) {
    if (value == null) putNull(key) else putString(key, value)
  }

  private fun WritableMap.putNullableNumber(key: String, value: Long?) {
    if (value == null) putNull(key) else putDouble(key, value.toDouble())
  }

  private companion object {
    val CANCEL_REASONS = setOf(ScanCoordinator.CANCEL_USER, ScanCoordinator.CANCEL_BACKGROUNDED)
  }
}
