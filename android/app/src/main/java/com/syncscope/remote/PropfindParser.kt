package com.syncscope.remote

import android.util.Xml
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.URI
import java.net.URISyntaxException
import java.time.DateTimeException
import java.time.Instant
import java.time.format.DateTimeFormatter
import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlPullParserException

/** One `DAV:response` of a multistatus body, holding only properties from 2xx propstats. */
internal data class PropfindResponse(
  /** Percent-decoded href path without a trailing slash ("/" for the server root). */
  val path: String,
  val displayName: String?,
  val contentLength: Long?,
  val lastModified: String?,
  val isCollection: Boolean,
)

/**
 * Streaming parser for PROPFIND multistatus bodies (RFC 4918 §14.16) on the platform
 * XmlPullParser, so no XML binding library is pulled in. Only the four properties the
 * client asks for are read; everything else is skipped.
 */
internal object PropfindParser {
  private const val DAV = "DAV:"

  /** Requests exactly the properties a listing needs, never `allprop`. */
  const val REQUEST_BODY =
    "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
      "<D:propfind xmlns:D=\"DAV:\"><D:prop>" +
      "<D:displayname/><D:getcontentlength/><D:getlastmodified/><D:resourcetype/>" +
      "</D:prop></D:propfind>"

  fun newParser(): XmlPullParser =
    Xml.newPullParser().apply {
      setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, true)
      // Server-supplied DTDs are never honoured; a custom entity then fails the parse.
      runCatching { setFeature(XmlPullParser.FEATURE_PROCESS_DOCDECL, false) }
    }

  /** Parses a multistatus body; throws XmlPullParserException on malformed XML. */
  fun parse(input: InputStream, parser: XmlPullParser = newParser()): List<PropfindResponse> {
    parser.setInput(input, null)
    val responses = ArrayList<PropfindResponse>()
    var closed = false
    var event = parser.eventType
    while (event != XmlPullParser.END_DOCUMENT) {
      when {
        event == XmlPullParser.START_TAG && parser.depth == 1 && !parser.isDav("multistatus") ->
          throw XmlPullParserException("root is not DAV:multistatus")
        event == XmlPullParser.START_TAG && parser.isDav("response") ->
          readResponse(parser)?.let(responses::add)
        event == XmlPullParser.END_TAG && parser.depth == 1 -> closed = true
      }
      event = parser.next()
    }
    // A body cut off mid-listing must never read as a shorter directory.
    if (!closed) throw XmlPullParserException("truncated multistatus")
    return responses
  }

  /**
   * The direct children of [requestedPath] (an encoded or decoded URL path). The
   * self-referential entry for the requested collection is skipped.
   */
  fun children(requestedPath: String, responses: List<PropfindResponse>): List<RemoteEntry> {
    val self = normalize(percentDecode(requestedPath))
    return responses.mapNotNull { response ->
      if (response.path == self) return@mapNotNull null
      val name = response.path.substringAfterLast('/').ifEmpty { response.displayName.orEmpty() }
      if (name.isEmpty() || name == "." || name == "..") return@mapNotNull null
      RemoteEntry(
        name = name,
        sizeBytes = response.contentLength?.takeIf { it >= 0 } ?: -1L,
        modifiedUtcMillis = parseLastModified(response.lastModified),
        type = if (response.isCollection) RemoteEntryType.DIRECTORY else RemoteEntryType.REGULAR_FILE,
      )
    }
  }

  /** RFC 1123 in GMT; a malformed or absent date is null so the entry can be marked UNKNOWN. */
  fun parseLastModified(raw: String?): Long? {
    val text = raw?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    return try {
      Instant.from(DateTimeFormatter.RFC_1123_DATE_TIME.parse(text)).toEpochMilli()
    } catch (_: DateTimeException) {
      null
    }
  }

  /** An href may be an absolute URL or an absolute path; either becomes a decoded path. */
  fun hrefToPath(href: String): String? {
    val trimmed = href.trim()
    if (trimmed.isEmpty()) return null
    val rawPath =
      if (trimmed.contains("://")) {
        try {
          URI(trimmed).rawPath ?: return null
        } catch (_: URISyntaxException) {
          return null
        }
      } else {
        trimmed.substringBefore('?').substringBefore('#')
      }
    return normalize(percentDecode(rawPath))
  }

  private fun readResponse(parser: XmlPullParser): PropfindResponse? {
    val depth = parser.depth
    var href: String? = null
    var displayName: String? = null
    var contentLength: Long? = null
    var lastModified: String? = null
    var isCollection = false
    var anySuccess = false
    while (true) {
      val event = parser.next()
      if (event == XmlPullParser.END_DOCUMENT) throw truncated()
      if (event == XmlPullParser.END_TAG && parser.depth == depth) break
      if (event != XmlPullParser.START_TAG) continue
      when {
        parser.isDav("href") && parser.depth == depth + 1 -> href = readText(parser)
        parser.isDav("propstat") -> {
          val stat = readPropstat(parser)
          if (stat.success) {
            anySuccess = true
            stat.displayName?.let { displayName = it }
            stat.contentLength?.let { contentLength = it }
            stat.lastModified?.let { lastModified = it }
            isCollection = isCollection || stat.isCollection
          }
        }
      }
    }
    val path = href?.let(::hrefToPath) ?: return null
    // A response without any successful propstat (e.g. a bare 404 status) is not a listing entry.
    if (!anySuccess) return null
    return PropfindResponse(path, displayName, contentLength, lastModified, isCollection)
  }

  private class Propstat {
    var success = true
    var displayName: String? = null
    var contentLength: Long? = null
    var lastModified: String? = null
    var isCollection = false
  }

  private fun readPropstat(parser: XmlPullParser): Propstat {
    val depth = parser.depth
    val stat = Propstat()
    while (true) {
      val event = parser.next()
      if (event == XmlPullParser.END_DOCUMENT) throw truncated()
      if (event == XmlPullParser.END_TAG && parser.depth == depth) return stat
      if (event != XmlPullParser.START_TAG || parser.namespace != DAV) continue
      when (parser.name) {
        "status" -> stat.success = statusCode(readText(parser)) in 200..299
        "displayname" -> stat.displayName = readText(parser)
        "getcontentlength" -> stat.contentLength = readText(parser).trim().toLongOrNull()
        "getlastmodified" -> stat.lastModified = readText(parser)
        "collection" -> stat.isCollection = true
      }
    }
  }

  /** "HTTP/1.1 200 OK" → 200; anything unparseable is treated as a failure. */
  private fun statusCode(line: String): Int =
    line.trim().split(Regex("\\s+")).getOrNull(1)?.toIntOrNull() ?: -1

  /** Concatenates all text inside the current element, tolerating nested markup. */
  private fun readText(parser: XmlPullParser): String {
    val depth = parser.depth
    val text = StringBuilder()
    while (true) {
      when (parser.next()) {
        XmlPullParser.TEXT -> text.append(parser.text)
        XmlPullParser.END_TAG -> if (parser.depth == depth) return text.toString()
        XmlPullParser.END_DOCUMENT -> throw truncated()
      }
    }
  }

  private fun truncated() = XmlPullParserException("truncated multistatus")

  private fun XmlPullParser.isDav(local: String): Boolean = namespace == DAV && name == local

  private fun normalize(path: String): String {
    val trimmed = path.trimEnd('/')
    return if (trimmed.isEmpty()) "/" else trimmed
  }

  /** Percent-decodes UTF-8 without URLDecoder's form semantics ('+' stays '+'). */
  private fun percentDecode(value: String): String {
    if (!value.contains('%')) return value
    val out = ByteArrayOutputStream(value.length)
    var i = 0
    while (i < value.length) {
      val c = value[i]
      if (c == '%' && i + 2 < value.length) {
        val hi = Character.digit(value[i + 1], 16)
        val lo = Character.digit(value[i + 2], 16)
        if (hi >= 0 && lo >= 0) {
          out.write((hi shl 4) or lo)
          i += 3
          continue
        }
      }
      out.write(c.toString().toByteArray(Charsets.UTF_8))
      i++
    }
    return out.toString(Charsets.UTF_8.name())
  }
}
