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
import org.apache.commons.net.ftp.FTPClientConfig
import org.apache.commons.net.ftp.FTPConnectionClosedException
import org.apache.commons.net.ftp.FTPFile
import org.apache.commons.net.ftp.FTPReply

/**
 * Read-only FTP [RemoteClient] on Apache Commons Net.
 *
 * Passive mode is mandatory (protocol-audit.sh fails on PORT/EPRT). Listings go through
 * MLSD when the server advertises MLST and through LIST otherwise, always parsed by
 * Commons Net; this class never issues a content transfer command. LIST dates are read as UTC
 * (decision log 2026-10-01), the zone vsftpd and most Unix servers print them in by default.
 */
class FtpRemoteClient(
  private val dispatcher: CoroutineDispatcher = Dispatchers.IO,
  private val clientFactory: () -> FTPClient = ::FTPClient,
) : RemoteClient {

  @Volatile private var ftp: FTPClient? = null
  @Volatile private var config: RemoteConfig? = null

  /** The session whose LIST parser has been configured for UTC; a new session configures again. */
  @Volatile private var listConfiguredFor: FTPClient? = null

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
      guarded(client) {
        val entries = fetchListing(client, directory).mapNotNull(FtpListing::toEntry)
        if (entries.isEmpty() || FtpListing.couldBeSelfEntry(directory, entries)) probeReadable(client, directory)
        entries
      }
    }

  override suspend fun discoverPrecision(): PrecisionFinding =
    withContext(dispatcher) {
      val client = session()
      val root = config?.rootPaths?.firstOrNull() ?: "/"
      guarded(client) {
        val (directory, samples) =
          findSampleDirectory(client, root) ?: return@guarded FtpPrecision.NO_SAMPLE
        // Without MLST the scan matches against LIST dates, so the precision must be what LIST
        // actually prints (decision log 2026-10-01): MDTM's whole seconds would claim a precision
        // the listing never delivers, and date-only entries would then almost never match.
        if (!client.hasFeature("MLST")) return@guarded FtpPrecision.fromListFiles(samples)
        // Commons Net documents MDTM's ".xxx" fraction as optional and warns that not every
        // server honours MDTM, so the advertisement only gates the probe; the replies decide.
        if (client.hasFeature("MDTM")) {
          val instants =
            samples.take(PRECISION_SAMPLES).mapNotNull {
              client.mdtmInstant(joinPath(directory, it.name))
            }
          FtpPrecision.fromMdtm(instants)?.let { return@guarded it }
        }
        FtpPrecision.fromMlsdFacts(samples.mapNotNull { it.rawListing })?.let { return@guarded it }
        // LIST samples come from a fresh LIST so the parsed Calendar fields are still intact.
        FtpPrecision.fromListFiles(fetchList(client, directory).toList())
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

  /**
   * Tells an empty directory from one the account may not read (research R5, decision log
   * 2026-09-30). vsftpd answers LIST on a `0700` directory it cannot open with 150/226 and no
   * entries, exactly like an empty one; only CWD is refused, with 550. So an empty listing is
   * confirmed with a CWD probe, and the session then goes back to where it was. CWD and PWD
   * are navigation commands, not content transfers, so the protocol audit stays clean.
   */
  private fun probeReadable(client: FTPClient, directory: String) {
    val original = client.printWorkingDirectory()
    if (client.changeWorkingDirectory(directory)) {
      if (original != null && !client.changeWorkingDirectory(original)) {
        throw failure(CloudSyncErrorCode.CONNECTION_LOST, client.replyCode)
      }
      return
    }
    if (client.replyCode == FTPReply.FILE_UNAVAILABLE) {
      throw failure(CloudSyncErrorCode.DIRECTORY_UNREADABLE, client.replyCode)
    }
  }

  private fun fetchList(client: FTPClient, directory: String): Array<FTPFile> {
    // Commons Net builds its LIST parser once per session, on the first LIST, so the UTC
    // configuration has to be in place before that. SYST names the dialect, exactly as Commons
    // Net's own auto-detection would ask.
    if (listConfiguredFor !== client) {
      client.configure(FtpListing.listConfig(client.systemType))
      listConfiguredFor = client
    }
    return checked(client, client.listFiles(directory))
  }

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

  const val LIST_TIME_ZONE = "UTC"

  /**
   * The LIST parser configuration for a server that reported [systemType] to SYST: the same
   * dialect Commons Net would auto-detect, with LIST dates read as UTC instead of in the
   * device's time zone (decision log 2026-10-01).
   */
  fun listConfig(systemType: String): FTPClientConfig =
    FTPClientConfig(systemType).apply { serverTimeZoneId = LIST_TIME_ZONE }

  /**
   * Whether [entries] may be the directory itself rather than its contents. vsftpd answers LIST on a
   * `0700` directory whose parent it can read by listing the parent filtered to that name, so the
   * listing holds one directory entry named like the folder (seen in the feature 007 e2e run: LIST
   * `/scan/partial/restricted` returned `restricted`). Only a CWD probe tells that apart from a
   * readable folder that really holds one folder of its own name.
   */
  fun couldBeSelfEntry(directory: String, entries: List<RemoteEntry>): Boolean {
    val entry = entries.singleOrNull() ?: return false
    val name = directory.trimEnd('/').substringAfterLast('/')
    return entry.type == RemoteEntryType.DIRECTORY && name.isNotEmpty() && entry.name == name
  }

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

  /** LIST granularity over the regular files of one listing (directories carry no file dates). */
  fun fromListFiles(files: List<FTPFile>): PrecisionFinding =
    fromListTimestamps(
      files.filter { FtpListing.classify(it) == RemoteEntryType.REGULAR_FILE }.mapNotNull { it.timestamp }
    )

  /**
   * Commons Net's timestamp parser computes every field and then clears only the one just below
   * the precision the line printed (HOUR_OF_DAY for a date-only line, SECOND for `HH:mm`), so
   * the first unset field, read from the coarse end, is what decides.
   */
  fun granularityOfCalendar(calendar: Calendar): Long =
    when {
      !calendar.isSet(Calendar.HOUR_OF_DAY) -> DAY_MILLIS
      !calendar.isSet(Calendar.MINUTE) -> 3_600_000L
      !calendar.isSet(Calendar.SECOND) -> 60_000L
      else -> 1_000L
    }
}
