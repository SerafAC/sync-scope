package com.syncscope.persistence

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.IOException
import java.util.Base64

/**
 * The decoded cursor carried between pages of one snapshot query: the last row's sort key, its `sortName`
 * and its `entryId`, the three parts of every sort's order (research R1).
 */
data class PageToken(
  val snapshotId: String,
  val queryFingerprint: String,
  val sortKey: String,
  val sortName: String,
  val lastEntryId: String,
)

/**
 * Encodes paging cursors as one opaque URL-safe base64 string. The payload starts with a format version
 * byte ([FORMAT_VERSION]), followed by the five fields as length-prefixed UTF-8, so any character in a
 * name round-trips. A token in another format, including contract 5's `v1.…` tokens that carry no
 * `sortName`, fails as [PageTokenMismatchException] (D010; the JS side restarts from page 1).
 */
object PageTokenCodec {
  /** Version of the payload layout; contract 5's dotted `v1` tokens predate it. */
  const val FORMAT_VERSION: Int = 2
  private val ENCODER = Base64.getUrlEncoder().withoutPadding()
  private val DECODER = Base64.getUrlDecoder()

  fun encode(
    snapshotId: String,
    queryFingerprint: String,
    sortKey: String,
    sortName: String,
    lastEntryId: String,
  ): String {
    val bytes = ByteArrayOutputStream()
    DataOutputStream(bytes).use { out ->
      out.writeByte(FORMAT_VERSION)
      for (field in listOf(snapshotId, queryFingerprint, sortKey, sortName, lastEntryId)) {
        val utf8 = field.toByteArray(Charsets.UTF_8)
        out.writeInt(utf8.size)
        out.write(utf8)
      }
    }
    return ENCODER.encodeToString(bytes.toByteArray())
  }

  fun decode(token: String): PageToken {
    if (token.isEmpty()) throw PageTokenMismatchException("page token is empty")
    val bytes =
      try {
        DECODER.decode(token)
      } catch (e: IllegalArgumentException) {
        throw PageTokenMismatchException("page token is not valid base64: ${e.message}")
      }
    val input = DataInputStream(ByteArrayInputStream(bytes))
    try {
      val version = input.readUnsignedByte()
      if (version != FORMAT_VERSION) throw PageTokenMismatchException("unsupported page token version $version")
      val fields = List(FIELDS) { readField(input) }
      if (input.available() > 0) throw PageTokenMismatchException("page token has trailing bytes")
      return PageToken(
        snapshotId = fields[0],
        queryFingerprint = fields[1],
        sortKey = fields[2],
        sortName = fields[3],
        lastEntryId = fields[4],
      )
    } catch (e: IOException) {
      throw PageTokenMismatchException("page token is truncated: ${e.message}")
    }
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

  private const val FIELDS = 5

  private fun readField(input: DataInputStream): String {
    val length = input.readInt()
    if (length < 0 || length > input.available()) {
      throw PageTokenMismatchException("page token field length $length is out of range")
    }
    val utf8 = ByteArray(length)
    input.readFully(utf8)
    return String(utf8, Charsets.UTF_8)
  }
}
