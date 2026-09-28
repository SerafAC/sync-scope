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
