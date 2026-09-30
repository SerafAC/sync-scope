package com.syncscope.bridge

import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.JavaOnlyMap
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CloudSyncEnvelopeTest {

  private val envelope = CloudSyncEnvelope({ JavaOnlyMap() }, { JavaOnlyArray() })

  @Test
  fun okCarriesContractVersionAndStatus() {
    val ok = envelope.ok()

    assertEquals(CloudSyncContracts.CONTRACT_VERSION, ok.getInt("contractVersion"))
    assertEquals("ok", ok.getString("status"))
    assertFalse(ok.hasKey("error"))
  }

  @Test
  fun errorCarriesCodeMessageAndNullableAction() {
    val err = envelope.error(CloudSyncErrorCode.INVALID_QUERY, "Bad filter.")

    assertEquals("error", err.getString("status"))
    val body = err.getMap("error")!!
    assertEquals("INVALID_QUERY", body.getString("code"))
    assertEquals("Bad filter.", body.getString("message"))
    assertTrue(body.hasKey("action"))
    assertTrue(body.isNull("action"))
  }

  @Test
  fun pageErrorIsFilePageResultShaped() {
    val err = envelope.pageNotImplemented("queryFiles")

    assertEquals("error", err.getString("status"))
    assertTrue(err.isNull("page"))
    assertEquals("NOT_IMPLEMENTED", err.getMap("error")!!.getString("code"))
  }

  @Test
  fun pageOkNestsEntriesTokenAndCounts() {
    val result = envelope.page(JavaOnlyArray(), nextPageToken = null, counts = null)

    assertEquals("ok", result.getString("status"))
    val page = result.getMap("page")!!
    assertEquals(0, page.getArray("entries")!!.size())
    assertTrue(page.isNull("nextPageToken"))
    assertTrue(page.isNull("counts"))
  }

  @Test
  fun internalErrorRedactsThrowableMessage() {
    val t = IllegalStateException("login failed for alice@nas.example.com at /srv/backup/photos")

    val body = envelope.internalError(t).getMap("error")!!

    assertEquals("INTERNAL_ERROR", body.getString("code"))
    val message = body.getString("message")!!
    assertFalse(message, message.contains("alice"))
    assertFalse(message, message.contains("nas.example.com"))
    assertFalse(message, message.contains("/srv/backup"))
    assertTrue(message, message.contains("IllegalStateException"))
  }

  @Test
  fun internalErrorToleratesNullMessage() {
    val body = envelope.internalError(RuntimeException(), page = true)

    assertEquals("INTERNAL_ERROR", body.getMap("error")!!.getString("code"))
    assertTrue(body.isNull("page"))
  }

  @Test
  fun redactStripsHostsUsersAndPaths() {
    val cases =
      listOf(
        "connect to 10.0.2.2:2222 refused",
        "ftp://bob:pw@files.home.lan/data/x.jpg failed",
        "user bob@10.0.2.2 rejected",
        "cannot resolve sftp.example.org",
        "no such file /storage/emulated/0/DCIM/Camera/IMG_1.jpg",
        "remote dir ~/backup/2024 missing",
        "path C:\\Users\\bob\\Pictures unreadable",
        "host [fe80::1ff:fe23:4567:890a] down",
      )
    val leaks = listOf("10.0.2.2", "bob", "files.home.lan", "sftp.example.org", "/storage", "DCIM", "backup", "Users", "fe80")

    for (case in cases) {
      val redacted = CloudSyncEnvelope.redact(case)
      for (leak in leaks) {
        assertFalse("'$redacted' leaks '$leak'", redacted.contains(leak))
      }
      assertTrue(redacted, redacted.contains(CloudSyncEnvelope.REDACTED))
    }
  }

  @Test
  fun redactRemovesExplicitSensitiveValuesThatNoPatternMatches() {
    val redacted = CloudSyncEnvelope.redact("Auth failed for Nas-Box as Carol", listOf("nas-box", "carol"))

    assertEquals("Auth failed for [redacted] as [redacted]", redacted)
  }

  @Test
  fun redactLeavesPlainMessagesUntouched() {
    val plain = "Scan cancelled; retry when ready."

    assertEquals(plain, CloudSyncEnvelope.redact(plain))
    assertEquals("", CloudSyncEnvelope.redact("", listOf("", " ")))
  }

  @Test
  fun actionIsRedactedToo() {
    val err = envelope.error(CloudSyncErrorCode.INTERNAL_ERROR, "x", action = "Check 192.168.1.5")

    assertNull(Regex("""\d+\.\d+""").find(err.getMap("error")!!.getString("action")!!))
  }

  @Test
  fun sourceOverlapCarriesStructuredConflictingSource() {
    val err = envelope.sourceError(
      CloudSyncErrorCode.SOURCE_OVERLAP,
      ConflictingSource(sourceId = "src-1", alias = "Camera"),
    )

    val body = err.getMap("error")!!
    assertEquals("SOURCE_OVERLAP", body.getString("code"))
    assertEquals("This folder overlaps a folder you already added.", body.getString("message"))
    assertEquals("Pick a folder that is not inside, or around, an existing one.", body.getString("action"))
    val conflict = body.getMap("conflictingSource")!!
    assertEquals("src-1", conflict.getString("sourceId"))
    assertEquals("Camera", conflict.getString("alias"))
  }

  @Test
  fun conflictingSourceAliasIsNotRedacted() {
    // An alias that the message redaction rules would scrub if it went through them.
    val alias = "DCIM/Camera (photos.example.com)"
    val err = envelope.error(
      CloudSyncErrorCode.SOURCE_OVERLAP,
      "This folder overlaps a folder you already added.",
      sensitive = listOf("DCIM"),
      conflictingSource = ConflictingSource("src-1", alias),
    )

    assertEquals(alias, err.getMap("error")!!.getMap("conflictingSource")!!.getString("alias"))
  }

  @Test
  fun conflictingSourceIsAbsentOnEveryOtherCode() {
    val conflict = ConflictingSource("src-1", "Camera")
    for (code in CloudSyncErrorCode.entries.filter { it != CloudSyncErrorCode.SOURCE_OVERLAP }) {
      val body = envelope.error(code, "Message.", conflictingSource = conflict).getMap("error")!!
      assertFalse(code.name, body.hasKey("conflictingSource"))
    }
    val plainOverlap = envelope.sourceError(CloudSyncErrorCode.SOURCE_OVERLAP).getMap("error")!!
    assertFalse(plainOverlap.hasKey("conflictingSource"))
  }

  @Test
  fun sourceErrorsUseTheirContractText() {
    val body = envelope.sourceError(CloudSyncErrorCode.PICKER_BUSY).getMap("error")!!

    assertEquals("PICKER_BUSY", body.getString("code"))
    assertEquals("The folder picker is already open.", body.getString("message"))
    assertEquals("Finish or close the picker, then try again.", body.getString("action"))
    assertFalse(body.hasKey("conflictingSource"))
  }
}
