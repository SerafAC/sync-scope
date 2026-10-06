package com.syncscope.persistence

/** Mirrors `FileFilter` in `src/native/CloudSyncContracts.ts`. */
enum class FileFilter {
  ALL,
  SYNCED,
  UNSYNCED,
  ISSUES_UNKNOWN,
}

/** Mirrors `FileView` in `src/native/CloudSyncContracts.ts`. */
enum class FileView {
  LIST,
  GALLERY,
}

/** Mirrors `FileSort` in `src/native/CloudSyncContracts.ts` (contract version 6 adds the size sorts, research R1). */
enum class FileSort {
  NAME_ASC,
  NAME_DESC,
  TIME_ASC,
  TIME_DESC,
  SIZE_ASC,
  SIZE_DESC,
}

/**
 * Narrows a read to folders or files (`FileKind` in `src/native/CloudSyncContracts.ts`, contract version 6,
 * research R3); the wire value is the enum name. List view reads a folder's subfolders, then its files.
 */
enum class FileKind {
  DIRECTORY,
  FILE,
}

/**
 * A bounded browse query over one published snapshot. The [fingerprint] covers
 * every dimension that changes *which* rows match, so a page token minted for
 * one query can never be replayed against another. `pageSize` is deliberately
 * excluded: it changes how many rows come back, not which ones.
 */
data class SnapshotQuery(
  val filter: FileFilter = FileFilter.ALL,
  val view: FileView = FileView.LIST,
  val sort: FileSort = FileSort.NAME_ASC,
  val sourceId: String? = null,
  val parentId: String? = null,
  val search: String? = null,
  val pageSize: Int? = null,
  /** Only rows of this kind; null reads both (research R3). */
  val kind: FileKind? = null,
) {
  init {
    val length = search?.length ?: 0
    require(length <= MAX_SEARCH_LENGTH) {
      "search must be at most $MAX_SEARCH_LENGTH characters, was $length"
    }
  }

  /** Stable identity of the row set this query selects. */
  fun fingerprint(): String =
    listOf(
        "f=${filter.name}",
        "v=${view.name}",
        "s=${sort.name}",
        "src=${sourceId ?: ""}",
        "p=${parentId ?: ""}",
        "q=${search ?: ""}",
        "k=${kind?.name ?: ""}",
      )
      .joinToString("|")

  /** The effective page size after bridge-contract clamping. */
  fun effectivePageSize(): Int = boundedPageSize(pageSize)

  companion object {
    const val DEFAULT_PAGE_SIZE: Int = 50
    const val MAX_PAGE_SIZE: Int = 200
    const val MAX_SEARCH_LENGTH: Int = 256

    /** Kotlin mirror of `clampPageSize` in `src/native/CloudSyncContracts.ts`. */
    fun boundedPageSize(pageSize: Int?): Int {
      if (pageSize == null) return DEFAULT_PAGE_SIZE
      if (pageSize < 1) return 1
      return minOf(pageSize, MAX_PAGE_SIZE)
    }
  }
}
