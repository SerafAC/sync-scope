package com.syncscope.remote

import com.syncscope.bridge.CloudSyncErrorCode
import java.time.Instant
import java.util.TimeZone
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.apache.commons.net.ftp.FTPClient
import org.apache.commons.net.ftp.FTPClientConfig
import org.apache.commons.net.ftp.FTPFile
import org.apache.commons.net.ftp.parser.DefaultFTPFileEntryParserFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The empty-LIST CWD probe (research R5, decision log 2026-09-30): vsftpd answers LIST on a
 * `0700` directory with no entries, so only a refused CWD tells it apart from an empty folder.
 * And LIST dates read as UTC, with the precision LIST actually prints (decision log 2026-10-01).
 */
class FtpRemoteClientTest {

  // --- LIST dates and precision (decision log 2026-10-01) ---

  @Test
  fun listDatesAreReadAsUtcWhateverTheDeviceTimeZone() {
    withDefaultTimeZone("Europe/Bucharest") {
      val dateOnly = parseList("-rw-r--r--    1 1000     1000           23 Jan 01  2024 exact.txt")
      val recent = parseList("-rw-r--r--    1 1000     1000           23 Jan 01 10:30 recent.txt")

      assertEquals(Instant.parse("2024-01-01T00:00:00Z").toEpochMilli(), FtpListing.toEntry(dateOnly)!!.modifiedUtcMillis)
      val recentUtc = Instant.ofEpochMilli(recent.timestamp.timeInMillis).toString()
      assertTrue(recentUtc, recentUtc.endsWith("-01-01T10:30:00Z"))
    }
  }

  @Test
  fun theSessionConfiguresUtcListParsingBeforeItsFirstList() {
    val fake = FakeFtp(listings = mapOf("/d" to arrayOf(file("exact.txt"))))
    val client = connected(fake)

    runBlocking { client.list("/d") }
    runBlocking { client.list("/d") }

    assertEquals(1, fake.configured.size)
    assertEquals("UNIX Type: L8", fake.configured.single().serverSystemKey)
    assertEquals("UTC", fake.configured.single().serverTimeZoneId)
    assertEquals(listOf("configure", "LIST /d", "LIST /d"), fake.listCalls)
  }

  @Test
  fun aListOnlyServerReportsListPrecisionEvenWhenItAdvertisesMdtm() {
    val listing =
      arrayOf(
        parseList("-rw-r--r--    1 1000     1000           23 Jan 01  2024 exact.txt"),
        parseList("-rw-r--r--    1 1000     1000           23 Jan 01 10:30 recent.txt"),
      )
    val fake = FakeFtp(listings = mapOf("/" to listing), features = setOf("MDTM"))

    val finding = runBlocking { connected(fake).discoverPrecision() }

    assertEquals(PrecisionBasis.LIST_GRANULARITY, finding.basis)
    assertEquals(86_400_000L, finding.precisionMillis)
    assertTrue("MDTM must not be sent", fake.mdtmCalls.isEmpty())
  }

  @Test
  fun aListOnlyServerWithMinuteDatesIsMinuteGranular() {
    val listing = arrayOf(parseList("-rw-r--r--    1 1000     1000           23 Jan 01 10:30 recent.txt"))
    val fake = FakeFtp(listings = mapOf("/" to listing), features = setOf("MDTM"))

    val finding = runBlocking { connected(fake).discoverPrecision() }

    assertEquals(PrecisionBasis.LIST_GRANULARITY, finding.basis)
    assertEquals(60_000L, finding.precisionMillis)
  }

  // --- Empty-LIST CWD probe (decision log 2026-09-30) ---

  @Test
  fun emptyListingOfARefusedDirectoryIsUnreadable() {
    val fake = FakeFtp(listings = mapOf("/scan/partial/restricted" to emptyArray()), refusedCwd = setOf("/scan/partial/restricted"))

    val error =
      assertThrows(RemoteClientException::class.java) { runBlocking { connected(fake).list("/scan/partial/restricted") } }

    assertEquals(CloudSyncErrorCode.DIRECTORY_UNREADABLE, error.code)
    assertEquals(listOf("PWD", "CWD /scan/partial/restricted"), fake.commands)
    assertEquals("/", fake.cwd)
  }

  @Test
  fun emptyReadableDirectoryListsAsEmptyAndTheSessionGoesBack() {
    val fake = FakeFtp(listings = mapOf("/scan/empty" to emptyArray()))

    val entries = runBlocking { connected(fake).list("/scan/empty") }

    assertTrue(entries.isEmpty())
    assertEquals(listOf("PWD", "CWD /scan/empty", "CWD /"), fake.commands)
    assertEquals("/", fake.cwd)
  }

  @Test
  fun onlyDotEntriesCountAsEmptyAndAreProbed() {
    val fake =
      FakeFtp(
        listings = mapOf("/d" to arrayOf(dir("."), dir(".."))),
        refusedCwd = setOf("/d"),
      )

    val error = assertThrows(RemoteClientException::class.java) { runBlocking { connected(fake).list("/d") } }

    assertEquals(CloudSyncErrorCode.DIRECTORY_UNREADABLE, error.code)
  }

  @Test
  fun nonEmptyListingIsNeverProbed() {
    val fake = FakeFtp(listings = mapOf("/d" to arrayOf(file("exact.txt"))))

    val entries = runBlocking { connected(fake).list("/d") }

    assertEquals(listOf("exact.txt"), entries.map { it.name })
    assertTrue(fake.commands.isEmpty())
  }

  @Test
  fun aCwdRefusalOtherThan550KeepsTheEmptyListing() {
    val fake = FakeFtp(listings = mapOf("/d" to emptyArray()), refusedCwd = setOf("/d"), refusalCode = 421)

    val entries = runBlocking { connected(fake).list("/d") }

    assertTrue(entries.isEmpty())
  }

  @Test
  fun failingToGoBackIsAConnectionLoss() {
    val fake = FakeFtp(listings = mapOf("/d" to emptyArray()), refusedCwd = setOf("/"))

    val error = assertThrows(RemoteClientException::class.java) { runBlocking { connected(fake).list("/d") } }

    assertEquals(CloudSyncErrorCode.CONNECTION_LOST, error.code)
  }

  /** One vsftpd LIST line through the parser the session configures. */
  private fun parseList(line: String): FTPFile =
    DefaultFTPFileEntryParserFactory()
      .createFileEntryParser(FtpListing.listConfig("UNIX Type: L8"))
      .parseFTPEntry(line)

  private fun withDefaultTimeZone(id: String, block: () -> Unit) {
    val original = TimeZone.getDefault()
    TimeZone.setDefault(TimeZone.getTimeZone(id))
    try {
      block()
    } finally {
      TimeZone.setDefault(original)
    }
  }

  private fun connected(fake: FakeFtp): FtpRemoteClient {
    val client = FtpRemoteClient(dispatcher = Dispatchers.Unconfined, clientFactory = { fake })
    val config =
      RemoteConfig(
        protocol = RemoteProtocol.FTP,
        host = "127.0.0.1",
        port = 21,
        username = "u",
        rootPath = "/",
      )
    runBlocking { client.connect(config, "p".toCharArray()) }
    return client
  }

  private fun file(name: String) =
    FTPFile().apply {
      this.name = name
      type = FTPFile.FILE_TYPE
      size = 1
    }

  private fun dir(name: String) =
    FTPFile().apply {
      this.name = name
      type = FTPFile.DIRECTORY_TYPE
    }

  /** A LIST-only server (no MLST) with a scripted working directory; no socket is opened. */
  private class FakeFtp(
    private val listings: Map<String, Array<FTPFile>>,
    private val refusedCwd: Set<String> = emptySet(),
    private val refusalCode: Int = 550,
    private val features: Set<String> = emptySet(),
  ) : FTPClient() {
    val commands = mutableListOf<String>()
    val configured = mutableListOf<FTPClientConfig>()
    val listCalls = mutableListOf<String>()
    val mdtmCalls = mutableListOf<String>()
    var cwd = "/"
    private var reply = 220
    private var connected = false

    override fun connect(hostname: String, port: Int) {
      connected = true
      reply = 220
    }

    override fun isConnected(): Boolean = connected

    override fun setSoTimeout(timeout: Int) {}

    override fun login(username: String, password: String): Boolean {
      reply = 230
      return true
    }

    override fun getReplyCode(): Int = reply

    override fun hasFeature(feature: String): Boolean = feature in features

    override fun getSystemType(): String = "UNIX Type: L8"

    override fun configure(config: FTPClientConfig) {
      configured += config
      listCalls += "configure"
    }

    override fun mdtmInstant(pathname: String): Instant? {
      mdtmCalls += pathname
      return Instant.parse("2024-01-01T00:00:00Z")
    }

    override fun listFiles(pathname: String): Array<FTPFile> {
      listCalls += "LIST $pathname"
      reply = 226
      return listings.getValue(pathname)
    }

    override fun printWorkingDirectory(): String {
      commands += "PWD"
      reply = 257
      return cwd
    }

    override fun changeWorkingDirectory(pathname: String): Boolean {
      commands += "CWD $pathname"
      if (pathname in refusedCwd) {
        reply = refusalCode
        return false
      }
      cwd = pathname
      reply = 250
      return true
    }

    override fun logout(): Boolean = true

    override fun disconnect() {
      connected = false
    }
  }
}
