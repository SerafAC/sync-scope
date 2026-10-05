package com.syncscope.remote

import com.syncscope.bridge.CloudSyncErrorCode
import java.io.IOException
import java.net.SocketTimeoutException
import java.security.cert.CertPathValidatorException
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLPeerUnverifiedException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Test

/** The WebDAV scheme choice and the TLS failure mapping (research R4), with no network. */
class WebDavRemoteClientTest {

  @Test
  fun schemeIsHttpsOnlyWhenTheConfigAsksForIt() {
    assertEquals("https", webdavScheme(config(webdavHttps = true)))
    assertEquals("http", webdavScheme(config(webdavHttps = false)))
    assertEquals("http", webdavScheme(RemoteConfig(RemoteProtocol.WEBDAV, HOST, 80, "u")))
  }

  @Test
  fun webdavHttpsStaysOutOfToString() {
    assertFalse(config(webdavHttps = true).toString().contains("webdavHttps"))
  }

  @Test
  fun untrustedCertificateMapsToTlsUntrusted() {
    val handshake = SSLHandshakeException("PKIX path building failed for $HOST")
    handshake.initCause(CertPathValidatorException("Trust anchor for certification path not found."))

    val failure = WebDavFailures.map(handshake)

    assertEquals(CloudSyncErrorCode.TLS_UNTRUSTED, failure.code)
    assertEquals(CloudSyncErrorCode.TLS_UNTRUSTED.defaultMessage, failure.message)
    assertEquals(CloudSyncErrorCode.TLS_UNTRUSTED.defaultAction, failure.action)
    assertSame("the host-bearing text stays in the cause", handshake, failure.cause)
  }

  @Test
  fun hostnameMismatchMapsToTlsUntrusted() {
    val failure = WebDavFailures.map(SSLPeerUnverifiedException("Hostname $HOST not verified"))

    assertEquals(CloudSyncErrorCode.TLS_UNTRUSTED, failure.code)
    assertFalse(failure.message!!.contains(HOST))
  }

  @Test
  fun aWrappedSslFailureIsStillTlsUntrusted() {
    val wrapped = IOException("call failed", SSLHandshakeException("bad certificate"))

    assertEquals(CloudSyncErrorCode.TLS_UNTRUSTED, WebDavFailures.map(wrapped).code)
  }

  @Test
  fun otherTransportFailuresKeepTheirCodes() {
    assertEquals(CloudSyncErrorCode.CONNECTION_TIMEOUT, WebDavFailures.map(SocketTimeoutException()).code)
    assertEquals(CloudSyncErrorCode.CONNECTION_LOST, WebDavFailures.map(IOException("reset")).code)
  }

  private fun config(webdavHttps: Boolean) =
    RemoteConfig(RemoteProtocol.WEBDAV, HOST, 443, "user", "/photos", webdavHttps)

  private companion object {
    const val HOST = "nas.example.test"
  }
}
