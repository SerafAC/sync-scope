package com.syncscope.remote

import com.syncscope.bridge.CloudSyncErrorCode
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import kotlinx.coroutines.runBlocking
import net.schmizz.sshj.common.DisconnectReason
import net.schmizz.sshj.sftp.FileAttributes
import net.schmizz.sshj.sftp.FileMode
import net.schmizz.sshj.sftp.PathComponents
import net.schmizz.sshj.sftp.RemoteResourceInfo
import net.schmizz.sshj.sftp.Response
import net.schmizz.sshj.sftp.SFTPException
import net.schmizz.sshj.transport.TransportException
import net.schmizz.sshj.userauth.UserAuthException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Test

/** Pure mapping rules of the SFTP client; the live container run is proven in androidTest. */
class SftpRemoteClientTest {

  @Test
  fun symlinksFifosAndModelessEntriesAreOtherAndNeverFollowed() {
    assertEquals(RemoteEntryType.REGULAR_FILE, typeOf(FileMode.Type.REGULAR))
    assertEquals(RemoteEntryType.DIRECTORY, typeOf(FileMode.Type.DIRECTORY))
    assertEquals(RemoteEntryType.OTHER, typeOf(FileMode.Type.SYMLINK))
    assertEquals(RemoteEntryType.OTHER, typeOf(FileMode.Type.FIFO_SPECIAL))
    assertEquals(RemoteEntryType.OTHER, typeOf(FileMode.Type.BLOCK_SPECIAL))
    assertEquals(RemoteEntryType.OTHER, SftpListing.classify(FileAttributes.Builder().withSize(3).build()))
  }

  @Test
  fun entryCarriesSizeAndWholeSecondMtime() {
    val attributes =
      FileAttributes.Builder()
        .withType(FileMode.Type.REGULAR)
        .withSize(4096)
        .withAtimeMtime(1_704_067_100L, 1_704_067_200L)
        .build()

    val entry = SftpListing.toEntry(info("bucket-start.bin", attributes))!!

    assertEquals(RemoteEntry("bucket-start.bin", 4096, 1_704_067_200_000L, RemoteEntryType.REGULAR_FILE), entry)
  }

  @Test
  fun missingAttributesAreUnknownNotZero() {
    val entry = SftpListing.toEntry(info("x", FileAttributes.Builder().withType(FileMode.Type.REGULAR).build()))!!

    assertEquals(-1L, entry.sizeBytes)
    assertNull(entry.modifiedUtcMillis)
  }

  @Test
  fun dotEntriesAreNotChildren() {
    val dir = FileAttributes.Builder().withType(FileMode.Type.DIRECTORY).build()
    assertNull(SftpListing.toEntry(info(".", dir)))
    assertNull(SftpListing.toEntry(info("..", dir)))
  }

  @Test
  fun precisionIsWholeSecondsRecordedAsProtocolBasis() {
    val finding = SftpPrecision.forProtocolVersion(3)

    assertEquals(1_000L, finding.precisionMillis)
    assertEquals(PrecisionBasis.SFTP_V3_WHOLE_SECONDS, finding.basis)
  }

  @Test
  fun failuresMapToStableCodesWithoutLeakingDetail() {
    val secret = "dave@10.0.2.2:/srv/private"
    val cases =
      listOf(
        UserAuthException("Exhausted available authentication methods for $secret") to CloudSyncErrorCode.AUTH_FAILED,
        ConnectException("Connection refused: $secret") to CloudSyncErrorCode.CONNECTION_REFUSED,
        UnknownHostException(secret) to CloudSyncErrorCode.CONNECTION_REFUSED,
        SocketTimeoutException("connect timed out") to CloudSyncErrorCode.CONNECTION_TIMEOUT,
        TransportException(DisconnectReason.UNKNOWN, "kex", java.util.concurrent.TimeoutException()) to
          CloudSyncErrorCode.CONNECTION_TIMEOUT,
        TransportException(DisconnectReason.CONNECTION_LOST, secret) to CloudSyncErrorCode.CONNECTION_LOST,
        IOException("Broken pipe $secret") to CloudSyncErrorCode.CONNECTION_LOST,
        SFTPException(Response.StatusCode.PERMISSION_DENIED, secret) to CloudSyncErrorCode.DIRECTORY_UNREADABLE,
        SFTPException(Response.StatusCode.NO_SUCH_FILE, secret) to CloudSyncErrorCode.DIRECTORY_UNREADABLE,
        SFTPException(Response.StatusCode.FAILURE, secret) to CloudSyncErrorCode.CONNECTION_LOST,
      )

    for ((cause, code) in cases) {
      val mapped = SftpFailures.map(cause)
      assertEquals(cause.toString(), code, mapped.code)
      assertSame(cause, mapped.cause)
      assertFalse(mapped.message, mapped.message!!.contains("dave"))
      assertFalse(mapped.message, mapped.message!!.contains("10.0.2.2"))
      assertFalse(mapped.message, mapped.message!!.contains("/srv"))
    }
    assertEquals(Response.StatusCode.PERMISSION_DENIED.code, SftpFailures.map(cases[7].first).replyCode)
  }

  @Test
  fun hostKeyRefusalPassesThroughUnchanged() {
    val challenge =
      HostKeyChallenge("c1", "h.test", 22, "ssh-ed25519", "AAAA", "SHA256:x", "SHA256:y", 0L)
    val refusal = SftpHostKeyException(CloudSyncErrorCode.SFTP_HOST_KEY_CHANGED, challenge)

    assertSame(refusal, SftpFailures.map(refusal))
    assertThrows(IllegalArgumentException::class.java) {
      SftpHostKeyException(CloudSyncErrorCode.AUTH_FAILED, challenge)
    }
  }

  @Test
  fun unconnectedClientReportsConnectionLostAndRejectsOtherProtocols() = runBlocking {
    val client = SftpRemoteClient(hostKeys = unusedStore())

    val lost = assertThrows(RemoteClientException::class.java) { runBlocking { client.list("/") } }
    assertEquals(CloudSyncErrorCode.CONNECTION_LOST, lost.code)
    assertThrows(IllegalArgumentException::class.java) {
      runBlocking { client.connect(RemoteConfig(RemoteProtocol.FTP, "h", 21, "u"), CharArray(0)) }
    }
    client.close()
    client.close()
  }

  /** The store is never consulted before the protocol check or on an unconnected session. */
  private fun unusedStore(): HostKeyTrustStore = HostKeyTrustStore(UnusedDao)

  private object UnusedDao : com.syncscope.persistence.TrustedSftpHostKeyDao() {
    override suspend fun insert(key: com.syncscope.persistence.TrustedSftpHostKeyEntity) = error("unused")
    override suspend fun update(key: com.syncscope.persistence.TrustedSftpHostKeyEntity) = error("unused")
    override suspend fun byId(id: Long) = error("unused")
    override suspend fun forEndpoint(host: String, port: Int, algorithm: String) = error("unused")
    override suspend fun forHost(host: String, port: Int) = error("unused")
    override suspend fun deleteOtherAlgorithms(host: String, port: Int, algorithm: String) = error("unused")
  }

  private fun typeOf(type: FileMode.Type): RemoteEntryType =
    SftpListing.classify(FileAttributes.Builder().withType(type).build())

  private fun info(name: String, attributes: FileAttributes) =
    RemoteResourceInfo(PathComponents("/data", name, "/data/$name"), attributes)
}
