package com.syncscope.persistence

import java.util.Base64

/** The decoded cursor carried between pages of one snapshot query. */
data class PageToken(
  val snapshotId: String,
  val queryFingerprint: String,
  val sortKey: String,
  val lastEntryId: String,
)

/**
 * Encodes paging cursors as `v1.<b64>.<b64>.<b64>.<b64>`. Each field is
 * base64-encoded separately so arbitrary characters (including the `.` and `;`
 * that appear in file names) round-trip without escaping.
 */
object PageTokenCodec {
  private const val VERSION = "v1"
  private const val SEGMENTS = 5
  private val ENCODER = Base64.getUrlEncoder().withoutPadding()
  private val DECODER = Base64.getUrlDecoder()

  fun encode(
    snapshotId: String,
    queryFingerprint: String,
    sortKey: String,
    lastEntryId: String,
  ): String =
    listOf(VERSION, enc(snapshotId), enc(queryFingerprint), enc(sortKey), enc(lastEntryId))
      .joinToString(".")

  fun decode(token: String): PageToken {
    if (token.isEmpty()) throw PageTokenMismatchException("page token is empty")
    val parts = token.split(".")
    if (parts.size != SEGMENTS) {
      throw PageTokenMismatchException("page token has ${parts.size} segments, expected $SEGMENTS")
    }
    if (parts[0] != VERSION) {
      throw PageTokenMismatchException("unsupported page token version '${parts[0]}'")
    }
    return PageToken(
      snapshotId = dec(parts[1]),
      queryFingerprint = dec(parts[2]),
      sortKey = dec(parts[3]),
      lastEntryId = dec(parts[4]),
    )
  }

  /** Fails unless the token was minted for exactly this snapshot and query. */
  fun requireMatches(token: PageToken, snapshotId: String, queryFingerprint: String) {
    if (token.snapshotId != snapshotId) {
      throw PageTokenMismatchException(
        "page token belongs to snapshot '${token.snapshotId}', not '$snapshotId'"
      )
    }
    if (token.queryFingerprint != queryFingerprint) {
      throw PageTokenMismatchException("page token was minted for a different query")
    }
  }

  private fun enc(value: String): String = ENCODER.encodeToString(value.toByteArray(Charsets.UTF_8))

  private fun dec(value: String): String =
    try {
      String(DECODER.decode(value), Charsets.UTF_8)
    } catch (e: IllegalArgumentException) {
      throw PageTokenMismatchException("page token segment is not valid base64: ${e.message}")
    }
}
