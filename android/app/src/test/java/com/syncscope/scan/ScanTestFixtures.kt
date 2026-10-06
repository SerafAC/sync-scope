package com.syncscope.scan

import android.content.Context
import androidx.room.Room
import com.syncscope.bridge.CloudSyncErrorCode
import com.syncscope.credential.CredentialStore
import com.syncscope.persistence.LocalNodeEntity
import com.syncscope.persistence.RemoteMatchKeyEntity
import com.syncscope.persistence.RepositoryConfigEntity
import com.syncscope.persistence.SnapshotStore
import com.syncscope.persistence.SyncScopeDatabase
import com.syncscope.persistence.sourceRoot
import com.syncscope.remote.ConnectOutcome
import com.syncscope.remote.HostKeyChallenge
import com.syncscope.remote.PrecisionBasis
import com.syncscope.remote.PrecisionFinding
import com.syncscope.remote.RemoteClient
import com.syncscope.remote.RemoteClientException
import com.syncscope.remote.RemoteClientFactory
import com.syncscope.remote.RemoteConfig
import com.syncscope.remote.RemoteEntry
import com.syncscope.remote.RemoteEntryType
import com.syncscope.remote.RemoteProtocol
import com.syncscope.remote.RemoteRoots
import com.syncscope.source.LocalFile
import com.syncscope.source.LocalSourceEnumerator
import com.syncscope.source.SourceAvailability
import com.syncscope.source.SourceListing
import com.syncscope.persistence.SourceRootEntity
import java.util.Collections
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CompletableDeferred

/** A fixed epoch-millis mtime on a whole second, so `MTIME + 400` stays in the same 1 s bucket. */
const val MTIME = 1_704_067_200_000L
const val REMOTE_ROOT = "/backup"
const val REMOTE_HOST = "10.0.2.2"

fun remoteFile(name: String, size: Long, mtime: Long? = MTIME) = RemoteEntry(name, size, mtime, RemoteEntryType.REGULAR_FILE)

fun remoteDir(name: String) = RemoteEntry(name, 0, MTIME, RemoteEntryType.DIRECTORY)

fun localFile(
  documentId: String,
  name: String,
  size: Long? = 10L,
  mtime: Long? = MTIME,
  parent: String? = null,
) = LocalFile(documentId, parent, name, isDirectory = false, isHidden = name.startsWith("."), mimeType = "text/plain", sizeBytes = size, modifiedUtcMillis = mtime)

fun localDir(documentId: String, name: String, parent: String? = null) =
  LocalFile(documentId, parent, name, isDirectory = true, isHidden = name.startsWith("."), mimeType = "vnd.android.document/directory", sizeBytes = null, modifiedUtcMillis = null)

/**
 * A scripted remote: directory path → entries or a failure code. Every client it creates is kept, so
 * tests can assert that each one was closed. With [gate] set, `list` suspends until it is completed
 * (after completing [reachedGate]), which holds a run mid-walk.
 */
class FakeRemote : RemoteClientFactory {
  val tree = HashMap<String, Any>()
  var precisionMillis = 1_000L
  var connectFailure: CloudSyncErrorCode? = null
  var hostKeyChallenge: HostKeyChallenge? = null
  @Volatile var gate: CompletableDeferred<Unit>? = null
  @Volatile var reachedGate = CompletableDeferred<Unit>()
  val created: MutableList<FakeRemoteClient> = Collections.synchronizedList(mutableListOf())

  /** Makes every `list` suspend until [release]; await [reachedGate] to know a run is mid-walk. */
  fun hold() {
    reachedGate = CompletableDeferred()
    gate = CompletableDeferred()
  }

  fun release() {
    gate?.complete(Unit)
    gate = null
  }

  fun dir(path: String, vararg entries: RemoteEntry) {
    tree[path] = entries.toList()
  }

  fun fail(path: String, code: CloudSyncErrorCode) {
    tree[path] = code
  }

  override fun create(protocol: RemoteProtocol): RemoteClient = FakeRemoteClient(this).also { created += it }
}

class FakeRemoteClient(private val remote: FakeRemote) : RemoteClient {
  @Volatile var closed = false
  var connectedTo: RemoteConfig? = null

  override suspend fun connect(config: RemoteConfig, password: CharArray): ConnectOutcome {
    remote.connectFailure?.let {
      // The message names the host and a path on purpose: the engine must redact it.
      throw RemoteClientException(it, "Server $REMOTE_HOST rejected alice for $REMOTE_ROOT/secret", "Check the credentials and try again.")
    }
    remote.hostKeyChallenge?.let { return ConnectOutcome.HostKeyApprovalRequired(it) }
    connectedTo = config
    return ConnectOutcome.Connected
  }

  override suspend fun list(directory: String): List<RemoteEntry> {
    remote.gate?.let {
      remote.reachedGate.complete(Unit)
      it.await()
    }
    val next = remote.tree[directory] ?: CloudSyncErrorCode.DIRECTORY_UNREADABLE
    if (next is CloudSyncErrorCode) throw RemoteClientException(next, "Cannot list $directory on $REMOTE_HOST", null)
    @Suppress("UNCHECKED_CAST")
    return next as List<RemoteEntry>
  }

  override suspend fun discoverPrecision(): PrecisionFinding =
    PrecisionFinding(remote.precisionMillis, PrecisionBasis.SFTP_V3_WHOLE_SECONDS)

  override fun close() {
    closed = true
  }
}

/** Per-source scripted listings; an unscripted source is available and empty. */
class FakeEnumerator : LocalSourceEnumerator {
  private val listings = HashMap<String, () -> SourceListing>()

  fun files(sourceId: String, vararg files: LocalFile) {
    val list = files.toList()
    listings[sourceId] = { SourceListing.Available(list.asSequence()) }
  }

  /** Yields [files], then throws [failure] as the provider would mid-walk. */
  fun failing(sourceId: String, failure: Exception, vararg files: LocalFile) {
    val list = files.toList()
    listings[sourceId] = {
      SourceListing.Available(
        sequence {
          yieldAll(list)
          throw failure
        }
      )
    }
  }

  fun skip(sourceId: String, reason: SourceAvailability) {
    listings[sourceId] = { SourceListing.Skipped(reason) }
  }

  override fun enumerate(source: SourceRootEntity): SourceListing =
    listings[source.sourceId]?.invoke() ?: SourceListing.Available(emptySequence())
}

/** Records every staged batch so tests can assert batch sizes (research R9). */
class RecordingSnapshotStore(db: SyncScopeDatabase) : SnapshotStore(db) {
  val localBatches: MutableList<List<LocalNodeEntity>> = Collections.synchronizedList(mutableListOf())
  val matchKeyBatches: MutableList<List<RemoteMatchKeyEntity>> = Collections.synchronizedList(mutableListOf())

  override suspend fun stageLocalNodes(nodes: List<LocalNodeEntity>) {
    localBatches += nodes
    super.stageLocalNodes(nodes)
  }

  override suspend fun stageMatchKeys(keys: List<RemoteMatchKeyEntity>) {
    matchKeyBatches += keys
    super.stageMatchKeys(keys)
  }
}

/** An in-memory Room database, fakes for both sides and a stepping clock, wired into a [ScanEngine]. */
class ScanHarness(context: Context) {
  val db: SyncScopeDatabase =
    Room.inMemoryDatabaseBuilder(context, SyncScopeDatabase::class.java).allowMainThreadQueries().build()
  val store = RecordingSnapshotStore(db)
  val remote = FakeRemote()
  val enumerator = FakeEnumerator()
  val credentials = CredentialStore { context.getSharedPreferences("scan-test-credentials", Context.MODE_PRIVATE) }

  /** Every read advances the clock by [tick] ms, so throttling can be observed. */
  val now = AtomicLong(10_000L)
  var tick = 1L
  val clock: () -> Long = { now.addAndGet(tick) }
  private val ids = AtomicInteger()
  val newId: () -> String = { "id-${ids.incrementAndGet()}" }

  /** How many times the engine paused before matching a local file (debug-only e2e pacing). */
  val pauses = AtomicInteger()

  val engine = ScanEngine(
    store = store,
    repositories = db.repositoryConfigDao(),
    sourceRoots = db.sourceRootDao(),
    credentials = credentials,
    clients = remote,
    enumerator = enumerator,
    walker = RemoteWalker(delay = {}),
    clock = clock,
    newId = newId,
    perFilePause = { pauses.incrementAndGet() },
  )

  suspend fun configure(
    revision: Long = 1L,
    credentialVersion: Long? = null,
    protocol: String = "SFTP",
    webdavHttps: Boolean = false,
  ): RepositoryConfigEntity {
    val version = credentialVersion ?: credentials.store("secret-password".toCharArray())
    val row =
      RepositoryConfigEntity(
        protocol = protocol,
        host = REMOTE_HOST,
        port = 2222,
        username = "alice",
        remoteRoots = RemoteRoots.encode(listOf(REMOTE_ROOT)),
        precisionMillis = 0L,
        credentialVersion = version,
        revision = revision,
        webdavHttps = webdavHttps,
      )
    db.repositoryConfigDao().put(row)
    return row
  }

  suspend fun addSource(sourceId: String) {
    db.sourceRootDao().insert(sourceRoot(sourceId))
  }

  /** Runs [mode] to its end on the calling coroutine, recording progress publications. */
  suspend fun scan(mode: ScanMode = ScanMode.FULL, progress: ScanProgress = ScanProgress(clock)): ScanOutcome =
    engine.execute(engine.begin(mode), progress, RunControl())

  suspend fun nodes(snapshotId: String): List<LocalNodeEntity> =
    db.localNodeDao().page(androidx.sqlite.db.SimpleSQLiteQuery("SELECT * FROM local_node WHERE snapshotId = ?", arrayOf(snapshotId)))

  fun close() = db.close()
}
