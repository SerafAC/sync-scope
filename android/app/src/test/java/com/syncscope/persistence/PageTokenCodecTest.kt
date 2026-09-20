package com.syncscope.persistence

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class PageTokenCodecTest {

  @Test
  fun roundTripsAllFields() {
    val encoded =
      PageTokenCodec.encode(
        snapshotId = "snap-1",
        queryFingerprint = "fp-abc",
        sortKey = "report;final.pdf",
        lastEntryId = "entry-9",
      )

    val decoded = PageTokenCodec.decode(encoded)

    assertEquals("snap-1", decoded.snapshotId)
    assertEquals("fp-abc", decoded.queryFingerprint)
    assertEquals("report;final.pdf", decoded.sortKey)
    assertEquals("entry-9", decoded.lastEntryId)
  }

  @Test
  fun rejectsMalformedTokens() {
    assertThrows(PageTokenMismatchException::class.java) { PageTokenCodec.decode("") }
    assertThrows(PageTokenMismatchException::class.java) { PageTokenCodec.decode("not-a-token") }
    assertThrows(PageTokenMismatchException::class.java) { PageTokenCodec.decode("v0.aaaa") }
    assertThrows(PageTokenMismatchException::class.java) {
      PageTokenCodec.decode("v1.c25hcA==.ZnA=")
    }
  }

  @Test
  fun rejectsSnapshotMismatch() {
    val token = PageTokenCodec.decode(PageTokenCodec.encode("snap-1", "fp", "k", "e"))

    assertThrows(PageTokenMismatchException::class.java) {
      PageTokenCodec.requireMatches(token, snapshotId = "snap-2", queryFingerprint = "fp")
    }
  }

  @Test
  fun rejectsQueryFingerprintMismatch() {
    val token = PageTokenCodec.decode(PageTokenCodec.encode("snap-1", "fp-a", "k", "e"))

    assertThrows(PageTokenMismatchException::class.java) {
      PageTokenCodec.requireMatches(token, snapshotId = "snap-1", queryFingerprint = "fp-b")
    }
  }

  @Test
  fun acceptsMatchingToken() {
    val token = PageTokenCodec.decode(PageTokenCodec.encode("snap-1", "fp-a", "k", "e"))

    PageTokenCodec.requireMatches(token, snapshotId = "snap-1", queryFingerprint = "fp-a")
  }
}
