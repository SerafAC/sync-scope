package com.syncscope.remote

import com.syncscope.bridge.CloudSyncErrorCode
import java.io.IOException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.time.Duration
import java.time.Instant
import java.util.Calendar
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.apache.commons.net.ftp.FTPClient
import org.apache.commons.net.ftp.FTPConnectionClosedException
import org.apache.commons.net.ftp.FTPFile
import org.apache.commons.net.ftp.FTPReply

/**
 * Read-only FTP [RemoteClient] on Apache Commons Net.
 *
 * Passive mode is mandatory (protocol-audit.sh fails on PORT/EPRT). Listings go through
 * MLSD when the server advertises MLST and through LIST otherwise, always parsed by
 * Commons Net; this class never issues a content transfer command.
 */
class FtpRemoteClient(
  private val dispatcher: CoroutineDispatcher = Dispatchers.IO,
  private val clientFactory: () -> FTPClient = ::FTPClient,
) : RemoteClient {

  @Volatile private var ftp: FTPClient? = null
  @Volatile private var config: RemoteConfig? = null

  override suspend fun connect(config: RemoteConfig, password: CharArray): ConnectOutcome =
    withContext(dispatcher) {
      require(config.protocol == RemoteProtocol.FTP) { "FtpRemoteClient cannot serve ${config.protocol}" }
      close()
      val client =
        clientFactory().apply {
          connectTimeout = CONNECT_TIMEOUT_MS
          defaultTimeout = SOCKET_TIMEOUT_MS
          setDataTimeout(Duration.ofMillis(SOCKET_TIMEOUT_MS.toLong()))
          controlEncoding = "UTF-8"
        }
      try {
        guarded(client) {
          client.connect(config.host, config.port)
          if (!FTPReply.isPositiveCompletion(client.replyCode)) {
            throw failure(CloudSyncErrorCode.CONNECTION_REFUSED, client.replyCode)
          }
          client.soTimeout = SOCKET_TIMEOUT_MS
          if (!client.login(config.username, String(password))) {
            throw failure(CloudSyncErrorCode.AUTH_FAILED, client.replyCode)
          }
          client.enterLocalPassiveMode()
        }
      } catch (t: Throwable) {
        // Includes cancellation: a half-open control socket must never outlive the attempt.
        disconnectQuietly(client)
        throw t
      }
      ftp = client
      this@FtpRemoteClient.config = config
      ConnectOutcome.Connected
    }

  override suspend fun list(directory: String): List<RemoteEntry> =
    withContext(dispatcher) {
      val client = session()
      guarded(client) { fetchListing(client, directory) }.mapNotNull(FtpListing::toEntry)
    }

  override suspend fun discoverPrecision(): PrecisionFinding =
    withContext(dispatcher) {
      val client = session()
      val root = config?.rootPath ?: "/"
      guarded(client) {
        val (directory, samples) =
          findSampleDirectory(client, root) ?: return@guarded FtpPrecision.NO_SAMPLE
        // Commons Net documents MDTM's ".xxx" fraction as optional and warns that not every
        // server honours MDTM, so the advertisement only gates the probe; the replies decide.
        if (client.hasFeature("MDTM")) {
          val instants =
            samples.take(PRECISION_SAMPLES).mapNotNull {
              client.mdtmInstant(joinPath(directory, it.name))
            }
          FtpPrecision.fromMdtm(instants)?.let { return@guarded it }
        }
        if (client.hasFeature("MLST")) {
          FtpPrecision.fromMlsdFacts(samples.mapNotNull { it.rawListing })?.let { return@guarded it }
        }
        // LIST samples come from a fresh LIST so the parsed Calendar fields are still intact.
        val listSamples =
          if (client.hasFeature("MLST")) fetchList(client, directory).toList() else samples
        FtpPrecision.fromListTimestamps(
          listSamples
            .filter { FtpListing.classify(it) == RemoteEntryType.REGULAR_FILE }
            .mapNotNull { it.timestamp },
        )
      }
    }

  override fun close() {
    val client = ftp ?: return
    ftp = null
    config = null
    disconnectQuietly(client)
  }

  private fun session(): FTPClient =
    ftp?.takeIf { it.isConnected }
      ?: throw RemoteClientException(
        CloudSyncErrorCode.CONNECTION_LOST,
        "The FTP session is not connected.",
        "Reconnect the repository.",
      )

  /**
   * Finds the nearest directory that actually holds regular files, starting at [root].
   * A repository root commonly contains only folders, and sampling just the root would then
   * report NO_SAMPLE and leave the server's timestamp precision undiscovered. The walk is
   * breadth-first so the shallowest samples win, and bounded by [PRECISION_SCAN_DIRECTORIES]
   * so a deep or hostile tree cannot turn discovery into a full crawl.
   */
  private fun findSampleDirectory(
    client: FTPClient,
    root: String,
  ): Pair<String, List<FTPFile>>? {
    val queue = ArrayDeque(listOf(root))
    var visited = 0
    while (queue.isNotEmpty() && visited < PRECISION_SCAN_DIRECTORIES) {
      val directory = queue.removeFirst()
      visited++
      // toEntry drops "." / ".." and MLSD cdir/pdir, so the walk cannot revisit its parent.
      val children = fetchListing(client, directory).filter { FtpListing.toEntry(it) != null }
      val files = children.filter { FtpListing.classify(it) == RemoteEntryType.REGULAR_FILE }
      if (files.isNotEmpty()) return directory to files
      children
        .filter { FtpListing.classify(it) == RemoteEntryType.DIRECTORY }
        .forEach { queue.addLast(joinPath(directory, it.name)) }
    }
    return null
  }

  private fun fetchListing(client: FTPClient, directory: String): Array<FTPFile> =
    if (client.hasFeature("MLST")) {
      checked(client, client.mlistDir(directory))
    } else {
      fetchList(client, directory)
    }

  private fun fetchList(client: FTPClient, directory: String): Array<FTPFile> =
    checked(client, client.listFiles(directory))

  /** Commons Net returns an empty array on a refused listing; the reply code tells them apart. */
  private fun checked(client: FTPClient, files: Array<FTPFile>): Array<FTPFile> {
    if (!FTPReply.isPositiveCompletion(client.replyCode)) {
      throw failure(CloudSyncErrorCode.DIRECTORY_UNREADABLE, client.replyCode)
    }
    return files
  }

  private inline fun <T> guarded(client: FTPClient, block: () -> T): T =
    try {
      block()
    } catch (e: IOException) {
      throw mapFailure(e, client.replyCode.takeIf { it > 0 })
    }

  private fun disconnectQuietly(client: FTPClient) {
    try {
      if (client.isConnected) {
        client.logout()
      }
    } catch (_: IOException) {
      // The session is being torn down; a failed QUIT changes nothing.
    }
    try {
      if (client.isConnected) {
        client.disconnect()
      }
    } catch (_: IOException) {
    }
  }

  companion object {
    const val CONNECT_TIMEOUT_MS = 15_000
    const val SOCKET_TIMEOUT_MS = 30_000

    /** Several samples keep a millisecond server whose one sampled file sits on .000 from reading as 1s. */
    const val PRECISION_SAMPLES = 5

    /** Upper bound on directories read while looking for timestamp samples. */
    const val PRECISION_SCAN_DIRECTORIES = 16

    internal fun joinPath(directory: String, name: String): String =
      if (directory.endsWith("/")) "$directory$name" else "$directory/$name"

    /**
     * Maps a transport failure onto a stable code. The original exception is kept only
     * as the cause; its text (which names the host) never becomes the message.
     */
    internal fun mapFailure(e: IOException, replyCode: Int? = null): RemoteClientException {
      val code =
        when (e) {
          is SocketTimeoutException -> CloudSyncErrorCode.CONNECTION_TIMEOUT
          is ConnectException,
          is NoRouteToHostException,
          is UnknownHostException -> CloudSyncErrorCode.CONNECTION_REFUSED
          is FTPConnectionClosedException -> CloudSyncErrorCode.CONNECTION_LOST
          else -> CloudSyncErrorCode.CONNECTION_LOST
        }
      return failure(code, replyCode, e)
    }

    internal fun failure(
      code: CloudSyncErrorCode,
      replyCode: Int? = null,
      cause: Throwable? = null,
    ): RemoteClientException {
      val (message, action) =
        when (code) {
          CloudSyncErrorCode.AUTH_FAILED ->
            "The FTP server rejected the username or password." to "Check the credentials and try again."
          CloudSyncErrorCode.CONNECTION_REFUSED ->
            "The FTP server could not be reached or refused the connection." to
              "Check the host and port, and that the server is running."
          CloudSyncErrorCode.CONNECTION_TIMEOUT ->
            "The FTP server did not respond in time." to "Check the network and try again."
          CloudSyncErrorCode.DIRECTORY_UNREADABLE ->
            "The FTP server refused to list a directory." to
              "Check that the account may list the configured folder."
          else -> "The FTP connection was lost." to "Reconnect the repository."
        }
      return RemoteClientException(code, message, action, replyCode, cause)
    }
  }
}

/** Pure FTPFile-to-[RemoteEntry] mapping, shared by listing and precision sampling. */
internal object FtpListing {
  private val MLSD_DOT_TYPES = Regex("""(?i)(?:^|;)type=(?:cdir|pdir);""")

  /** Symlinks are OTHER even though a server may resolve them; they are never followed. */
  fun classify(file: FTPFile): RemoteEntryType =
    when {
      file.isSymbolicLink -> RemoteEntryType.OTHER
      file.isFile -> RemoteEntryType.REGULAR_FILE
      file.isDirectory -> RemoteEntryType.DIRECTORY
      else -> RemoteEntryType.OTHER
    }

  /** Returns null for "." / ".." and MLSD cdir/pdir entries, which are not children. */
  fun toEntry(file: FTPFile): RemoteEntry? {
    val name = file.name ?: return null
    if (name.isEmpty() || name == "." || name == "..") return null
    if (file.rawListing?.let { MLSD_DOT_TYPES.containsMatchIn(it) } == true) return null
    return RemoteEntry(
      name = name,
      sizeBytes = file.size,
      modifiedUtcMillis = file.timestamp?.timeInMillis,
      type = classify(file),
    )
  }
}

/**
 * Empirical precision derivation (R004). Each source reports the finest granularity it
 * actually delivered; a server that only ever returns whole seconds is treated as 1s
 * even when it advertises a fractional-capable command.
 */
internal object FtpPrecision {
  const val LIST_FLOOR_MILLIS = 60_000L
  private const val DAY_MILLIS = 86_400_000L

  val NO_SAMPLE = PrecisionFinding(LIST_FLOOR_MILLIS, PrecisionBasis.NO_SAMPLE_FILES)

  private val MLSD_MODIFY = Regex("""(?i)(?:^|;)modify=(\d{14})(?:\.(\d+))?""")

  /** 1000 for whole seconds, else the coarsest decimal step (100/10/1 ms) the nanos land on. */
  fun granularityOfNanos(nanos: Int): Long =
    when {
      nanos == 0 -> 1_000L
      nanos % 100_000_000 == 0 -> 100L
      nanos % 10_000_000 == 0 -> 10L
      else -> 1L
    }

  /** Null when there are no MDTM replies to judge by. */
  fun fromMdtm(instants: List<Instant>): PrecisionFinding? {
    if (instants.isEmpty()) return null
    val precision = instants.minOf { granularityOfNanos(it.nano) }
    val basis = if (precision < 1_000L) PrecisionBasis.MDTM_SUBSECOND else PrecisionBasis.MDTM_WHOLE_SECONDS
    return PrecisionFinding(precision, basis)
  }

  /** Reads the `modify` fact straight from raw MLSD lines; null when no line carries one. */
  fun fromMlsdFacts(rawListings: List<String>): PrecisionFinding? {
    val granularities =
      rawListings.mapNotNull { line ->
        val match = MLSD_MODIFY.find(line) ?: return@mapNotNull null
        val fraction = match.groupValues[2]
        if (fraction.isEmpty()) {
          1_000L
        } else {
          granularityOfNanos(fraction.take(9).padEnd(9, '0').toInt())
        }
      }
    if (granularities.isEmpty()) return null
    val precision = granularities.min()
    val basis = if (precision < 1_000L) PrecisionBasis.MLSD_SUBSECOND else PrecisionBasis.MLSD_WHOLE_SECONDS
    return PrecisionFinding(precision, basis)
  }

  /**
   * LIST granularity is whatever the dialect printed. Commons Net clears the Calendar
   * fields below that, so the coarsest sample wins (a year-form line is day-granular),
   * never finer than the one-minute floor.
   */
  fun fromListTimestamps(timestamps: List<Calendar>): PrecisionFinding {
    if (timestamps.isEmpty()) return NO_SAMPLE
    val coarsest = timestamps.maxOf(::granularityOfCalendar)
    return PrecisionFinding(maxOf(coarsest, LIST_FLOOR_MILLIS), PrecisionBasis.LIST_GRANULARITY)
  }

  fun granularityOfCalendar(calendar: Calendar): Long =
    when {
      calendar.isSet(Calendar.SECOND) -> 1_000L
      calendar.isSet(Calendar.MINUTE) -> 60_000L
      calendar.isSet(Calendar.HOUR_OF_DAY) -> 3_600_000L
      else -> DAY_MILLIS
    }
}
