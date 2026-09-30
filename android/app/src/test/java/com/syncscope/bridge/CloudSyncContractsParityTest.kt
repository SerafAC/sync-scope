package com.syncscope.bridge

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
  fun contractVersionIsThree() {
    assertEquals(3, CloudSyncContracts.CONTRACT_VERSION)
  }

  @Test
  fun sourceAndScanErrorCodesSitJustBeforeInternalErrorInOrder() {
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
        "INTERNAL_ERROR",
      ),
      names.takeLast(10),
    )
  }

  private fun tsErrorText(recordName: String): Map<String, Pair<String, String>> {
    val block = Regex("""export const $recordName[^=]*= \{(.*?)\n\};""", RegexOption.DOT_MATCHES_ALL)
      .find(tsSource)!!
      .groupValues[1]
    return Regex("""(\w+): \{\s*message:\s*'([^']*)',\s*action:\s*'([^']*)',?\s*\}""")
      .findAll(block)
      .associate { it.groupValues[1] to (it.groupValues[2] to it.groupValues[3]) }
  }

  @Test
  fun fixedErrorTextMatchesTsExactly() {
    val sourceText = tsErrorText("SOURCE_ERROR_TEXT")
    val scanText = tsErrorText("SCAN_ERROR_TEXT")
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
    assertEquals(sourceText + scanText, ktText)
    assertEquals(
      "No folders are selected to check." to "Add a folder in Settings › Folders.",
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
}
