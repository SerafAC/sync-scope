package com.syncscope.bridge

/**
 * Kotlin mirror of `src/native/CloudSyncContracts.ts`.
 *
 * Values must match the TypeScript constants exactly; CloudSyncContractsParityTest
 * reads the TS source and fails the build on any drift.
 */
object CloudSyncContracts {
  const val MODULE_NAME = "CloudSync"
  const val CONTRACT_VERSION = 5

  /** Hard bridge bounds; the engine never returns a page larger than this. */
  const val MAX_PAGE_SIZE = 200
  const val DEFAULT_PAGE_SIZE = 50

  const val STATUS_OK = "ok"
  const val STATUS_ERROR = "error"

  /** A deletion plan expires this long after prepareLocalDeletion made it (`MAX_DELETION_PLAN_AGE_MILLIS`). */
  const val MAX_DELETION_PLAN_AGE_MILLIS = 15 * 60 * 1000L

  /** Same clamp as the TS `clampPageSize`, so either side yields an identical bound. */
  fun clampPageSize(pageSize: Double?): Int {
    if (pageSize == null || pageSize.isNaN() || pageSize.isInfinite()) {
      return DEFAULT_PAGE_SIZE
    }
    val truncated = pageSize.toLong()
    if (truncated < 1) {
      return 1
    }
    return minOf(truncated, MAX_PAGE_SIZE.toLong()).toInt()
  }
}

/**
 * Port used when a repository is saved with no port, mirroring `REPOSITORY_DEFAULT_PORTS` in the
 * TypeScript contract (checked by CloudSyncContractsParityTest). A WebDAV repository over HTTPS uses
 * [WEBDAV_HTTPS].
 */
object RepositoryDefaultPorts {
  const val FTP = 21
  const val SFTP = 22
  const val WEBDAV = 80
  const val WEBDAV_HTTPS = 443
}

/**
 * Bounds of `getLocalImageHandle`'s `maxEdgePx`, mirroring `LOCAL_IMAGE_MIN_EDGE_PX`,
 * `LOCAL_IMAGE_MAX_EDGE_PX` and `clampImageEdge` in the TypeScript contract (checked by
 * CloudSyncContractsParityTest).
 */
object LocalImageSpec {
  const val MIN_EDGE_PX = 64
  const val MAX_EDGE_PX = 2048

  /** Same clamp as the TS `clampImageEdge` for integral edges. */
  fun bounded(px: Int): Int = px.coerceIn(MIN_EDGE_PX, MAX_EDGE_PX)
}

/**
 * Stable, machine-readable error codes; the wire value is the enum name.
 *
 * Codes with a fixed user-facing text carry it as [defaultMessage]/[defaultAction]; the text must match
 * `SOURCE_ERROR_TEXT` / `SCAN_ERROR_TEXT` / `IMAGE_ERROR_TEXT` / `MVP_ERROR_TEXT` in the TypeScript
 * contract (checked by CloudSyncContractsParityTest).
 */
enum class CloudSyncErrorCode(val defaultMessage: String? = null, val defaultAction: String? = null) {
  NOT_IMPLEMENTED,
  NATIVE_MODULE_UNAVAILABLE,
  INVALID_QUERY,
  PAGE_TOKEN_MISMATCH,
  SNAPSHOT_NOT_FOUND,
  STALE_GENERATION,
  AUTH_FAILED,
  CONNECTION_REFUSED,
  CONNECTION_TIMEOUT,
  CONNECTION_LOST,
  DIRECTORY_UNREADABLE,
  REMOTE_ROOT_NOT_FOUND,
  SERVER_ERROR,
  SFTP_HOST_KEY_UNVERIFIED,
  SFTP_HOST_KEY_CHANGED,
  HOST_KEY_CHALLENGE_NOT_FOUND,
  REPOSITORY_NOT_CONFIGURED,
  CREDENTIAL_UNAVAILABLE,
  SOURCE_OVERLAP(
    "This folder overlaps a folder you already added.",
    "Pick a folder that is not inside, or around, an existing one.",
  ),
  SOURCE_UNSUPPORTED(
    "Only folders on this device or its SD card can be added.",
    "Pick a folder from internal storage or the SD card.",
  ),
  SOURCE_REGRANT_MISMATCH(
    "That is a different folder from the one that lost access.",
    "Pick the same folder again, or remove the source.",
  ),
  SOURCE_NOT_FOUND(
    "That folder is no longer in your list.",
    "Refresh the folder list.",
  ),
  PICKER_BUSY(
    "The folder picker is already open.",
    "Finish or close the picker, then try again.",
  ),
  NO_SOURCES_SELECTED(
    "No folders are selected to check.",
    "Add a folder in Settings › Folders.",
  ),
  SCAN_IN_PROGRESS(
    "A scan is already running.",
    "Wait for it to finish, or cancel it.",
  ),
  SCAN_NOT_FOUND(
    "That scan is no longer known.",
    "Refresh the scan screen.",
  ),
  REFRESH_UNAVAILABLE(
    "There is no up-to-date remote listing to refresh against.",
    "Run a full scan.",
  ),
  IMAGE_UNAVAILABLE(
    "This image could not be read on the device.",
    "Check that the folder is still available, then rescan.",
  ),

  /** WebDAV over HTTPS: the server's certificate is not trusted by the phone (contract version 5). */
  TLS_UNTRUSTED(
    "The server's certificate is not trusted by this phone.",
    "Use a certificate from a public authority, or connect with SFTP.",
  ),

  /** A deletion is running, so a scan, a repository save or another deletion must wait (contract version 5). */
  DELETION_IN_PROGRESS(
    "Files are being deleted.",
    "Wait until the deletion finishes.",
  ),

  /** prepareLocalDeletion: the results were made with previous server settings (contract version 5). */
  REPOSITORY_CHANGED(
    "These results were made with your previous server settings.",
    "Scan again before deleting.",
  ),

  /** executeLocalDeletion: the plan token is unknown, expired or already used (contract version 5). */
  PLAN_NOT_FOUND(
    "This deletion is no longer available.",
    "Review the selection and tap Delete again.",
  ),

  /** executeLocalDeletion: the snapshot changed since the plan was made (contract version 5). */
  PLAN_STALE(
    "The results changed since you reviewed this deletion.",
    "Review the selection and tap Delete again.",
  ),
  INTERNAL_ERROR,
}

/**
 * File issue codes that are not error codes (`local_node.issueCode`); the wire value is the enum name.
 *
 * [text] must match `FILE_ISSUE_TEXT` in the TypeScript contract (checked by
 * CloudSyncContractsParityTest). Remote causes reuse [CloudSyncErrorCode] values instead.
 */
enum class FileIssueCode(val text: String) {
  REMOTE_MTIME_MISSING("The backup has this file but no modified time, so it could not be compared."),
  LOCAL_UNAVAILABLE("This file could not be read on the device."),
}
