package com.syncscope.persistence

import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class PageTokenCodecTest {

  @Test
  fun roundTripsAllFields() {
    val encoded =
      PageTokenCodec.encode(
        snapshotId = "snap-1",
        queryFingerprint = "fp-abc",
        sortKey = "1024",
        sortName = "1report;final.pdf",
        lastEntryId = "entry-9",
      )

    val decoded = PageTokenCodec.decode(encoded)

    assertEquals("snap-1", decoded.snapshotId)
    assertEquals("fp-abc", decoded.queryFingerprint)
    assertEquals("1024", decoded.sortKey)
    assertEquals("1report;final.pdf", decoded.sortName)
    assertEquals("entry-9", decoded.lastEntryId)
  }

  @Test
  fun roundTripsEmptyAndNonAsciiFields() {
    val decoded = PageTokenCodec.decode(PageTokenCodec.encode("snap.1", "f=ALL|q=日本", "", "0日本.jpg", "e.1"))

    assertEquals(PageToken("snap.1", "f=ALL|q=日本", "", "0日本.jpg", "e.1"), decoded)
  }

  @Test
  fun theTokenIsOpaqueAndStartsWithItsFormatVersion() {
    val token = PageTokenCodec.encode("snap-1", "fp", "1apple.jpg", "1apple.jpg", "e1")

    assertTrue("token '$token' is URL-safe base64", token.matches(Regex("[A-Za-z0-9_-]+")))
    assertFalse(token.contains("apple"))
    val bytes = Base64.getUrlDecoder().decode(token)
    assertEquals(PageTokenCodec.FORMAT_VERSION, bytes[0].toInt())
  }

  @Test
  fun aTokenWithAnUnknownVersionIsAMismatch() {
    val bytes = Base64.getUrlDecoder().decode(PageTokenCodec.encode("snap-1", "fp", "k", "n", "e"))
    for (version in listOf(0, 1, PageTokenCodec.FORMAT_VERSION + 1, 0x7f)) {
      bytes[0] = version.toByte()
      val token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
      assertThrows("version $version", PageTokenMismatchException::class.java) { PageTokenCodec.decode(token) }
    }
  }

  @Test
  fun aTokenInTheContractFiveFormatIsAMismatch() {
    // Contract 5: `v1.<b64 snapshot>.<b64 fingerprint>.<b64 sortKey>.<b64 entryId>`, no sortName.
    val b64 = Base64.getUrlEncoder().withoutPadding()
    val legacy = listOf("v1", "snap-1", "fp", "a.txt", "e1").mapIndexed { i, v -> if (i == 0) v else b64.encodeToString(v.toByteArray()) }

    assertThrows(PageTokenMismatchException::class.java) { PageTokenCodec.decode(legacy.joinToString(".")) }
  }

  @Test
  fun rejectsMalformedTokens() {
    assertThrows(PageTokenMismatchException::class.java) { PageTokenCodec.decode("") }
    assertThrows(PageTokenMismatchException::class.java) { PageTokenCodec.decode("not a token") }
    assertThrows(PageTokenMismatchException::class.java) { PageTokenCodec.decode("v0.aaaa") }
    val valid = Base64.getUrlDecoder().decode(PageTokenCodec.encode("snap-1", "fp", "k", "n", "e"))
    val b64 = Base64.getUrlEncoder().withoutPadding()
    // Truncated, and with trailing bytes.
    assertThrows(PageTokenMismatchException::class.java) {
      PageTokenCodec.decode(b64.encodeToString(valid.copyOf(valid.size - 1)))
    }
    assertThrows(PageTokenMismatchException::class.java) {
      PageTokenCodec.decode(b64.encodeToString(valid + byteArrayOf(0)))
    }
  }

  @Test
  fun rejectsSnapshotMismatch() {
    val token = PageTokenCodec.decode(PageTokenCodec.encode("snap-1", "fp", "k", "n", "e"))

    assertThrows(PageTokenMismatchException::class.java) {
      PageTokenCodec.requireMatches(token, snapshotId = "snap-2", queryFingerprint = "fp")
    }
  }

  @Test
  fun rejectsQueryFingerprintMismatch() {
    val token = PageTokenCodec.decode(PageTokenCodec.encode("snap-1", "fp-a", "k", "n", "e"))

    assertThrows(PageTokenMismatchException::class.java) {
      PageTokenCodec.requireMatches(token, snapshotId = "snap-1", queryFingerprint = "fp-b")
    }
  }

  @Test
  fun acceptsMatchingToken() {
    val token = PageTokenCodec.decode(PageTokenCodec.encode("snap-1", "fp-a", "k", "n", "e"))

    PageTokenCodec.requireMatches(token, snapshotId = "snap-1", queryFingerprint = "fp-a")
  }

  @Test
  fun aPageIsClampedToTwoHundredRows() {
    // D010: a token never widens a page; the clamp is the query's (SnapshotStoreTest reads it end to end).
    assertEquals(200, SnapshotQuery.MAX_PAGE_SIZE)
    assertEquals(SnapshotQuery.MAX_PAGE_SIZE, SnapshotQuery.boundedPageSize(Int.MAX_VALUE))
  }
}
