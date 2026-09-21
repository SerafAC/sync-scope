package com.syncscope.bridge

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.syncscope.remote.RemoteClientException

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

  /** `{contractVersion, status: "error", error: {code, message, action}}` */
  fun error(
    code: CloudSyncErrorCode,
    message: String,
    action: String? = null,
    sensitive: Collection<String> = emptyList(),
  ): WritableMap =
    base(CloudSyncContracts.STATUS_ERROR).apply {
      putMap(
        "error",
        newMap().apply {
          putString("code", code.name)
          putString("message", redact(message, sensitive))
          if (action == null) putNull("action") else putString("action", redact(action, sensitive))
        },
      )
    }

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
      error(e.code, message, e.action, sensitive)
    }
  }

  /** Converts any throwable into an INTERNAL_ERROR envelope; the message is redacted. */
  fun internalError(t: Throwable, page: Boolean = false): WritableMap {
    val message = "Unexpected ${t.javaClass.simpleName}: ${t.message ?: "no detail"}"
    val action = "Retry; if it persists, reconnect the repository."
    return if (page) {
      pageError(CloudSyncErrorCode.INTERNAL_ERROR, message, action)
    } else {
      error(CloudSyncErrorCode.INTERNAL_ERROR, message, action)
    }
  }

  fun emptyArray(): WritableArray = newArray()

  private fun base(status: String): WritableMap =
    newMap().apply {
      putInt("contractVersion", CloudSyncContracts.CONTRACT_VERSION)
      putString("status", status)
    }

  companion object {
    const val REDACTED = "[redacted]"

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
