package com.syncscope.bridge

/**
 * Kotlin mirror of `src/native/CloudSyncContracts.ts`.
 *
 * Values must match the TypeScript constants exactly; CloudSyncContractsParityTest
 * reads the TS source and fails the build on any drift.
 */
object CloudSyncContracts {
  const val MODULE_NAME = "CloudSync"
  const val CONTRACT_VERSION = 1

  /** Hard bridge bounds; the engine never returns a page larger than this. */
  const val MAX_PAGE_SIZE = 200
  const val DEFAULT_PAGE_SIZE = 50

  const val STATUS_OK = "ok"
  const val STATUS_ERROR = "error"

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

/** Stable, machine-readable error codes; the wire value is the enum name. */
enum class CloudSyncErrorCode {
  NOT_IMPLEMENTED,
  NATIVE_MODULE_UNAVAILABLE,
  INVALID_QUERY,
  PAGE_TOKEN_MISMATCH,
  SNAPSHOT_NOT_FOUND,
  STALE_GENERATION,
  INTERNAL_ERROR,
}
