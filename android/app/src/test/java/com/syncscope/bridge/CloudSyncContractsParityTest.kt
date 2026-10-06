package com.syncscope.bridge

import com.syncscope.persistence.FileSort
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Fails the build if the Kotlin contract mirror drifts from src/native/CloudSyncContracts.ts. */
class CloudSyncContractsParityTest {

  private val tsSource: String by lazy {
    // Gradle runs unit tests with the module directory (android/app) as working dir.
    val file = File("../../src/native/CloudSyncContracts.ts")
    assertTrue("missing ${file.absolutePath}", file.isFile)
    file.readText()
  }

  private fun tsNumber(name: String): Int =
    Regex("""export const $name = (\d+);""").find(tsSource)!!.groupValues[1].toInt()

  @Test
  fun scalarConstantsMatch() {
    assertEquals(tsNumber("CLOUD_SYNC_CONTRACT_VERSION"), CloudSyncContracts.CONTRACT_VERSION)
    assertEquals(tsNumber("MAX_PAGE_SIZE"), CloudSyncContracts.MAX_PAGE_SIZE)
    assertEquals(tsNumber("DEFAULT_PAGE_SIZE"), CloudSyncContracts.DEFAULT_PAGE_SIZE)
    assertEquals(
      Regex("""CLOUD_SYNC_MODULE_NAME = '(\w+)'""").find(tsSource)!!.groupValues[1],
      CloudSyncContracts.MODULE_NAME,
    )
  }

  @Test
  fun errorCodesMatchExactly() {
    val block = Regex("""export const CloudSyncErrorCode = \{(.*?)\} as const""", RegexOption.DOT_MATCHES_ALL)
      .find(tsSource)!!
      .groupValues[1]
    val tsCodes = Regex("""(\w+): '(\w+)'""").findAll(block).map {
      assertEquals(it.groupValues[1], it.groupValues[2])
      it.groupValues[2]
    }.toList()

    assertEquals(tsCodes, CloudSyncErrorCode.entries.map { it.name })
  }

  @Test
  fun repositoryDefaultPortsMatchTs() {
    val block = Regex("""export const REPOSITORY_DEFAULT_PORTS = \{(.*?)\} as const""", RegexOption.DOT_MATCHES_ALL)
      .find(tsSource)!!
      .groupValues[1]
    val tsPorts = Regex("""(\w+): (\d+)""").findAll(block).associate { it.groupValues[1] to it.groupValues[2].toInt() }

    assertEquals(
      mapOf(
        "FTP" to RepositoryDefaultPorts.FTP,
        "SFTP" to RepositoryDefaultPorts.SFTP,
        "WEBDAV" to RepositoryDefaultPorts.WEBDAV,
        "WEBDAV_HTTPS" to RepositoryDefaultPorts.WEBDAV_HTTPS,
      ),
      tsPorts,
    )
    assertEquals(mapOf("FTP" to 21, "SFTP" to 22, "WEBDAV" to 80, "WEBDAV_HTTPS" to 443), tsPorts)
  }

  @Test
  fun maxDeletionPlanAgeMatchesTs() {
    val (minutes, seconds, millis) =
      Regex("""export const MAX_DELETION_PLAN_AGE_MILLIS = (\d+) \* (\d+) \* (\d+);""")
        .find(tsSource)!!
        .destructured
    assertEquals(minutes.toLong() * seconds.toLong() * millis.toLong(), CloudSyncContracts.MAX_DELETION_PLAN_AGE_MILLIS)
    assertEquals(900_000L, CloudSyncContracts.MAX_DELETION_PLAN_AGE_MILLIS)
  }

  @Test
  fun contractVersionIsSix() {
    assertEquals(6, CloudSyncContracts.CONTRACT_VERSION)
  }

  /** The members of a TS string-literal union `export type <name> = 'A' | 'B' …;`, in source order. */
  private fun tsUnion(name: String): List<String> {
    val body = Regex("""export type $name =([^;]*);""").find(tsSource)!!.groupValues[1]
    return Regex("""'(\w+)'""").findAll(body).map { it.groupValues[1] }.toList()
  }

  @Test
  fun sortKindAndScrollUnitEnumsMatchTs() {
    val sorts = listOf("NAME_ASC", "NAME_DESC", "TIME_ASC", "TIME_DESC", "SIZE_ASC", "SIZE_DESC")
    assertEquals(sorts, tsUnion("FileSort"))
    assertEquals(sorts, FileSort.entries.map { it.name })

    assertEquals(listOf("DIRECTORY", "FILE"), tsUnion("FileKind"))
    assertEquals(listOf("DIRECTORY", "FILE"), FileKind.entries.map { it.name })

    val units = listOf("LETTER", "YEAR", "MONTH", "DAY", "SIZE")
    assertEquals(units, tsUnion("ScrollUnit"))
    assertEquals(units, ScrollUnit.entries.map { it.name })
  }

  @Test
  fun scrollBandBoundsMatchTs() {
    assertEquals(tsNumber("SCROLL_BANDS_MIN"), CloudSyncContracts.SCROLL_BANDS_MIN)
    assertEquals(tsNumber("SCROLL_BANDS_MAX"), CloudSyncContracts.SCROLL_BANDS_MAX)
    assertEquals(5, CloudSyncContracts.SCROLL_BANDS_MIN)
    assertEquals(15, CloudSyncContracts.SCROLL_BANDS_MAX)
  }

  @Test
  fun sourceScanImageAndMvpErrorCodesSitJustBeforeInternalErrorInOrder() {
    val names = CloudSyncErrorCode.entries.map { it.name }
    assertEquals(
      listOf(
        "SOURCE_OVERLAP",
        "SOURCE_UNSUPPORTED",
        "SOURCE_REGRANT_MISMATCH",
        "SOURCE_NOT_FOUND",
        "PICKER_BUSY",
        "NO_SOURCES_SELECTED",
        "SCAN_IN_PROGRESS",
        "SCAN_NOT_FOUND",
        "REFRESH_UNAVAILABLE",
        "IMAGE_UNAVAILABLE",
        "TLS_UNTRUSTED",
        "DELETION_IN_PROGRESS",
        "REPOSITORY_CHANGED",
        "PLAN_NOT_FOUND",
        "PLAN_STALE",
        "INTERNAL_ERROR",
      ),
      names.takeLast(16),
    )
  }

  private fun tsErrorText(recordName: String): Map<String, Pair<String, String>> {
    val block = Regex("""export const $recordName[^=]*= \{(.*?)\n\};""", RegexOption.DOT_MATCHES_ALL)
      .find(tsSource)!!
      .groupValues[1]
    // A text containing an apostrophe is double-quoted in the TS source.
    return Regex("""(\w+): \{\s*message:\s*(['"])(.*?)\2,\s*action:\s*(['"])(.*?)\4,?\s*\}""")
      .findAll(block)
      .associate { it.groupValues[1] to (it.groupValues[3] to it.groupValues[5]) }
  }

  @Test
  fun fixedErrorTextMatchesTsExactly() {
    val sourceText = tsErrorText("SOURCE_ERROR_TEXT")
    val scanText = tsErrorText("SCAN_ERROR_TEXT")
    val imageText = tsErrorText("IMAGE_ERROR_TEXT")
    val mvpText = tsErrorText("MVP_ERROR_TEXT")
    val ktText = CloudSyncErrorCode.entries
      .filter { it.defaultMessage != null }
      .associate { it.name to (it.defaultMessage!! to it.defaultAction!!) }

    assertEquals(
      setOf("SOURCE_OVERLAP", "SOURCE_UNSUPPORTED", "SOURCE_REGRANT_MISMATCH", "SOURCE_NOT_FOUND", "PICKER_BUSY"),
      sourceText.keys,
    )
    assertEquals(
      setOf("NO_SOURCES_SELECTED", "SCAN_IN_PROGRESS", "SCAN_NOT_FOUND", "REFRESH_UNAVAILABLE"),
      scanText.keys,
    )
    assertEquals(setOf("IMAGE_UNAVAILABLE"), imageText.keys)
    assertEquals(
      setOf("TLS_UNTRUSTED", "DELETION_IN_PROGRESS", "REPOSITORY_CHANGED", "PLAN_NOT_FOUND", "PLAN_STALE"),
      mvpText.keys,
    )
    assertEquals(sourceText + scanText + imageText + mvpText, ktText)
    assertEquals(
      "The server's certificate is not trusted by this phone." to
        "Use a certificate from a public authority, or connect with SFTP.",
      ktText["TLS_UNTRUSTED"],
    )
    assertEquals("Files are being deleted." to "Wait until the deletion finishes.", ktText["DELETION_IN_PROGRESS"])
    assertEquals(
      "These results were made with your previous server settings." to "Scan again before deleting.",
      ktText["REPOSITORY_CHANGED"],
    )
    assertEquals(
      "This deletion is no longer available." to "Review the selection and tap Delete again.",
      ktText["PLAN_NOT_FOUND"],
    )
    assertEquals(
      "The results changed since you reviewed this deletion." to "Review the selection and tap Delete again.",
      ktText["PLAN_STALE"],
    )
    assertEquals(
      "This image could not be read on the device." to
        "Check that the folder is still available, then rescan.",
      ktText["IMAGE_UNAVAILABLE"],
    )
    assertEquals(
      "No folders are selected to check." to "Add a folder in Settings › Device folders.",
      ktText["NO_SOURCES_SELECTED"],
    )
    assertEquals(
      "This folder overlaps a folder you already added." to
        "Pick a folder that is not inside, or around, an existing one.",
      ktText["SOURCE_OVERLAP"],
    )
  }

  @Test
  fun fileIssueTextMatchesTsExactly() {
    val block = Regex("""export const FILE_ISSUE_TEXT[^=]*= \{(.*?)\n\};""", RegexOption.DOT_MATCHES_ALL)
      .find(tsSource)!!
      .groupValues[1]
    val tsText = Regex("""(\w+):\s*'([^']*)',""")
      .findAll(block)
      .associate { it.groupValues[1] to it.groupValues[2] }

    assertEquals(FileIssueCode.entries.associate { it.name to it.text }, tsText)
    assertEquals(
      "The backup has this file but no modified time, so it could not be compared.",
      FileIssueCode.REMOTE_MTIME_MISSING.text,
    )
    assertEquals("This file could not be read on the device.", FileIssueCode.LOCAL_UNAVAILABLE.text)
    assertEquals(
      "A backup folder could not be read, so this file may be backed up there.",
      FileIssueCode.REMOTE_FOLDER_UNREAD.text,
    )
  }

  @Test
  fun clampPageSizeMatchesTsSemantics() {
    assertEquals(50, CloudSyncContracts.clampPageSize(null))
    assertEquals(50, CloudSyncContracts.clampPageSize(Double.NaN))
    assertEquals(50, CloudSyncContracts.clampPageSize(Double.POSITIVE_INFINITY))
    assertEquals(1, CloudSyncContracts.clampPageSize(0.0))
    assertEquals(1, CloudSyncContracts.clampPageSize(-7.0))
    assertEquals(1, CloudSyncContracts.clampPageSize(0.9))
    assertEquals(37, CloudSyncContracts.clampPageSize(37.8))
    assertEquals(200, CloudSyncContracts.clampPageSize(201.0))
    assertEquals(200, CloudSyncContracts.clampPageSize(1e12))
  }

  @Test
  fun localImageEdgeBoundsMatchTs() {
    assertEquals(tsNumber("LOCAL_IMAGE_MIN_EDGE_PX"), LocalImageSpec.MIN_EDGE_PX)
    assertEquals(tsNumber("LOCAL_IMAGE_MAX_EDGE_PX"), LocalImageSpec.MAX_EDGE_PX)
    assertEquals(64, LocalImageSpec.MIN_EDGE_PX)
    assertEquals(2048, LocalImageSpec.MAX_EDGE_PX)
  }

  @Test
  fun imageEdgeClampMatchesTsClampImageEdge() {
    // Expected values are those of the TS `clampImageEdge` (asserted on the same inputs in
    // src/native/__tests__/CloudSyncContracts.test.ts).
    val expected = mapOf(-1 to 64, 0 to 64, 63 to 64, 64 to 64, 256 to 256, 2048 to 2048, 2049 to 2048)
    expected.forEach { (input, bounded) ->
      assertEquals("bounded($input)", bounded, LocalImageSpec.bounded(input))
    }
    assertTrue(
      "clampImageEdge must clamp between the two edge constants",
      Regex(
        """export function clampImageEdge\(px: number\): number \{.*?LOCAL_IMAGE_MIN_EDGE_PX.*?LOCAL_IMAGE_MAX_EDGE_PX""",
        RegexOption.DOT_MATCHES_ALL,
      ).containsMatchIn(tsSource),
    )
  }
}
