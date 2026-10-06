package com.syncscope.bridge

import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.JavaOnlyMap
import com.syncscope.deletion.DeletionPlanView
import com.syncscope.deletion.DeletionResultView
import com.syncscope.deletion.DeletionState
import com.syncscope.deletion.FailureView
import com.syncscope.deletion.GroupTotals
import com.syncscope.persistence.FileEntry
import com.syncscope.remote.HostKeyChallenge
import com.syncscope.remote.RemoteClientException
import com.syncscope.remote.SftpHostKeyException
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
  fun fileEntryWritesEveryFileEntryDtoFieldIncludingSortName() {
    val entry =
      FileEntry(
        entryId = "e-1",
        sourceId = "src-1",
        parentId = null,
        kind = "FILE",
        name = "Émile.jpg",
        mimeType = "image/jpeg",
        sizeBytes = 3L,
        modifiedUtcMillis = null,
        status = "SYNCED",
        issueCode = null,
        nameInOtherSource = true,
        matchingFileCount = null,
        sortName = "1emile.jpg",
      )

    val dto = envelope.fileEntry(entry)

    assertEquals("1emile.jpg", dto.getString("sortName"))
    assertEquals("Émile.jpg", dto.getString("name"))
    assertEquals("e-1", dto.getString("entryId"))
    assertEquals(3.0, dto.getDouble("sizeBytes"), 0.0)
    assertTrue(dto.isNull("parentId"))
    assertTrue(dto.isNull("modifiedUtcMillis"))
    assertTrue(dto.isNull("matchingFileCount"))
    assertTrue(dto.getBoolean("nameInOtherSource"))
    assertEquals(
      setOf(
        "entryId", "sourceId", "parentId", "kind", "name", "mimeType", "sizeBytes", "modifiedUtcMillis", "status",
        "issueCode", "nameInOtherSource", "matchingFileCount", "sortName",
      ),
      dto.toHashMap().keys,
    )
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

  @Test
  fun errorOmitsFieldWhenNull() {
    val body = envelope.error(CloudSyncErrorCode.INVALID_QUERY, "Bad filter.").getMap("error")!!

    assertFalse(body.hasKey("field"))
  }

  @Test
  fun errorCarriesFieldWhenGiven() {
    val body = envelope.error(CloudSyncErrorCode.INVALID_QUERY, "Bad port.", field = "port").getMap("error")!!

    assertEquals("port", body.getString("field"))
  }

  @Test
  fun invalidFieldNamesTheFieldInErrorField() {
    val body = envelope.invalidField("host", "it is required").getMap("error")!!

    assertEquals("INVALID_QUERY", body.getString("code"))
    assertEquals("host", body.getString("field"))
    assertEquals("The repository host is invalid: it is required.", body.getString("message"))
    assertEquals("Correct the host and save again.", body.getString("action"))
  }

  @Test
  fun fieldIsNotRedacted() {
    val body =
      envelope
        .error(CloudSyncErrorCode.INVALID_QUERY, "Bad root.", sensitive = listOf("remoteRoot"), field = "remoteRoot")
        .getMap("error")!!

    assertEquals("remoteRoot", body.getString("field"))
  }

  // --- deletion envelopes (contracts/cloudsync-mvp.md, T066) ---

  @Test
  fun deletionPlanHasExactlyTheContractFields() {
    val plan =
      DeletionPlanView(
        token = "tok",
        toDelete = GroupTotals(3, 3_000L),
        unsynced = GroupTotals(2, 20L),
        refusedCount = 4,
        scanTooOld = 1,
        movedByRecheck = 2,
        missing = 5,
        unknownSizeCount = 1,
        remoteListedAtMillis = 1_704_067_200_000L,
      )

    val result = envelope.deletionPlan(plan)

    assertEquals("ok", result.getString("status"))
    val dto = result.getMap("plan")!!
    assertEquals(
      setOf("planToken", "toDelete", "unsynced", "refused", "movedByRecheck", "missing", "unknownSizeCount", "remoteListedAtMillis"),
      dto.toHashMap().keys,
    )
    assertEquals("tok", dto.getString("planToken"))
    assertEquals(3.0, dto.getMap("toDelete")!!.getDouble("count"), 0.0)
    assertEquals(3_000.0, dto.getMap("toDelete")!!.getDouble("bytes"), 0.0)
    assertEquals(setOf("count", "bytes"), dto.getMap("unsynced")!!.toHashMap().keys)
    assertEquals(20.0, dto.getMap("unsynced")!!.getDouble("bytes"), 0.0)
    assertEquals(setOf("count", "scanTooOld"), dto.getMap("refused")!!.toHashMap().keys)
    assertEquals(4.0, dto.getMap("refused")!!.getDouble("count"), 0.0)
    assertEquals(1.0, dto.getMap("refused")!!.getDouble("scanTooOld"), 0.0)
    assertEquals(2.0, dto.getDouble("movedByRecheck"), 0.0)
    assertEquals(5.0, dto.getDouble("missing"), 0.0)
    assertEquals(1.0, dto.getDouble("unknownSizeCount"), 0.0)
    assertEquals(1_704_067_200_000.0, dto.getDouble("remoteListedAtMillis"), 0.0)
  }

  @Test
  fun deletionResultCarriesIdsAndNamesButNoUri() {
    val result =
      envelope.deletionResult(
        DeletionResultView(
          deleted = 2,
          freedBytes = 300L,
          failures =
            listOf(
              FailureView("e3", "beach.png", DeletionState.ALREADY_GONE),
              FailureView("e4", "sunset.png", DeletionState.CHANGED),
              FailureView("e5", "a.png", DeletionState.ACCESS_LOST),
              FailureView("e6", "b.png", DeletionState.FAILED),
            ),
          removedEntryIds = listOf("e1", "e2", "e3"),
        )
      )

    val dto = result.getMap("result")!!
    assertEquals(setOf("deleted", "freedBytes", "failures", "removedEntryIds"), dto.toHashMap().keys)
    assertEquals(2.0, dto.getDouble("deleted"), 0.0)
    assertEquals(300.0, dto.getDouble("freedBytes"), 0.0)
    val failures = dto.getArray("failures")!!
    assertEquals(4, failures.size())
    assertEquals(setOf("entryId", "name", "reason"), failures.getMap(0)!!.toHashMap().keys)
    assertEquals(
      listOf("ALREADY_GONE", "CHANGED", "ACCESS_LOST", "FAILED"),
      (0 until failures.size()).map { failures.getMap(it)!!.getString("reason") },
    )
    assertEquals("beach.png", failures.getMap(0)!!.getString("name"))
    val removed = dto.getArray("removedEntryIds")!!
    assertEquals(listOf("e1", "e2", "e3"), (0 until removed.size()).map { removed.getString(it) })
    assertFalse(result.toString().contains("content://"))
  }

  @Test
  fun deletionRefusalsUseTheirContractText() {
    for (code in listOf(CloudSyncErrorCode.REPOSITORY_CHANGED, CloudSyncErrorCode.PLAN_NOT_FOUND, CloudSyncErrorCode.PLAN_STALE, CloudSyncErrorCode.SCAN_IN_PROGRESS, CloudSyncErrorCode.DELETION_IN_PROGRESS)) {
      val body = envelope.deletionRefused(code).getMap("error")!!
      assertEquals(code.name, body.getString("code"))
      assertEquals(code.defaultMessage, body.getString("message"))
      assertEquals(code.defaultAction, body.getString("action"))
    }
    assertEquals("entryIds", envelope.deletionRefused(CloudSyncErrorCode.INVALID_QUERY).getMap("error")!!.getString("field"))
    assertEquals(
      "Set up your server in Settings › Repository.",
      envelope.deletionRefused(CloudSyncErrorCode.REPOSITORY_NOT_CONFIGURED).getMap("error")!!.getString("action"),
    )
    for (code in listOf(CloudSyncErrorCode.SNAPSHOT_NOT_FOUND, CloudSyncErrorCode.STALE_GENERATION)) {
      assertEquals(code.name, envelope.deletionRefused(code).getMap("error")!!.getString("code"))
    }
  }

  @Test
  fun aHostKeyFailureDuringDeletionSendsToSettingsWithoutAChallenge() {
    val challenge = HostKeyChallenge("c1", "nas.example.com", 22, "ssh-ed25519", "AAAA", "SHA256:abc", null, 1L)
    val body =
      envelope.deletionRemoteFailure(SftpHostKeyException(CloudSyncErrorCode.SFTP_HOST_KEY_UNVERIFIED, challenge)).getMap("error")!!

    assertEquals("SFTP_HOST_KEY_UNVERIFIED", body.getString("code"))
    assertEquals("Check the server in Settings › Repository.", body.getString("action"))
    assertFalse(body.hasKey("hostKeyChallenge"))
  }

  @Test
  fun aConnectionFailureDuringDeletionKeepsItsCodeAndIsRedacted() {
    val failure = RemoteClientException(CloudSyncErrorCode.CONNECTION_REFUSED, "No answer from nas.local for alice", "Check the server.")
    val body = envelope.deletionRemoteFailure(failure, sensitive = listOf("nas.local", "alice")).getMap("error")!!

    assertEquals("CONNECTION_REFUSED", body.getString("code"))
    assertEquals("Check the server.", body.getString("action"))
    assertFalse(body.getString("message")!!.contains("nas.local"))
    assertFalse(body.getString("message")!!.contains("alice"))
  }
}
