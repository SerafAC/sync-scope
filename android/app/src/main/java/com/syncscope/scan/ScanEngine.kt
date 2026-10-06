package com.syncscope.scan

import android.net.Uri
import android.provider.DocumentsContract
import com.syncscope.bridge.CloudSyncEnvelope
import com.syncscope.bridge.CloudSyncErrorCode
import com.syncscope.bridge.FileIssueCode
import com.syncscope.bridge.connectRepository
import com.syncscope.bridge.toRemoteConfig
import com.syncscope.credential.CredentialStore
import com.syncscope.persistence.LocalNodeEntity
import com.syncscope.persistence.RemoteAmbiguityEntity
import com.syncscope.persistence.RepositoryConfigDao
import com.syncscope.persistence.RepositoryConfigEntity
import com.syncscope.persistence.ScanRunEntity
import com.syncscope.persistence.SnapshotCountsEntity
import com.syncscope.persistence.SnapshotEntity
import com.syncscope.persistence.SnapshotStore
import com.syncscope.persistence.SourceRootDao
import com.syncscope.persistence.SourceRootEntity
import com.syncscope.remote.RemoteClient
import com.syncscope.remote.RemoteClientException
import com.syncscope.remote.RemoteClientFactory
import com.syncscope.remote.RemoteConfig
import com.syncscope.remote.RemoteProtocol
import com.syncscope.source.LocalFile
import com.syncscope.source.LocalSourceEnumerator
import com.syncscope.source.SourceListing
import java.io.IOException
import java.util.UUID
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

/** Mirrors `ScanMode` in `src/native/CloudSyncContracts.ts` (research R2). */
enum class ScanMode {
  FULL,
  LOCAL_REFRESH,
}

/** Mirrors `ScanPhase` in `src/native/CloudSyncContracts.ts` (data-model "State machine"). */
enum class ScanPhase {
  CONNECTING,
  LISTING_REMOTE,
  COPYING_REMOTE,
  ENUMERATING_LOCAL,
  PUBLISHING,
  PUBLISHED,
  CANCELLED,
  FAILED,
  ABORTED,
}

/** A start precondition failed: no run was created. [code] is the `startScan` error code. */
open class ScanRefused(val code: CloudSyncErrorCode) : Exception(code.name)

class RepositoryNotConfigured : ScanRefused(CloudSyncErrorCode.REPOSITORY_NOT_CONFIGURED)

class CredentialUnavailable : ScanRefused(CloudSyncErrorCode.CREDENTIAL_UNAVAILABLE)

class NoSourcesSelected : ScanRefused(CloudSyncErrorCode.NO_SOURCES_SELECTED)

/** LOCAL_REFRESH without an active snapshot, or against a repository that changed since (research R2). */
class RefreshUnavailable : ScanRefused(CloudSyncErrorCode.REFRESH_UNAVAILABLE)

/** A created run with its staged snapshot, ready for [ScanEngine.execute]. */
class ScanTicket internal constructor(
  val run: ScanRunEntity,
  val snapshotId: String,
  internal val config: RepositoryConfigEntity,
  internal val remote: RemoteConfig,
  internal val sources: List<SourceRootEntity>,
  /** LOCAL_REFRESH only: the active snapshot whose remote side is reused. */
  internal val refreshFrom: SnapshotEntity?,
) {
  val mode: ScanMode
    get() = ScanMode.valueOf(run.mode)
}

sealed interface ScanOutcome {
  data class Published(val snapshotId: String) : ScanOutcome

  /** The run ended FAILED (FR-006); [message] is redacted, [action] is the recovery hint. */
  data class Failed(val code: CloudSyncErrorCode, val message: String, val action: String?) : ScanOutcome
}

/**
 * Lets a canceller reach the run's remote client: closing it unblocks socket I/O that coroutine
 * cancellation alone cannot interrupt (research R7). A client attached after [closeClient] is closed at once.
 */
class RunControl {
  @Volatile private var client: RemoteClient? = null
  @Volatile private var closed = false

  fun attach(client: RemoteClient) {
    this.client = client
    if (closed) client.close()
  }

  fun closeClient() {
    closed = true
    client?.close()
  }
}

/**
 * One scan end to end, in either mode (research R2), following the data-model state machine:
 *
 * - FULL: `CONNECTING` (config, credentials, `connect`, `discoverPrecision`) → `LISTING_REMOTE`
 *   ([RemoteWalker]) → the local phase.
 * - LOCAL_REFRESH: `COPYING_REMOTE` (`copyRemoteState`, [MatchIndex.fromRows]) → the local phase.
 * - Local phase, shared: `ENUMERATING_LOCAL` (enumerate, skip hidden subtrees, [Matcher] per file,
 *   `local_node` batches of [BATCH_SIZE]) → directory rows after [DirectoryRollup] → counts, `SOURCE`
 *   gaps and coverage → `PUBLISHING`.
 *
 * A connect error or [RootListingFailed] ends the run FAILED through `discardRun`. Cancellation is
 * not handled here: it propagates, and the owner ([ScanCoordinator]) discards the run.
 */
class ScanEngine(
  private val store: SnapshotStore,
  private val repositories: RepositoryConfigDao,
  private val sourceRoots: SourceRootDao,
  private val credentials: CredentialStore,
  private val clients: RemoteClientFactory,
  private val enumerator: LocalSourceEnumerator,
  private val walker: RemoteWalker = RemoteWalker(),
  private val clock: () -> Long = System::currentTimeMillis,
  private val newId: () -> String = { UUID.randomUUID().toString() },
  /** Called before each local file is matched: the debug-only e2e pause ([ScanPacing]), nothing in release. */
  private val perFilePause: suspend () -> Unit = {},
) {

  /**
   * Checks the start preconditions, then creates the run and stages its snapshot. Throws a
   * [ScanRefused] subclass, before any run exists, when a precondition fails.
   */
  suspend fun begin(mode: ScanMode): ScanTicket {
    val config = repositories.get() ?: throw RepositoryNotConfigured()
    if (RemoteProtocol.entries.none { it.name == config.protocol }) throw RepositoryNotConfigured()
    if (mode == ScanMode.FULL && !credentials.isCurrent(config.credentialVersion)) throw CredentialUnavailable()
    val sources = sourceRoots.all()
    if (sources.isEmpty()) throw NoSourcesSelected()
    val refreshFrom =
      if (mode == ScanMode.LOCAL_REFRESH) {
        val active = store.activeSnapshot()?.snapshotId?.let { store.snapshot(it) }
        if (active == null || !active.publishable || active.remoteListedAtMillis == null || active.configRevision != config.revision) {
          throw RefreshUnavailable()
        }
        active
      } else {
        null
      }

    val initial = if (mode == ScanMode.FULL) ScanPhase.CONNECTING else ScanPhase.COPYING_REMOTE
    val run = store.beginRun(newId(), mode.name, config.revision, initial.name, clock())
    val snapshotId = newId()
    try {
      store.stageSnapshot(
        SnapshotEntity(
          snapshotId = snapshotId,
          scanRunId = run.runId,
          completedAtMillis = null,
          coverage = COVERAGE_COMPLETE,
          configRevision = config.revision,
          includeHidden = false,
          publishable = false,
          remoteListedAtMillis = null,
        )
      )
    } catch (t: Throwable) {
      withContext(NonCancellable) {
        store.discardRun(run.runId, run.generation, TERMINAL_FAILED, CloudSyncErrorCode.INTERNAL_ERROR.name, null, clock())
      }
      throw t
    }
    // Every configured folder, in order; the protocol was checked above, so the config always exists.
    val remote = checkNotNull(config.toRemoteConfig())
    return ScanTicket(run, snapshotId, config, remote, sources, refreshFrom)
  }

  /** Runs [ticket] to `PUBLISHED` or `FAILED`. [progress] and [control] are the owner's live handles. */
  suspend fun execute(ticket: ScanTicket, progress: ScanProgress, control: RunControl): ScanOutcome {
    val remoteSide =
      try {
        when (ticket.mode) {
          ScanMode.FULL -> listRemote(ticket, progress, control)
          ScanMode.LOCAL_REFRESH -> copyRemote(ticket, progress)
        }
      } catch (e: RootListingFailed) {
        return fail(ticket, e.code, e.cause as? RemoteClientException)
      } catch (e: RemoteClientException) {
        return fail(ticket, e.code, e)
      }
    scanLocal(ticket, remoteSide, progress)

    progress.phase = ScanPhase.PUBLISHING.name
    store.publish(ticket.run.runId, ticket.run.generation, ticket.run.configRevision, TERMINAL_COMPLETED, clock())
    progress.phase = ScanPhase.PUBLISHED.name
    return ScanOutcome.Published(ticket.snapshotId)
  }

  /** What the local phase matches against, whichever mode produced it. */
  private class RemoteSide(val index: MatchIndex, val listing: ListingState)

  // --- FULL: CONNECTING, LISTING_REMOTE ---

  private suspend fun listRemote(ticket: ScanTicket, progress: ScanProgress, control: RunControl): RemoteSide {
    progress.phase = ScanPhase.CONNECTING.name
    val connect: suspend () -> RemoteClient = { connect(ticket, control) }
    val (walk, listedAt) =
      RemoteSession(connect(), connect).use { session ->
        val precision = session.client.discoverPrecision().precisionMillis
        repositories.updatePrecision(ticket.config.revision, precision)
        progress.phase = ScanPhase.LISTING_REMOTE.name
        val result =
          walker.walk(session, ticket.remote.rootPaths, precision) { listed ->
            progress.update {
              it.copy(remoteDirectoriesListed = listed.directoriesListed.toLong(), remoteFilesListed = listed.filesListed)
            }
          }
        result to clock()
      }
    for (batch in walk.index.toRows(ticket.snapshotId).chunked(BATCH_SIZE)) {
      currentCoroutineContext().ensureActive()
      store.stageMatchKeys(batch)
    }
    store.stageAmbiguities(walk.ambiguities.map { it.toEntity(ticket.snapshotId) })
    store.setRemoteListedAt(ticket.snapshotId, listedAt)
    return RemoteSide(walk.index, walk.listing)
  }

  /** A fresh, authenticated client; the password is loaded per attempt and wiped straight after. */
  private suspend fun connect(ticket: ScanTicket, control: RunControl): RemoteClient =
    connectRepository(clients, credentials, ticket.remote, ticket.config.credentialVersion, onCreated = control::attach)

  // --- LOCAL_REFRESH: COPYING_REMOTE ---

  private suspend fun copyRemote(ticket: ScanTicket, progress: ScanProgress): RemoteSide {
    progress.phase = ScanPhase.COPYING_REMOTE.name
    val from = checkNotNull(ticket.refreshFrom) { "LOCAL_REFRESH without a source snapshot" }
    store.copyRemoteState(from.snapshotId, ticket.snapshotId)
    val keys = store.matchKeys(ticket.snapshotId)
    val precision = keys.firstOrNull()?.precisionMillis ?: store.precisionOf(from.snapshotId) ?: fallbackPrecision(ticket)
    val gaps = store.ambiguities(ticket.snapshotId).filter { it.scope in REMOTE_SCOPES }
    val listing =
      gaps.firstOrNull()?.let { first ->
        ListingState.Incomplete(
          CloudSyncErrorCode.valueOf(first.reason),
          folderUnread = gaps.any { it.scope == RemoteAmbiguityEntity.SCOPE_REMOTE_FOLDER },
        )
      } ?: ListingState.Complete
    return RemoteSide(MatchIndex.fromRows(keys, precision), listing)
  }

  private fun fallbackPrecision(ticket: ScanTicket): Long =
    ticket.config.precisionMillis.takeIf { it > 0 } ?: FALLBACK_PRECISION_MILLIS

  // --- Shared local phase: ENUMERATING_LOCAL ---

  private class LocalAccumulator(val snapshotId: String, val precisionMillis: Long) {
    val rollup = DirectoryRollup()
    val directories = ArrayList<LocalNodeEntity>()
    val files = ArrayList<LocalNodeEntity>(BATCH_SIZE)
    val counts = LinkedHashMap<Pair<String?, FileStatus>, Long>()
    val sourceGaps = ArrayList<RemoteAmbiguityEntity>()
  }

  private suspend fun scanLocal(ticket: ScanTicket, remote: RemoteSide, progress: ScanProgress) {
    progress.phase = ScanPhase.ENUMERATING_LOCAL.name
    val acc = LocalAccumulator(ticket.snapshotId, remote.index.precisionMillis)
    for (source in ticket.sources) {
      currentCoroutineContext().ensureActive()
      try {
        when (val listing = enumerator.enumerate(source)) {
          is SourceListing.Skipped -> acc.sourceGaps += sourceGap(ticket.snapshotId, source, listing.reason.name)
          is SourceListing.Available -> {
            for (status in FileStatus.entries) acc.counts.putIfAbsent(source.sourceId to status, 0L)
            scanSource(source, listing.files, remote, acc, progress)
          }
        }
      } catch (e: SecurityException) {
        acc.sourceGaps += sourceGap(ticket.snapshotId, source, LOCAL_UNAVAILABLE)
      } catch (e: IllegalArgumentException) {
        acc.sourceGaps += sourceGap(ticket.snapshotId, source, LOCAL_UNAVAILABLE)
      } catch (e: IOException) {
        acc.sourceGaps += sourceGap(ticket.snapshotId, source, LOCAL_UNAVAILABLE)
      }
    }
    flushFiles(acc)

    val rolledUp = acc.rollup.finish()
    val directories = acc.directories.map { dir ->
      val (verdict, counts) = rolledUp.getValue(dir.entryId)
      dir.copy(
        status = verdict.status.name,
        issueCode = verdict.issueCode,
        descSynced = counts.synced,
        descUnsynced = counts.unsynced,
        descUnknown = counts.unknown,
      )
    }
    for (batch in directories.chunked(BATCH_SIZE)) {
      currentCoroutineContext().ensureActive()
      store.stageLocalNodes(batch)
    }
    store.stageAmbiguities(acc.sourceGaps)
    store.stageCounts(countRows(acc))
    val incomplete = remote.listing is ListingState.Incomplete || acc.sourceGaps.isNotEmpty()
    store.setCoverage(ticket.snapshotId, if (incomplete) COVERAGE_INCOMPLETE else COVERAGE_COMPLETE)
  }

  private suspend fun scanSource(
    source: SourceRootEntity,
    files: Sequence<LocalFile>,
    remote: RemoteSide,
    acc: LocalAccumulator,
    progress: ScanProgress,
  ) {
    val tree = Uri.parse(source.treeUri)
    val directoryIds = HashMap<String, String>()
    val hidden = HashSet<String>()
    for (file in files) {
      currentCoroutineContext().ensureActive()
      // Hidden entries and everything under them are not stored (research R8).
      if (file.isHidden || (file.parentDocumentId != null && file.parentDocumentId in hidden)) {
        if (file.isDirectory) hidden += file.documentId
        continue
      }
      val parentId =
        file.parentDocumentId?.let {
          checkNotNull(directoryIds[it]) { "the enumerator yielded a child before its directory" }
        }
      val entryId = newId()
      val base =
        LocalNodeEntity(
          entryId = entryId,
          snapshotId = acc.snapshotId,
          sourceId = source.sourceId,
          parentId = parentId,
          kind = KIND_FILE,
          documentUri = DocumentsContract.buildDocumentUriUsingTree(tree, file.documentId).toString(),
          documentId = file.documentId,
          name = file.name,
          mimeType = file.mimeType,
          sizeBytes = file.sizeBytes,
          modifiedUtcMillis = file.modifiedUtcMillis,
          precisionMillis = acc.precisionMillis,
          status = FileStatus.SYNCED.name,
          issueCode = null,
          // Every FILE and DIRECTORY row, FULL and LOCAL_REFRESH alike, so a refresh over a snapshot
          // migrated from schema 4 replaces its ASCII-only key (research R2).
          sortName = SortName.of(file.name),
        )
      if (file.isDirectory) {
        directoryIds[file.documentId] = entryId
        acc.rollup.registerDirectory(entryId, parentId)
        acc.directories += base.copy(kind = KIND_DIRECTORY, sizeBytes = null)
        progress.update { it.copy(localFilesEnumerated = it.localFilesEnumerated + 1) }
        continue
      }
      perFilePause()
      val verdict = Matcher.verdict(file, acc.precisionMillis, remote.index, remote.listing)
      acc.rollup.recordFile(parentId, verdict.status)
      acc.counts.merge(source.sourceId to verdict.status, 1L, Long::plus)
      acc.files += base.copy(status = verdict.status.name, issueCode = verdict.issueCode)
      if (acc.files.size >= BATCH_SIZE) flushFiles(acc)
      progress.update { it.copy(localFilesEnumerated = it.localFilesEnumerated + 1, localFilesMatched = it.localFilesMatched + 1) }
    }
  }

  private suspend fun flushFiles(acc: LocalAccumulator) {
    if (acc.files.isEmpty()) return
    store.stageLocalNodes(acc.files.toList())
    acc.files.clear()
  }

  /** One row per `(sourceId, status)` for each listed source, plus the `sourceId = null` totals. */
  private fun countRows(acc: LocalAccumulator): List<SnapshotCountsEntity> {
    val totals = FileStatus.entries.associateWith { status -> acc.counts.filterKeys { it.second == status }.values.sum() }
    val perSource = acc.counts.map { (key, count) -> SnapshotCountsEntity(0, acc.snapshotId, key.first, key.second.name, count) }
    return perSource + totals.map { (status, count) -> SnapshotCountsEntity(0, acc.snapshotId, null, status.name, count) }
  }

  private fun sourceGap(snapshotId: String, source: SourceRootEntity, reason: String) =
    RemoteAmbiguityEntity(
      id = 0,
      snapshotId = snapshotId,
      scope = RemoteAmbiguityEntity.SCOPE_SOURCE,
      sourceId = source.sourceId,
      entryId = null,
      matchKeyId = null,
      reason = reason,
    )

  // --- FAILED ---

  private suspend fun fail(ticket: ScanTicket, code: CloudSyncErrorCode, cause: RemoteClientException?): ScanOutcome {
    // A failure caused by a cancel (the client was closed under us) is a cancellation, not a FAILED run.
    currentCoroutineContext().ensureActive()
    val message = CloudSyncEnvelope.redact(cause?.message ?: code.name, ticket.remote.sensitiveValues)
    val action = cause?.action?.let { CloudSyncEnvelope.redact(it, ticket.remote.sensitiveValues) }
    withContext(NonCancellable) {
      store.discardRun(ticket.run.runId, ticket.run.generation, TERMINAL_FAILED, code.name, message, clock())
    }
    return ScanOutcome.Failed(code, message, action)
  }

  companion object {
    /** Rows per insert transaction (research R9). */
    const val BATCH_SIZE = 500

    /** Only when a refreshed snapshot has no rows at all to say which precision it used. */
    const val FALLBACK_PRECISION_MILLIS = 1_000L

    const val COVERAGE_COMPLETE = "COMPLETE"
    const val COVERAGE_INCOMPLETE = "INCOMPLETE"
    const val TERMINAL_COMPLETED = "COMPLETED"
    const val TERMINAL_FAILED = "FAILED"
    const val KIND_FILE = "FILE"
    const val KIND_DIRECTORY = "DIRECTORY"

    private val LOCAL_UNAVAILABLE = FileIssueCode.LOCAL_UNAVAILABLE.name
    private val REMOTE_SCOPES =
      setOf(
        RemoteAmbiguityEntity.SCOPE_REMOTE_DIRECTORY,
        RemoteAmbiguityEntity.SCOPE_REMOTE_LISTING,
        RemoteAmbiguityEntity.SCOPE_REMOTE_FOLDER,
      )
  }
}
