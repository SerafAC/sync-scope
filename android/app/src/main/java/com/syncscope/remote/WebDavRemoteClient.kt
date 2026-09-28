package com.syncscope.remote

import com.syncscope.bridge.CloudSyncErrorCode
import java.io.IOException
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Credentials
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.xmlpull.v1.XmlPullParserException

/**
 * Read-only WebDAV [RemoteClient] on OkHttp with hand-rolled requests (MEM005).
 *
 * The only methods this class can issue are OPTIONS and PROPFIND (HEAD is also permitted
 * by protocol-audit.sh but is not needed). Redirects are never followed: OkHttp rewrites a
 * redirected OPTIONS into a content fetch, which the audit forbids even for reads (R026).
 * Authentication is HTTP Basic; the header value lives only for the session and never
 * reaches a message, a log line, or the bridge.
 */
class WebDavRemoteClient(
  private val httpClient: OkHttpClient = defaultHttpClient(),
  /** The fixture is cleartext on loopback; release builds block cleartext in the manifest. */
  private val scheme: String = "http",
) : RemoteClient {

  private class Session(val base: HttpUrl, val authorization: String, val rootPath: String)

  @Volatile private var session: Session? = null

  override suspend fun connect(config: RemoteConfig, password: CharArray): ConnectOutcome {
    require(config.protocol == RemoteProtocol.WEBDAV) { "WebDavRemoteClient cannot serve ${config.protocol}" }
    close()
    val base =
      try {
        HttpUrl.Builder().scheme(scheme).host(config.host).port(config.port).build()
      } catch (e: IllegalArgumentException) {
        // OkHttp's message quotes the host verbatim, so only the cause keeps it.
        throw WebDavFailures.failure(CloudSyncErrorCode.CONNECTION_REFUSED, cause = e)
      }
    val candidate = Session(base, Credentials.basic(config.username, String(password)), config.rootPath)
    val rootUrl = collectionUrl(base, config.rootPath)

    // OPTIONS proves reachability, credentials, and DAV class 1 support in one round trip.
    exchange(candidate, request(candidate, rootUrl).method("OPTIONS", null).build(), WebDavScope.CONNECT) {
      // Apache answers with two DAV headers ("1,2" and its propset URI). OkHttp's header()
      // keeps only the last value, which names no class at all, so every value must be read.
      val classes = it.headers("DAV").flatMap { value -> value.split(',') }
      if (classes.none { level -> level.trim() == "1" }) {
        throw WebDavFailures.notWebDav()
      }
    }
    // Depth 0 PROPFIND proves the configured root exists and is a collection.
    val root =
      exchange(candidate, propfind(candidate, rootUrl, depth = "0"), WebDavScope.ROOT) { response ->
        PropfindParser.parse(response.body!!.byteStream())
      }
    if (root.none { it.isCollection }) {
      throw WebDavFailures.failure(CloudSyncErrorCode.DIRECTORY_UNREADABLE)
    }
    session = candidate
    return ConnectOutcome.Connected
  }

  override suspend fun list(directory: String): List<RemoteEntry> {
    val current = session()
    val url = collectionUrl(current.base, directory)
    val scope =
      if (samePath(directory, current.rootPath)) WebDavScope.ROOT else WebDavScope.SUBDIRECTORY
    return exchange(current, propfind(current, url, depth = "1"), scope) { response ->
      PropfindParser.children(url.encodedPath, PropfindParser.parse(response.body!!.byteStream()))
    }
  }

  /**
   * Structural, not measured: RFC 4918 §15.7 fixes `DAV:getlastmodified` as an rfc1123-date,
   * which has no sub-second field, and Apache mod_dav offers nothing finer. The
   * Win32LastModifiedTime dead property is deliberately not consulted.
   */
  override suspend fun discoverPrecision(): PrecisionFinding {
    session()
    return PRECISION
  }

  override fun close() {
    session = null
  }

  private fun session(): Session =
    session
      ?: throw RemoteClientException(
        CloudSyncErrorCode.CONNECTION_LOST,
        "The WebDAV session is not connected.",
        "Reconnect the repository.",
      )

  private fun request(session: Session, url: HttpUrl): Request.Builder =
    Request.Builder().url(url).header("Authorization", session.authorization)

  private fun propfind(session: Session, url: HttpUrl, depth: String): Request =
    request(session, url)
      .header("Depth", depth)
      .method("PROPFIND", PropfindParser.REQUEST_BODY.toRequestBody(XML))
      .build()

  /**
   * Runs [request] and hands a 2xx response to [onSuccess] on OkHttp's callback thread.
   * Cancelling the coroutine cancels the call, which aborts an in-flight body read.
   */
  private suspend fun <T> exchange(
    session: Session,
    request: Request,
    scope: WebDavScope,
    onSuccess: (Response) -> T,
  ): T =
    suspendCancellableCoroutine { continuation ->
      val call = httpClient.newCall(request)
      continuation.invokeOnCancellation { call.cancel() }
      call.enqueue(
        object : Callback {
          override fun onFailure(call: Call, e: IOException) {
            continuation.resumeWithException(WebDavFailures.map(e))
          }

          override fun onResponse(call: Call, response: Response) {
            val outcome =
              try {
                response.use {
                  if (!it.isSuccessful) throw WebDavFailures.forStatus(it.code, scope)
                  Result.success(onSuccess(it))
                }
              } catch (e: RemoteClientException) {
                Result.failure(e)
              } catch (e: XmlPullParserException) {
                Result.failure(WebDavFailures.malformed(e))
              } catch (e: IOException) {
                Result.failure(WebDavFailures.map(e))
              } catch (e: RuntimeException) {
                Result.failure(WebDavFailures.malformed(e))
              }
            // After cancellation both resumes are ignored; the response is already closed.
            outcome.fold({ continuation.resume(it) }, { continuation.resumeWithException(it) })
          }
        },
      )
    }

  companion object {
    const val CONNECT_TIMEOUT_MS = 15_000L
    const val SOCKET_TIMEOUT_MS = 30_000L

    val PRECISION = PrecisionFinding(1_000L, PrecisionBasis.RFC1123_WHOLE_SECONDS)

    private val XML = "application/xml; charset=utf-8".toMediaType()

    fun defaultHttpClient(): OkHttpClient =
      OkHttpClient.Builder()
        .connectTimeout(CONNECT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        .readTimeout(SOCKET_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        .writeTimeout(SOCKET_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .build()

    /** A collection URL with a trailing slash, so mod_dav never answers with a redirect. */
    internal fun collectionUrl(base: HttpUrl, path: String): HttpUrl {
      val builder = base.newBuilder().encodedPath("/")
      val segments = path.split('/').filter { it.isNotEmpty() && it != "." }
      segments.forEach(builder::addPathSegment)
      if (segments.isNotEmpty()) builder.addPathSegment("")
      return builder.build()
    }

    private fun samePath(a: String, b: String): Boolean = a.trim('/') == b.trim('/')
  }
}

/** Which request a status belongs to, so a 404 can tell a missing root from a vanished folder. */
internal enum class WebDavScope { CONNECT, ROOT, SUBDIRECTORY }

internal object WebDavFailures {
  fun forStatus(status: Int, scope: WebDavScope): RemoteClientException {
    val code =
      when {
        status == 401 -> CloudSyncErrorCode.AUTH_FAILED
        status == 404 && scope != WebDavScope.SUBDIRECTORY -> CloudSyncErrorCode.REMOTE_ROOT_NOT_FOUND
        status in 500..599 -> CloudSyncErrorCode.SERVER_ERROR
        scope == WebDavScope.CONNECT && status !in 400..499 -> CloudSyncErrorCode.CONNECTION_REFUSED
        else -> CloudSyncErrorCode.DIRECTORY_UNREADABLE
      }
    return failure(code, status)
  }

  /** Transport failures; the exception text (which can name the host) stays in the cause. */
  fun map(e: IOException): RemoteClientException {
    val chain = generateSequence<Throwable>(e) { it.cause.takeIf { cause -> cause !== it } }.take(8).toList()
    val code =
      when {
        chain.any { it is SocketTimeoutException } -> CloudSyncErrorCode.CONNECTION_TIMEOUT
        chain.any { it is ConnectException || it is NoRouteToHostException || it is UnknownHostException } ->
          CloudSyncErrorCode.CONNECTION_REFUSED
        // OkHttp reports its own call/read deadlines as a bare InterruptedIOException("timeout").
        e is InterruptedIOException && e.message == "timeout" -> CloudSyncErrorCode.CONNECTION_TIMEOUT
        else -> CloudSyncErrorCode.CONNECTION_LOST
      }
    return failure(code, null, e)
  }

  fun notWebDav(): RemoteClientException =
    RemoteClientException(
      CloudSyncErrorCode.CONNECTION_REFUSED,
      "The server answered but does not offer WebDAV at the configured folder.",
      "Check the port and folder, and that WebDAV is enabled.",
    )

  fun malformed(cause: Throwable): RemoteClientException =
    RemoteClientException(
      CloudSyncErrorCode.SERVER_ERROR,
      "The WebDAV server sent a listing that could not be read.",
      "Try again; if it persists, check the server's WebDAV module.",
      null,
      cause,
    )

  fun failure(code: CloudSyncErrorCode, status: Int? = null, cause: Throwable? = null): RemoteClientException {
    val (message, action) =
      when (code) {
        CloudSyncErrorCode.AUTH_FAILED ->
          "The WebDAV server rejected the username or password." to "Check the credentials and try again."
        CloudSyncErrorCode.CONNECTION_REFUSED ->
          "The WebDAV server could not be reached or refused the connection." to
            "Check the host and port, and that the server is running."
        CloudSyncErrorCode.CONNECTION_TIMEOUT ->
          "The WebDAV server did not respond in time." to "Check the network and try again."
        CloudSyncErrorCode.REMOTE_ROOT_NOT_FOUND ->
          "The configured WebDAV folder does not exist." to "Check the folder path in the repository settings."
        CloudSyncErrorCode.SERVER_ERROR ->
          "The WebDAV server reported an internal error." to "Try again later or check the server logs."
        CloudSyncErrorCode.DIRECTORY_UNREADABLE ->
          "The WebDAV server refused to list a directory." to
            "Check that the account may list the configured folder."
        else -> "The WebDAV connection was lost." to "Reconnect the repository."
      }
    return RemoteClientException(code, message, action, status, cause)
  }
}
