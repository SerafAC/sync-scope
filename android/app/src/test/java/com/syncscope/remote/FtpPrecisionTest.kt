package com.syncscope.remote

import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.JavaOnlyMap
import com.syncscope.bridge.CloudSyncEnvelope
import com.syncscope.bridge.CloudSyncErrorCode
import java.io.IOException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.time.Instant
import java.util.Calendar
import java.util.TimeZone
import org.apache.commons.net.ftp.FTPConnectionClosedException
import org.apache.commons.net.ftp.FTPFile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/** Pure FTP logic; live-server listings against vsftpd are proven by androidTest (T08). */
class FtpPrecisionTest {

  private val base = Instant.parse("2026-09-21T15:30:00Z")

  // --- MDTM ---

  @Test
  fun mdtmWithMillisecondNanosIsOneMillisecond() {
    val finding = FtpPrecision.fromMdtm(listOf(base.plusMillis(123)))!!

    assertEquals(1L, finding.precisionMillis)
    assertEquals(PrecisionBasis.MDTM_SUBSECOND, finding.basis)
  }

  @Test
  fun mdtmWithoutNanosIsWholeSecondsEvenThoughMdtmIsAdvertised() {
    val finding = FtpPrecision.fromMdtm(listOf(base, base.plusSeconds(7)))!!

    assertEquals(1_000L, finding.precisionMillis)
    assertEquals(PrecisionBasis.MDTM_WHOLE_SECONDS, finding.basis)
  }

  @Test
  fun oneSubsecondSampleOutvotesSamplesThatLandOnWholeSeconds() {
    val finding = FtpPrecision.fromMdtm(listOf(base, base.plusMillis(2_457), base.plusSeconds(3)))!!

    assertEquals(1L, finding.precisionMillis)
    assertEquals(PrecisionBasis.MDTM_SUBSECOND, finding.basis)
  }

  @Test
  fun tenthsAndHundredthsAreNotMistakenForMilliseconds() {
    assertEquals(100L, FtpPrecision.fromMdtm(listOf(base.plusMillis(500)))!!.precisionMillis)
    assertEquals(10L, FtpPrecision.fromMdtm(listOf(base.plusMillis(250)))!!.precisionMillis)
    assertEquals(1L, FtpPrecision.granularityOfNanos(1_000))
  }

  @Test
  fun noMdtmRepliesYieldNoFindingSoTheCallerFallsBack() {
    assertNull(FtpPrecision.fromMdtm(emptyList()))
  }

  // --- MLSD modify fact ---

  @Test
  fun mlsdFractionalModifyIsSubsecond() {
    val finding =
      FtpPrecision.fromMlsdFacts(listOf("type=file;size=12;modify=20260921153000.123; a.jpg"))!!

    assertEquals(1L, finding.precisionMillis)
    assertEquals(PrecisionBasis.MLSD_SUBSECOND, finding.basis)
  }

  @Test
  fun mlsdWholeSecondModifyIsOneSecond() {
    val finding =
      FtpPrecision.fromMlsdFacts(
        listOf("type=file;size=12;modify=20260921153000; a.jpg", "Modify=20260921153001.000;type=file; b.jpg"),
      )!!

    assertEquals(1_000L, finding.precisionMillis)
    assertEquals(PrecisionBasis.MLSD_WHOLE_SECONDS, finding.basis)
  }

  @Test
  fun mlsdLinesWithoutModifyYieldNoFinding() {
    assertNull(FtpPrecision.fromMlsdFacts(listOf("type=file;size=12; a.jpg", "")))
    assertNull(FtpPrecision.fromMlsdFacts(emptyList()))
  }

  // --- LIST granularity floor ---

  @Test
  fun listWithSecondsIsStillFlooredToOneMinute() {
    val finding = FtpPrecision.fromListTimestamps(listOf(calendar(hour = 15, minute = 30, second = 12)))

    assertEquals(FtpPrecision.LIST_FLOOR_MILLIS, finding.precisionMillis)
    assertEquals(PrecisionBasis.LIST_GRANULARITY, finding.basis)
  }

  @Test
  fun listRecentFormIsMinuteGranular() {
    val finding = FtpPrecision.fromListTimestamps(listOf(calendar(hour = 15, minute = 30)))

    assertEquals(60_000L, finding.precisionMillis)
  }

  @Test
  fun listYearFormIsDayGranularAndTheCoarsestSampleWins() {
    val finding =
      FtpPrecision.fromListTimestamps(listOf(calendar(hour = 15, minute = 30), calendar()))

    assertEquals(86_400_000L, finding.precisionMillis)
    assertEquals(PrecisionBasis.LIST_GRANULARITY, finding.basis)
  }

  @Test
  fun noListSamplesIsTheConservativeNoSampleFinding() {
    val finding = FtpPrecision.fromListTimestamps(emptyList())

    assertEquals(60_000L, finding.precisionMillis)
    assertEquals(PrecisionBasis.NO_SAMPLE_FILES, finding.basis)
  }

  // --- RemoteEntry classification ---

  @Test
  fun regularFilesAndDirectoriesClassifyDirectly() {
    assertEquals(RemoteEntryType.REGULAR_FILE, FtpListing.classify(ftpFile("a.jpg", FTPFile.FILE_TYPE)))
    assertEquals(RemoteEntryType.DIRECTORY, FtpListing.classify(ftpFile("DCIM", FTPFile.DIRECTORY_TYPE)))
  }

  @Test
  fun symlinksAndUnknownTypesAreOtherAndNeverFollowed() {
    val link = ftpFile("latest", FTPFile.SYMBOLIC_LINK_TYPE).apply { link = "DCIM/a.jpg" }

    assertEquals(RemoteEntryType.OTHER, FtpListing.classify(link))
    assertEquals(RemoteEntryType.OTHER, FtpListing.classify(ftpFile("fifo", FTPFile.UNKNOWN_TYPE)))
  }

  @Test
  fun entryCarriesNameSizeAndUtcMillis() {
    val file =
      ftpFile("a.jpg", FTPFile.FILE_TYPE).apply {
        size = 4_096
        timestamp = calendar(hour = 15, minute = 30)
      }

    val entry = FtpListing.toEntry(file)!!

    assertEquals("a.jpg", entry.name)
    assertEquals(4_096L, entry.sizeBytes)
    assertEquals(Instant.parse("2026-09-21T15:30:00Z").toEpochMilli(), entry.modifiedUtcMillis)
    assertEquals(RemoteEntryType.REGULAR_FILE, entry.type)
  }

  @Test
  fun dotEntriesAndMlsdDirMarkersAreNotChildren() {
    assertNull(FtpListing.toEntry(ftpFile(".", FTPFile.DIRECTORY_TYPE)))
    assertNull(FtpListing.toEntry(ftpFile("..", FTPFile.DIRECTORY_TYPE)))
    assertNull(FtpListing.toEntry(ftpFile("", FTPFile.FILE_TYPE)))
    assertNull(
      FtpListing.toEntry(
        ftpFile("photos", FTPFile.DIRECTORY_TYPE).apply { rawListing = "type=cdir;modify=20260921153000; photos" },
      ),
    )
    assertEquals(
      RemoteEntryType.DIRECTORY,
      FtpListing.toEntry(
        ftpFile("photos", FTPFile.DIRECTORY_TYPE).apply { rawListing = "type=dir;modify=20260921153000; photos" },
      )!!.type,
    )
  }

  @Test
  fun entryWithoutTimestampKeepsNullRatherThanInventingOne() {
    assertNull(FtpListing.toEntry(ftpFile("a.jpg", FTPFile.FILE_TYPE))!!.modifiedUtcMillis)
  }

  // --- failure mapping ---

  @Test
  fun eachTransportFailureGetsADistinctStableCode() {
    assertEquals(
      CloudSyncErrorCode.CONNECTION_TIMEOUT,
      FtpRemoteClient.mapFailure(SocketTimeoutException("connect timed out")).code,
    )
    assertEquals(
      CloudSyncErrorCode.CONNECTION_REFUSED,
      FtpRemoteClient.mapFailure(ConnectException("Connection refused")).code,
    )
    assertEquals(
      CloudSyncErrorCode.CONNECTION_REFUSED,
      FtpRemoteClient.mapFailure(UnknownHostException("ftp.example.org")).code,
    )
    assertEquals(
      CloudSyncErrorCode.CONNECTION_REFUSED,
      FtpRemoteClient.mapFailure(NoRouteToHostException("10.0.2.2")).code,
    )
    assertEquals(
      CloudSyncErrorCode.CONNECTION_LOST,
      FtpRemoteClient.mapFailure(FTPConnectionClosedException("421 closing")).code,
    )
    assertEquals(CloudSyncErrorCode.CONNECTION_LOST, FtpRemoteClient.mapFailure(IOException("reset")).code)

    val codes =
      listOf(
        CloudSyncErrorCode.AUTH_FAILED,
        CloudSyncErrorCode.CONNECTION_REFUSED,
        CloudSyncErrorCode.CONNECTION_TIMEOUT,
        CloudSyncErrorCode.DIRECTORY_UNREADABLE,
      ).map { FtpRemoteClient.failure(it).message }
    assertEquals("each failure needs its own message", codes.size, codes.toSet().size)
  }

  @Test
  fun failureMessagesNeverCarryTheCauseText() {
    val cause = ConnectException("Connection refused: dave@10.0.2.2:32120 /srv/ftp")
    val e = FtpRemoteClient.mapFailure(cause, replyCode = 421)

    assertSame(cause, e.cause)
    assertEquals(421, e.replyCode)
    assertFalse(e.message!!.contains("10.0.2.2"))
    assertFalse(e.message!!.contains("dave"))
  }

  @Test
  fun remoteFailureCrossesTheBridgeWithItsCodeAndConfiguredValuesScrubbed() {
    val envelope = CloudSyncEnvelope({ JavaOnlyMap() }, { JavaOnlyArray() })
    val config = RemoteConfig(RemoteProtocol.FTP, "nas", 32120, "dave", "/Photos")
    val e =
      RemoteClientException(
        CloudSyncErrorCode.DIRECTORY_UNREADABLE,
        "dave may not list /Photos on nas",
        "Ask the nas admin.",
      )

    val body = envelope.remoteFailure(e, sensitive = config.sensitiveValues).getMap("error")!!

    assertEquals("DIRECTORY_UNREADABLE", body.getString("code"))
    val text = body.getString("message") + " " + body.getString("action")
    for (secret in listOf("dave", "nas", "/Photos")) {
      assertFalse(text, text.contains(secret))
    }
    assertTrue(envelope.remoteFailure(e, page = true).isNull("page"))
  }

  @Test
  fun configToStringHidesHostAndUser() {
    val text = RemoteConfig(RemoteProtocol.FTP, "10.0.2.2", 32120, "dave").toString()

    assertFalse(text, text.contains("10.0.2.2"))
    assertFalse(text, text.contains("dave"))
  }

  @Test
  fun joinPathAvoidsDoubleSlashes() {
    assertEquals("/a.jpg", FtpRemoteClient.joinPath("/", "a.jpg"))
    assertEquals("/Photos/a.jpg", FtpRemoteClient.joinPath("/Photos", "a.jpg"))
  }

  /** A Calendar shaped like Commons Net's LIST parser leaves it: fields below the precision are unset. */
  private fun calendar(hour: Int? = null, minute: Int? = null, second: Int? = null): Calendar =
    Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply {
      clear()
      set(Calendar.YEAR, 2026)
      set(Calendar.MONTH, Calendar.SEPTEMBER)
      set(Calendar.DAY_OF_MONTH, 21)
      hour?.let { set(Calendar.HOUR_OF_DAY, it) }
      minute?.let { set(Calendar.MINUTE, it) }
      second?.let { set(Calendar.SECOND, it) }
    }

  private fun ftpFile(name: String, type: Int): FTPFile =
    FTPFile().apply {
      this.name = name
      this.type = type
    }
}
