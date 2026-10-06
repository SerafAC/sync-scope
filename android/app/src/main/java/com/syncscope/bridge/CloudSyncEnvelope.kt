package com.syncscope.bridge

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.syncscope.deletion.DeletionPlanView
import com.syncscope.deletion.DeletionResultView
import com.syncscope.deletion.DeletionState
import com.syncscope.persistence.FileEntry
import com.syncscope.persistence.SelectableEntries
import com.syncscope.remote.HostKeyChallenge
import com.syncscope.remote.RemoteClientException
import com.syncscope.remote.SftpHostKeyException

/**
 * Builders for the discriminated envelopes declared by the CloudSync spec
 * (`OperationResultDto` and `FilePageResultDto`).
 *
 * Every message is passed through [redact] before it is placed in an
 * envelope, so hosts, usernames, and paths never cross the bridge.
 * The map factories default to JNI-backed maps; JVM tests inject
 * `JavaOnlyMap`/`JavaOnlyArray`.
 */
class CloudSyncEnvelope(
  private val newMap: () -> WritableMap = Arguments::createMap,
  private val newArray: () -> WritableArray = Arguments::createArray,
) {
  /** `{contractVersion, status: "ok"}` */
  fun ok(): WritableMap = base(CloudSyncContracts.STATUS_OK)

  /** `{contractVersion, status: "ok", [key]: payload}` for operations that return data. */
  fun ok(key: String, payload: WritableMap): WritableMap = ok().apply { putMap(key, payload) }

  /** An empty map from the injected factory, for building payloads. */
  fun map(): WritableMap = newMap()

  /**
   * `INVALID_QUERY` naming the offending input [field] (also carried as `error.field`).
   * The rejected value is never echoed.
   */
  fun invalidField(field: String, reason: String): WritableMap =
    error(
      CloudSyncErrorCode.INVALID_QUERY,
      "The repository $field is invalid: $reason.",
      "Correct the $field and save again.",
      field = field,
    )

  /**
   * `{contractVersion, status: "error", error: {code, message, action, hostKeyChallenge?,
   * conflictingSource?}}`.
   * The challenge's host/port are the user's own input, carried as structured fields so the
   * prompt can be checked against `ssh-keyscan`; they are never placed in the message.
   * [conflictingSource] follows the same precedent (its alias never passes through [redact])
   * and is written for [CloudSyncErrorCode.SOURCE_OVERLAP] only.
   */
  fun error(
    code: CloudSyncErrorCode,
    message: String,
    action: String? = null,
    sensitive: Collection<String> = emptyList(),
    hostKeyChallenge: HostKeyChallenge? = null,
    field: String? = null,
    conflictingSource: ConflictingSource? = null,
  ): WritableMap =
    base(CloudSyncContracts.STATUS_ERROR).apply {
      putMap(
        "error",
        newMap().apply {
          putString("code", code.name)
          putString("message", redact(message, sensitive))
          if (action == null) putNull("action") else putString("action", redact(action, sensitive))
          hostKeyChallenge?.let { putMap("hostKeyChallenge", challengeMap(it)) }
          field?.let { putString("field", it) }
          if (code == CloudSyncErrorCode.SOURCE_OVERLAP && conflictingSource != null) {
            putMap("conflictingSource", conflictingSourceMap(conflictingSource))
          }
        },
      )
    }

  /**
   * A source-selection error with the code's fixed contract text
   * ([CloudSyncErrorCode.defaultMessage]/[CloudSyncErrorCode.defaultAction]).
   * [conflictingSource] is carried for [CloudSyncErrorCode.SOURCE_OVERLAP] only.
   */
  fun sourceError(code: CloudSyncErrorCode, conflictingSource: ConflictingSource? = null): WritableMap {
    val message = requireNotNull(code.defaultMessage) { "${code.name} has no fixed contract text" }
    return error(code, message, code.defaultAction, conflictingSource = conflictingSource)
  }

  /** A connect that stopped at an unapproved SFTP host key (blocking TOFU prompt). */
  fun hostKeyApprovalRequired(challenge: HostKeyChallenge): WritableMap =
    remoteFailure(SftpHostKeyException(CloudSyncErrorCode.SFTP_HOST_KEY_UNVERIFIED, challenge))

  /** `FilePageResultDto` error variant: an error envelope with `page: null`. */
  fun pageError(
    code: CloudSyncErrorCode,
    message: String,
    action: String? = null,
    sensitive: Collection<String> = emptyList(),
  ): WritableMap = error(code, message, action, sensitive).apply { putNull("page") }

  /** `{contractVersion, status: "ok", page: {entries, nextPageToken, counts}}` */
  fun page(entries: WritableArray, nextPageToken: String?, counts: WritableArray?): WritableMap =
    base(CloudSyncContracts.STATUS_OK).apply {
      putMap(
        "page",
        newMap().apply {
          putArray("entries", entries)
          if (nextPageToken == null) putNull("nextPageToken") else putString("nextPageToken", nextPageToken)
          if (counts == null) putNull("counts") else putArray("counts", counts)
        },
      )
    }

  /**
   * One `FileEntryDto` of a `queryFiles` / `queryTreeChildren` page. `sortName` (contract v6, research R2)
   * lets a view build its scroll anchor without a second read.
   */
  fun fileEntry(entry: FileEntry): WritableMap =
    newMap().apply {
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
      putBoolean("nameInOtherSource", entry.nameInOtherSource)
      putNullableNumber("matchingFileCount", entry.matchingFileCount)
      putString("sortName", entry.sortName)
    }

  private fun WritableMap.putNullableString(key: String, value: String?) {
    if (value == null) putNull(key) else putString(key, value)
  }

  private fun WritableMap.putNullableNumber(key: String, value: Long?) {
    if (value == null) putNull(key) else putDouble(key, value.toDouble())
  }

  /**
   * `{contractVersion, status: "ok", selectable: {entryIds, sizes, statuses, images}}` for
   * `listSelectableEntries`: four parallel arrays in the same order; a size of `-1` is unknown.
   */
  fun selectable(entries: SelectableEntries): WritableMap {
    val ids = newArray()
    val sizes = newArray()
    val statuses = newArray()
    val images = newArray()
    for (i in entries.entryIds.indices) {
      ids.pushString(entries.entryIds[i])
      sizes.pushDouble(entries.sizes[i].toDouble())
      statuses.pushString(entries.statuses[i])
      images.pushBoolean(entries.images[i])
    }
    return ok(
      "selectable",
      newMap().apply {
        putArray("entryIds", ids)
        putArray("sizes", sizes)
        putArray("statuses", statuses)
        putArray("images", images)
      },
    )
  }

  /**
   * `{contractVersion, status: "ok", plan: DeletionPlanDto}` for `prepareLocalDeletion`
   * (contracts/cloudsync-mvp.md). Counts and byte totals only: no document URI, name or remote path.
   */
  fun deletionPlan(plan: DeletionPlanView): WritableMap =
    ok(
      "plan",
      newMap().apply {
        putString("planToken", plan.token)
        putMap("toDelete", totalsMap(plan.toDelete.count, plan.toDelete.bytes))
        putMap("unsynced", totalsMap(plan.unsynced.count, plan.unsynced.bytes))
        putMap(
          "refused",
          newMap().apply {
            putDouble("count", plan.refusedCount.toDouble())
            putDouble("scanTooOld", plan.scanTooOld.toDouble())
          },
        )
        putDouble("movedByRecheck", plan.movedByRecheck.toDouble())
        putDouble("missing", plan.missing.toDouble())
        putDouble("unknownSizeCount", plan.unknownSizeCount.toDouble())
        putDouble("remoteListedAtMillis", plan.remoteListedAtMillis.toDouble())
      },
    )

  /**
   * `{contractVersion, status: "ok", result: DeletionResultDto}` for `executeLocalDeletion`. A failure
   * carries the entry's ID and display name only, never its document URI.
   */
  fun deletionResult(result: DeletionResultView): WritableMap {
    val failures = newArray()
    for (failure in result.failures) {
      failures.pushMap(
        newMap().apply {
          putString("entryId", failure.entryId)
          putString("name", failure.name)
          putString("reason", failureReason(failure.reason))
        },
      )
    }
    val removed = newArray()
    result.removedEntryIds.forEach(removed::pushString)
    return ok(
      "result",
      newMap().apply {
        putDouble("deleted", result.deleted.toDouble())
        putDouble("freedBytes", result.freedBytes.toDouble())
        putArray("failures", failures)
        putArray("removedEntryIds", removed)
      },
    )
  }

  /** A `prepareLocalDeletion` / `executeLocalDeletion` refusal with the code's contract text. */
  fun deletionRefused(code: CloudSyncErrorCode): WritableMap =
    when (code) {
      CloudSyncErrorCode.SNAPSHOT_NOT_FOUND ->
        error(code, "That scan result is no longer available.", "Refresh the scan screen.")
      CloudSyncErrorCode.STALE_GENERATION ->
        error(code, "These results were replaced by a newer scan.", "Select the files again.")
      CloudSyncErrorCode.REPOSITORY_NOT_CONFIGURED ->
        error(code, RepositoryOperations.NOT_CONFIGURED_MESSAGE, RepositoryOperations.NOT_CONFIGURED_ACTION)
      CloudSyncErrorCode.INVALID_QUERY ->
        error(code, "No files were given to delete.", "Select the files again.", field = "entryIds")
      else ->
        if (code.defaultMessage != null) sourceError(code) else error(code, code.name, INTERNAL_ERROR_ACTION)
    }

  /**
   * The re-check could not connect, so no plan exists. Host-key codes carry no challenge here: the key is
   * approved in Settings › Repository, never from the delete dialog. [sensitive] scrubs the configured
   * host, username and root.
   */
  fun deletionRemoteFailure(e: RemoteClientException, sensitive: Collection<String> = emptyList()): WritableMap =
    if (e.code == CloudSyncErrorCode.SFTP_HOST_KEY_UNVERIFIED || e.code == CloudSyncErrorCode.SFTP_HOST_KEY_CHANGED) {
      error(e.code, e.message ?: e.code.name, HOST_KEY_DELETION_ACTION, sensitive)
    } else {
      remoteFailure(e, sensitive = sensitive)
    }

  private fun totalsMap(count: Int, bytes: Long): WritableMap =
    newMap().apply {
      putDouble("count", count.toDouble())
      putDouble("bytes", bytes.toDouble())
    }

  private fun failureReason(state: DeletionState): String =
    when (state) {
      DeletionState.ALREADY_GONE,
      DeletionState.CHANGED,
      DeletionState.ACCESS_LOST -> state.name
      DeletionState.DELETED,
      DeletionState.FAILED,
      DeletionState.SKIPPED_UNSYNCED -> DeletionState.FAILED.name
    }

  fun notImplemented(method: String): WritableMap =
    error(CloudSyncErrorCode.NOT_IMPLEMENTED, "$method is not available in this build.")

  fun pageNotImplemented(method: String): WritableMap =
    pageError(CloudSyncErrorCode.NOT_IMPLEMENTED, "$method is not available in this build.")

  /** A coded remote failure; [sensitive] carries the configured host/username/root for scrubbing. */
  fun remoteFailure(
    e: RemoteClientException,
    page: Boolean = false,
    sensitive: Collection<String> = emptyList(),
  ): WritableMap {
    val message = e.message ?: e.code.name
    return if (page) {
      pageError(e.code, message, e.action, sensitive)
    } else {
      error(e.code, message, e.action, sensitive, (e as? SftpHostKeyException)?.challenge)
    }
  }

  /** Converts any throwable into an INTERNAL_ERROR envelope; the message is redacted. */
  fun internalError(t: Throwable, page: Boolean = false): WritableMap {
    val message = "Unexpected ${t.javaClass.simpleName}: ${t.message ?: "no detail"}"
    val action = INTERNAL_ERROR_ACTION
    return if (page) {
      pageError(CloudSyncErrorCode.INTERNAL_ERROR, message, action)
    } else {
      error(CloudSyncErrorCode.INTERNAL_ERROR, message, action)
    }
  }

  fun emptyArray(): WritableArray = newArray()

  private fun challengeMap(challenge: HostKeyChallenge): WritableMap =
    newMap().apply {
      putString("challengeId", challenge.challengeId)
      putString("host", challenge.host)
      putInt("port", challenge.port)
      putString("algorithm", challenge.algorithm)
      putString("fingerprint", challenge.fingerprint)
      val previous = challenge.previousFingerprint
      if (previous == null) putNull("previousFingerprint") else putString("previousFingerprint", previous)
    }

  private fun conflictingSourceMap(source: ConflictingSource): WritableMap =
    newMap().apply {
      putString("sourceId", source.sourceId)
      putString("alias", source.alias)
    }

  private fun base(status: String): WritableMap =
    newMap().apply {
      putInt("contractVersion", CloudSyncContracts.CONTRACT_VERSION)
      putString("status", status)
    }

  companion object {
    const val REDACTED = "[redacted]"

    /** The recovery action of every INTERNAL_ERROR. */
    const val INTERNAL_ERROR_ACTION = "Retry; if it persists, reconnect the repository."

    /** The action of a host-key failure during the pre-delete re-check (contracts/cloudsync-mvp.md). */
    const val HOST_KEY_DELETION_ACTION = "Check the server in Settings › Repository."

    // Order matters: URLs and user@host swallow their host/path before the generic rules run.
    private val URL = Regex("""\b[a-zA-Z][a-zA-Z0-9+.-]*://\S+""")
    private val USER_AT_HOST = Regex("""[\w.+-]+@[\w.-]+""")
    private val IPV4 = Regex("""\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b""")
    private val IPV6 = Regex("""\[?\b(?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}\b]?""")
    private val WINDOWS_PATH = Regex("""\b[a-zA-Z]:\\\S*""")
    private val UNIX_PATH = Regex("""(?<![\w.])(?:~|\.{1,2})?/[^\s'",;)]*""")
    private val HOSTNAME = Regex(
      """\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}(?::\d+)?\b""",
    )

    /**
     * Strips host, username, and filesystem/remote path fragments from [message].
     * [sensitive] carries known values (configured host, username, root path) that are
     * removed verbatim first, so they are scrubbed even when no pattern would match them.
     */
    fun redact(message: String, sensitive: Collection<String> = emptyList()): String {
      var out = message
      sensitive
        .filter { it.isNotBlank() }
        .sortedByDescending { it.length }
        .forEach { out = out.replace(it, REDACTED, ignoreCase = true) }
      out = URL.replace(out, REDACTED)
      out = USER_AT_HOST.replace(out, REDACTED)
      out = IPV4.replace(out, REDACTED)
      out = IPV6.replace(out) { if (it.value.count { c -> c == ':' } >= 2) REDACTED else it.value }
      out = WINDOWS_PATH.replace(out, REDACTED)
      out = UNIX_PATH.replace(out) { if (it.value.length > 1) REDACTED else it.value }
      out = HOSTNAME.replace(out, REDACTED)
      return out
    }
  }
}

/** The already-added source a rejected pick overlaps (`error.conflictingSource`, SOURCE_OVERLAP only). */
data class ConflictingSource(val sourceId: String, val alias: String)
