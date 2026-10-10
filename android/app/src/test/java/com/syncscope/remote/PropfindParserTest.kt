package com.syncscope.remote

import com.syncscope.bridge.CloudSyncErrorCode
import java.io.BufferedReader
import java.io.IOException
import java.io.InputStreamReader
import java.net.ConnectException
import java.net.InetAddress
import java.net.ServerSocket
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.Collections
import kotlin.concurrent.thread
import kotlinx.coroutines.runBlocking
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** PROPFIND parsing and the WebDAV client's request/failure rules, on the platform XmlPullParser. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class PropfindParserTest {

  private var server: FakeDavServer? = null

  @After
  fun tearDown() {
    server?.close()
  }

  @Test
  fun parsesDirectoryFileMalformedDateAndSkipsSelf() {
    val entries = PropfindParser.children("/webdav/photos/", parse(MULTISTATUS))

    assertEquals(
      listOf(
        RemoteEntry("2024", -1L, 1_704_067_200_000L, RemoteEntryType.DIRECTORY),
        RemoteEntry("IMG 0001.jpg", 4096L, 1_704_067_201_000L, RemoteEntryType.REGULAR_FILE),
        RemoteEntry("broken-date.bin", 12L, null, RemoteEntryType.REGULAR_FILE),
      ),
      entries,
    )
  }

  @Test
  fun selfEntryIsSkippedWhateverTheHrefForm() {
    val xml =
      multistatus(
        response("http://10.0.2.2:32180/webdav/a%20b/", collection = true),
        response("/webdav/a%20b/c.txt", length = "1"),
      )

    val entries = PropfindParser.children("/webdav/a b", parse(xml))

    assertEquals(listOf("c.txt"), entries.map { it.name })
  }

  @Test
  fun missingPropsInA404PropstatAreIgnoredAndBareStatusResponsesDropped() {
    val xml =
      multistatus(
        """
        <D:response>
          <D:href>/webdav/gone.txt</D:href>
          <D:status>HTTP/1.1 404 Not Found</D:status>
        </D:response>
        <D:response>
          <D:href>/webdav/no-date.txt</D:href>
          <D:propstat><D:prop><D:getcontentlength>7</D:getcontentlength><D:resourcetype/></D:prop>
            <D:status>HTTP/1.1 200 OK</D:status></D:propstat>
          <D:propstat><D:prop><D:getlastmodified>Mon, 01 Jan 2024 00:00:00 GMT</D:getlastmodified>
            <D:resourcetype><D:collection/></D:resourcetype></D:prop>
            <D:status>HTTP/1.1 404 Not Found</D:status></D:propstat>
        </D:response>
        """,
      )

    assertEquals(
      listOf(RemoteEntry("no-date.txt", 7L, null, RemoteEntryType.REGULAR_FILE)),
      PropfindParser.children("/webdav/", parse(xml)),
    )
  }

  @Test
  fun lastModifiedIsRfc1123InGmtAndNeverThrows() {
    assertEquals(1_704_067_200_000L, PropfindParser.parseLastModified("Mon, 01 Jan 2024 00:00:00 GMT"))
    assertEquals(1_704_067_200_000L, PropfindParser.parseLastModified("  Mon, 1 Jan 2024 00:00:00 GMT\n"))
    assertNull(PropfindParser.parseLastModified(null))
    assertNull(PropfindParser.parseLastModified(""))
    assertNull(PropfindParser.parseLastModified("2024-01-01T00:00:00Z"))
    assertNull(PropfindParser.parseLastModified("Tue, 01 Jan 2024 00:00:00 GMT")) // wrong weekday
    assertNull(PropfindParser.parseLastModified("Mon, 32 Jan 2024 00:00:00 GMT"))
  }

  @Test
  fun malformedXmlAndCustomEntitiesFailTheParse() {
    // A body cut off mid-listing must fail rather than read as a shorter directory.
    val truncated = MULTISTATUS.substringBefore("<D:href>/webdav/photos/broken-date.bin")
    assertThrows(Exception::class.java) { parse(truncated) }
    assertThrows(Exception::class.java) { parse("<D:multistatus xmlns:D=\"DAV:\"><D:response>") }
    assertThrows(Exception::class.java) { parse(MULTISTATUS.substringBeforeLast("</D:multistatus>")) }
    assertThrows(Exception::class.java) { parse("<html><body>It works!</body></html>") }
    val entityBomb =
      "<?xml version=\"1.0\"?><!DOCTYPE m [<!ENTITY a \"aaaaaaaa\">]>" +
        "<D:multistatus xmlns:D=\"DAV:\"><D:response><D:href>&a;</D:href></D:response></D:multistatus>"
    val outcome = runCatching { parse(entityBomb) }
    // Either the entity is refused outright or it never yields a listing entry.
    assertTrue(outcome.isFailure || outcome.getOrThrow().isEmpty())
  }

  @Test
  fun precisionIsStructuralWholeSeconds() {
    assertEquals(1_000L, WebDavRemoteClient.PRECISION.precisionMillis)
    assertEquals(PrecisionBasis.RFC1123_WHOLE_SECONDS, WebDavRemoteClient.PRECISION.basis)
  }

  @Test
  fun collectionUrlsEncodeSegmentsAndKeepATrailingSlash() {
    val base = "http://10.0.2.2:32180/".toHttpUrl()

    assertEquals("/", WebDavRemoteClient.collectionUrl(base, "/").encodedPath)
    assertEquals("/webdav/", WebDavRemoteClient.collectionUrl(base, "webdav").encodedPath)
    assertEquals("/webdav/a%20b%23c/", WebDavRemoteClient.collectionUrl(base, "/webdav/a b#c/").encodedPath)
    val endpoint = "https://cloud.example.test/remote.php/dav/alice/".toHttpUrl()
    assertEquals("/remote.php/dav/alice/", WebDavRemoteClient.collectionUrl(endpoint, "/").encodedPath)
    assertEquals("/remote.php/dav/alice/Photos%20Backup/", WebDavRemoteClient.collectionUrl(endpoint, "/Photos Backup/").encodedPath)
    assertEquals("/remote.php/dav/alice/Photos%20Backup/2024/", WebDavRemoteClient.collectionUrl(endpoint, "/Photos Backup/2024").encodedPath)
  }

  @Test
  fun sharedEndpointSupportsHttpsIpv6AndEncodedSegments() {
    val endpoint = webdavBaseUrl(
      config(8443).copy(host = "[2001:db8::7]/dav/Photos%20Backup", webdavHttps = true),
    )
    assertEquals("https", endpoint.scheme)
    assertEquals("2001:db8::7", endpoint.host)
    assertEquals(8443, endpoint.port)
    assertEquals("/dav/Photos%20Backup/", WebDavRemoteClient.collectionUrl(endpoint, "/").encodedPath)
  }

  @Test
  fun sharedWebdavEndpointIsUsedForEveryFolderAndNestedListing() = runBlocking {
    val base = "/remote.php/dav/Photos%20Backup"
    val fake = FakeDavServer(listOf(
      optionsOk(),
      multistatusReply(multistatus(response("$base/a/", collection = true))),
      multistatusReply(multistatus(response("$base/b/", collection = true), response("$base/b/child/", collection = true))),
      multistatusReply(multistatus(response("$base/b/child/", collection = true))),
    )).also { server = it }
    val client = WebDavRemoteClient()
    client.connect(config(fake.port, listOf("/a", "/b")).copy(host = "127.0.0.1$base"), "pw".toCharArray())
    assertEquals(listOf("child"), client.list("/b").map { it.name })
    assertTrue(client.list("/b/child").isEmpty())
    assertEquals(listOf("$base/a/", "$base/a/", "$base/b/", "$base/b/child/"), fake.requests.map { it.path })
    client.close()
  }

  @Test
  fun statusCodesMapToDistinctRedactedCodes() {
    val cases =
      listOf(
        Triple(401, WebDavScope.CONNECT, CloudSyncErrorCode.AUTH_FAILED),
        Triple(401, WebDavScope.SUBDIRECTORY, CloudSyncErrorCode.AUTH_FAILED),
        Triple(404, WebDavScope.CONNECT, CloudSyncErrorCode.REMOTE_ROOT_NOT_FOUND),
        Triple(404, WebDavScope.ROOT, CloudSyncErrorCode.REMOTE_ROOT_NOT_FOUND),
        Triple(404, WebDavScope.SUBDIRECTORY, CloudSyncErrorCode.DIRECTORY_UNREADABLE),
        Triple(403, WebDavScope.ROOT, CloudSyncErrorCode.DIRECTORY_UNREADABLE),
        Triple(500, WebDavScope.ROOT, CloudSyncErrorCode.SERVER_ERROR),
        Triple(503, WebDavScope.CONNECT, CloudSyncErrorCode.SERVER_ERROR),
        Triple(301, WebDavScope.CONNECT, CloudSyncErrorCode.CONNECTION_REFUSED),
      )
    for ((status, scope, code) in cases) {
      val failure = WebDavFailures.forStatus(status, scope)
      assertEquals("$status/$scope", code, failure.code)
      assertEquals(status, failure.replyCode)
    }
  }

  @Test
  fun transportFailuresMapWithoutLeakingDetail() {
    val secret = "dave:hunter2@10.0.2.2:32180/webdav"
    val cases =
      listOf(
        SocketTimeoutException("timeout $secret") to CloudSyncErrorCode.CONNECTION_TIMEOUT,
        java.io.InterruptedIOException("timeout") to CloudSyncErrorCode.CONNECTION_TIMEOUT,
        ConnectException("Failed to connect to $secret") to CloudSyncErrorCode.CONNECTION_REFUSED,
        UnknownHostException(secret) to CloudSyncErrorCode.CONNECTION_REFUSED,
        IOException("unexpected end of stream on $secret") to CloudSyncErrorCode.CONNECTION_LOST,
      )
    for ((cause, code) in cases) {
      val mapped = WebDavFailures.map(cause)
      assertEquals(cause.toString(), code, mapped.code)
      assertSame(cause, mapped.cause)
      for (fragment in listOf("dave", "hunter2", "10.0.2.2", "/webdav")) {
        assertFalse(mapped.message, mapped.message!!.contains(fragment))
      }
    }
  }

  @Test
  fun connectAndListIssueOnlyOptionsAndPropfindWithBasicAuth() = runBlocking {
    val fake =
      FakeDavServer(
        listOf(
          optionsOk(),
          multistatusReply(multistatus(response("/webdav/", collection = true))),
          multistatusReply(MULTISTATUS.replace("/webdav/photos/", "/webdav/")),
        ),
      ).also { server = it }
    val client = WebDavRemoteClient()

    client.connect(config(fake.port), "hunter2".toCharArray())
    val entries = client.list("/webdav")

    assertEquals(3, entries.size)
    assertEquals(listOf("OPTIONS", "PROPFIND", "PROPFIND"), fake.requests.map { it.method })
    assertEquals(listOf("/webdav/", "/webdav/", "/webdav/"), fake.requests.map { it.path })
    assertEquals(listOf(null, "0", "1"), fake.requests.map { it.headers["depth"] })
    assertTrue(fake.requests.all { it.headers["authorization"] == "Basic ZGF2ZTpodW50ZXIy" })
    assertTrue(fake.requests[1].body.contains("getlastmodified"))
    assertEquals(PrecisionBasis.RFC1123_WHOLE_SECONDS, client.discoverPrecision().basis)
  }

  @Test
  fun wrongPasswordIsAuthFailedAndRedirectsAreNeverFollowed() = runBlocking {
    val unauthorized = FakeDavServer(listOf("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n"))
    server = unauthorized
    val auth =
      assertThrows(RemoteClientException::class.java) {
        runBlocking { WebDavRemoteClient().connect(config(unauthorized.port), "wrong".toCharArray()) }
      }
    assertEquals(CloudSyncErrorCode.AUTH_FAILED, auth.code)
    assertFalse(auth.message!!.contains("dave"))
    unauthorized.close()

    val redirecting =
      FakeDavServer(listOf("HTTP/1.1 301 Moved\r\nLocation: /elsewhere/\r\nContent-Length: 0\r\n\r\n"))
    server = redirecting
    val redirect =
      assertThrows(RemoteClientException::class.java) {
        runBlocking { WebDavRemoteClient().connect(config(redirecting.port), "pw".toCharArray()) }
      }
    assertEquals(CloudSyncErrorCode.CONNECTION_REFUSED, redirect.code)
    assertEquals(listOf("OPTIONS"), redirecting.requests.map { it.method })
  }

  @Test
  fun missingRootNonDavServerAndGarbageListingHaveDistinctCodes() = runBlocking {
    val missing = FakeDavServer(listOf(optionsOk(), "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n"))
    server = missing
    assertEquals(CloudSyncErrorCode.REMOTE_ROOT_NOT_FOUND, connectFailure(missing.port).code)
    missing.close()

    val plainHttp = FakeDavServer(listOf("HTTP/1.1 200 OK\r\nAllow: OPTIONS\r\nContent-Length: 0\r\n\r\n"))
    server = plainHttp
    assertEquals(CloudSyncErrorCode.CONNECTION_REFUSED, connectFailure(plainHttp.port).code)
    plainHttp.close()

    val garbage = FakeDavServer(listOf(optionsOk(), multistatusReply("<D:multistatus xmlns:D=\"DAV:\"><oops")))
    server = garbage
    assertEquals(CloudSyncErrorCode.SERVER_ERROR, connectFailure(garbage.port).code)
  }

  @Test
  fun oneReadableFolderIsEnoughToConnectWithSeveralFolders() = runBlocking {
    val notFound = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n"
    val partly =
      FakeDavServer(listOf(optionsOk(), notFound, multistatusReply(multistatus(response("/other/", collection = true)))))
    server = partly
    val client = WebDavRemoteClient()

    assertEquals(ConnectOutcome.Connected, client.connect(config(partly.port, listOf("/webdav", "/other")), "pw".toCharArray()))
    assertEquals(listOf("OPTIONS", "PROPFIND", "PROPFIND"), partly.requests.map { it.method })
    assertEquals(listOf("/webdav/", "/webdav/", "/other/"), partly.requests.map { it.path })
    client.close()
    partly.close()

    val none = FakeDavServer(listOf(optionsOk(), notFound, "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n"))
    server = none
    val failure =
      assertThrows(RemoteClientException::class.java) {
        runBlocking { WebDavRemoteClient().connect(config(none.port, listOf("/webdav", "/other")), "pw".toCharArray()) }
      }
    assertEquals("the first folder's code", CloudSyncErrorCode.REMOTE_ROOT_NOT_FOUND, failure.code)
  }

  @Test
  fun unconnectedClientReportsConnectionLostAndRejectsOtherProtocols() = runBlocking {
    val client = WebDavRemoteClient()

    val lost = assertThrows(RemoteClientException::class.java) { runBlocking { client.list("/") } }
    assertEquals(CloudSyncErrorCode.CONNECTION_LOST, lost.code)
    assertThrows(IllegalArgumentException::class.java) {
      runBlocking { client.connect(config(1).copy(protocol = RemoteProtocol.FTP), "x".toCharArray()) }
    }
    client.close()
  }

  private fun connectFailure(port: Int): RemoteClientException =
    assertThrows(RemoteClientException::class.java) {
      runBlocking { WebDavRemoteClient().connect(config(port), "pw".toCharArray()) }
    }

  private fun parse(xml: String): List<PropfindResponse> = PropfindParser.parse(xml.byteInputStream())

  private fun config(port: Int, roots: List<String> = listOf("/webdav")) =
    RemoteConfig(RemoteProtocol.WEBDAV, "127.0.0.1", port, "dave", roots)

  private fun optionsOk() = "HTTP/1.1 200 OK\r\nDAV: 1,2\r\nContent-Length: 0\r\n\r\n"

  private fun multistatusReply(body: String): String {
    val bytes = body.toByteArray(Charsets.UTF_8)
    return "HTTP/1.1 207 Multi-Status\r\nContent-Type: application/xml; charset=utf-8\r\n" +
      "Content-Length: ${bytes.size}\r\n\r\n$body"
  }

  /** Minimal one-request-per-connection HTTP responder that records what it was sent. */
  private class FakeDavServer(replies: List<String>) : AutoCloseable {
    data class Recorded(val method: String, val path: String, val headers: Map<String, String>, val body: String)

    private val socket = ServerSocket(0, 8, InetAddress.getLoopbackAddress())
    val port: Int = socket.localPort
    val requests: MutableList<Recorded> = Collections.synchronizedList(ArrayList())

    init {
      thread(isDaemon = true) {
        for (reply in replies) {
          val connection = runCatching { socket.accept() }.getOrNull() ?: return@thread
          connection.use {
            val reader = BufferedReader(InputStreamReader(it.getInputStream(), Charsets.ISO_8859_1))
            val (method, path) = reader.readLine().split(' ').let { parts -> parts[0] to parts[1] }
            val headers = HashMap<String, String>()
            while (true) {
              val line = reader.readLine()
              if (line.isNullOrEmpty()) break
              headers[line.substringBefore(':').trim().lowercase()] = line.substringAfter(':').trim()
            }
            val length = headers["content-length"]?.toInt() ?: 0
            val body = CharArray(length).also { buffer -> var read = 0; while (read < length) read += reader.read(buffer, read, length - read) }
            requests.add(Recorded(method, path, headers, String(body)))
            it.getOutputStream().write(reply.replace("\r\n\r\n", "\r\nConnection: close\r\n\r\n").toByteArray(Charsets.UTF_8))
            it.getOutputStream().flush()
          }
        }
      }
    }

    override fun close() {
      socket.close()
    }
  }

  private companion object {
    fun multistatus(vararg responses: String) =
      "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<D:multistatus xmlns:D=\"DAV:\">" +
        responses.joinToString("") + "</D:multistatus>"

    fun response(href: String, collection: Boolean = false, length: String? = null) =
      "<D:response><D:href>$href</D:href><D:propstat><D:prop>" +
        (length?.let { "<D:getcontentlength>$it</D:getcontentlength>" } ?: "") +
        "<D:resourcetype>${if (collection) "<D:collection/>" else ""}</D:resourcetype>" +
        "</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>"

    /** Shape captured from Apache mod_dav: lp1 live-property prefix, displayname in a 404 propstat. */
    val MULTISTATUS =
      """
      <?xml version="1.0" encoding="utf-8"?>
      <D:multistatus xmlns:D="DAV:" xmlns:ns0="DAV:">
      <D:response xmlns:lp1="DAV:" xmlns:lp2="http://apache.org/dav/props/">
      <D:href>/webdav/photos/</D:href>
      <D:propstat><D:prop>
      <lp1:resourcetype><D:collection/></lp1:resourcetype>
      <lp1:getlastmodified>Mon, 01 Jan 2024 00:00:00 GMT</lp1:getlastmodified>
      </D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
      <D:propstat><D:prop><ns0:displayname/><ns0:getcontentlength/></D:prop>
      <D:status>HTTP/1.1 404 Not Found</D:status></D:propstat>
      </D:response>
      <D:response xmlns:lp1="DAV:">
      <D:href>/webdav/photos/2024/</D:href>
      <D:propstat><D:prop>
      <lp1:resourcetype><D:collection/></lp1:resourcetype>
      <lp1:getlastmodified>Mon, 01 Jan 2024 00:00:00 GMT</lp1:getlastmodified>
      </D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
      </D:response>
      <D:response xmlns:lp1="DAV:">
      <D:href>/webdav/photos/IMG%200001.jpg</D:href>
      <D:propstat><D:prop>
      <lp1:resourcetype/>
      <lp1:getcontentlength>4096</lp1:getcontentlength>
      <lp1:getlastmodified>Mon, 01 Jan 2024 00:00:01 GMT</lp1:getlastmodified>
      </D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
      </D:response>
      <D:response xmlns:lp1="DAV:">
      <D:href>/webdav/photos/broken-date.bin</D:href>
      <D:propstat><D:prop>
      <lp1:resourcetype/>
      <lp1:getcontentlength>12</lp1:getcontentlength>
      <lp1:getlastmodified>yesterday-ish</lp1:getlastmodified>
      </D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
      </D:response>
      </D:multistatus>
      """.trimIndent()
  }
}
