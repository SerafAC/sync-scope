package com.syncscope.bridge

import android.util.Log
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.syncscope.codegen.NativeCloudSyncSpec
import com.syncscope.credential.CredentialStore
import com.syncscope.image.ContentResolverThumbnailSource
import com.syncscope.image.LocalImageStore
import com.syncscope.persistence.RepositoryConfigDao
import com.syncscope.persistence.SnapshotStore
import com.syncscope.persistence.SourceRootDao
import com.syncscope.persistence.SyncScopeDatabase
import com.syncscope.remote.HostKeyTrustStore
import com.syncscope.remote.RemoteClientFactory
import com.syncscope.remote.RemoteClientException
import com.syncscope.scan.ScanCoordinator
import com.syncscope.scan.ScanEngine
import com.syncscope.scan.ScanPacing
import com.syncscope.source.ContentResolverSafAccess
import com.syncscope.source.DocumentsContractSourceEnumerator
import com.syncscope.source.LocalSourceEnumerator
import com.syncscope.source.SafAccess
import com.syncscope.source.SourceOperations
import com.syncscope.source.SourcePicker
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * The single CloudSync TurboModule: the entire JS-to-native API.
 *
 * Every method resolves a versioned envelope and never rejects: all work runs
 * on a background dispatcher, and any throwable is converted into a redacted
 * INTERNAL_ERROR envelope so no Kotlin exception ever reaches JS.
 *
 * Repository methods delegate to [RepositoryOperations]; `listSources`, `launchSourcePicker` and
 * `removeSource` delegate to [SourceOperations] and [SourcePicker], whose activity results arrive
 * through an `ActivityEventListener` registered here for the module's lifetime.
 * `startScan`, `cancelScan`, `getScanState`, `queryFiles` and `queryTreeChildren` delegate to
 * [ScanOperations] over one [ScanCoordinator] running on this module's scope; a
 * `LifecycleEventListener` cancels an active run when the host pauses (FR-001).
 * `getLocalImageHandle` delegates to [ScanOperations] over one shared [LocalImageStore], whose
 * dispatcher caps concurrent decodes at four.
 * Methods not yet built (`getSettings`, `setIncludeHidden`, `listSelectableEntries`,
 * `prepareLocalDeletion`, `executeLocalDeletion`) resolve a typed NOT_IMPLEMENTED envelope.
 */
class CloudSyncModule(
  reactContext: ReactApplicationContext,
  dispatcher: CoroutineDispatcher = Dispatchers.IO,
  private val envelope: CloudSyncEnvelope = CloudSyncEnvelope(),
  hostKeyTrust: () -> HostKeyTrustStore = { HostKeyTrustStore.shared(reactContext) },
  repositoryConfig: () -> RepositoryConfigDao = { SyncScopeDatabase.get(reactContext).repositoryConfigDao() },
  credentialStore: () -> CredentialStore = { CredentialStore.shared(reactContext) },
  remoteClients: RemoteClientFactory? = null,
  safAccess: () -> SafAccess = { ContentResolverSafAccess(reactContext) },
  sourceRoots: () -> SourceRootDao = { SyncScopeDatabase.get(reactContext).sourceRootDao() },
  snapshotStore: () -> SnapshotStore = { SnapshotStore(SyncScopeDatabase.get(reactContext)) },
  localSources: () -> LocalSourceEnumerator = {
    DocumentsContractSourceEnumerator(safAccess(), reactContext.contentResolver)
  },
  localImages: () -> LocalImageStore = {
    LocalImageStore(reactContext.cacheDir, ContentResolverThumbnailSource(reactContext.contentResolver))
  },
) : NativeCloudSyncSpec(reactContext) {

  private val scope = CoroutineScope(SupervisorJob() + dispatcher)

  /** Resolved on first use, on the background dispatcher, so the database never opens on the UI thread. */
  private val hostKeys by lazy(hostKeyTrust)

  private val repositoryDao = memoize(repositoryConfig)
  private val credentials = memoize(credentialStore)
  private val sourceRootDao = memoize(sourceRoots)
  private val store = memoize(snapshotStore)

  private val repositories =
    RepositoryOperations(
      repositories = repositoryDao,
      credentials = credentials,
      hostKeys = { hostKeys },
      clients = { remoteClients ?: defaultClients },
      envelope = envelope,
    )

  private val defaultClients by lazy { RemoteClientFactory.default { hostKeys } }

  private val sources = SourceOperations(saf = memoize(safAccess), sources = sourceRootDao, envelope = envelope)

  private val picker = SourcePicker(sources, envelope) { reactContext.currentActivity }

  /** Built on first scan call (on the background dispatcher), so the database never opens on the UI thread. */
  private val coordinatorHolder = lazy {
    val engine =
      ScanEngine(
        store = store(),
        repositories = repositoryDao(),
        sourceRoots = sourceRootDao(),
        credentials = credentials(),
        clients = remoteClients ?: defaultClients,
        enumerator = localSources(),
        perFilePause = ScanPacing.pause(reactContext),
      )
    ScanCoordinator(engine, store(), scope)
  }

  private val scans =
    ScanOperations(
      coordinator = { coordinatorHolder.value },
      store = store,
      sources = sourceRootDao,
      repositories = repositoryDao,
      envelope = envelope,
      images = memoize(localImages),
    )

  /** Leaving the foreground cancels an active run as BACKGROUNDED; a coordinator never built has no run. */
  private val hostLifecycle =
    object : LifecycleEventListener {
      override fun onHostResume() = Unit

      override fun onHostPause() {
        if (coordinatorHolder.isInitialized()) coordinatorHolder.value.onHostPause()
      }

      override fun onHostDestroy() = Unit
    }

  init {
    reactContext.addActivityEventListener(picker)
    reactContext.addLifecycleEventListener(hostLifecycle)
  }

  override fun getName(): String = NAME

  override fun invalidate() {
    reactApplicationContext.removeActivityEventListener(picker)
    reactApplicationContext.removeLifecycleEventListener(hostLifecycle)
    scope.cancel()
    super.invalidate()
  }

  override fun getContractVersion(promise: Promise) {
    // Resolves a bare number per the spec; there is no envelope to fall back to.
    scope.launch { promise.resolve(CloudSyncContracts.CONTRACT_VERSION) }
  }

  override fun queryFiles(
    snapshotId: String,
    querySpec: ReadableMap,
    pageToken: String?,
    promise: Promise,
  ) = runPage("queryFiles", promise) { scans.queryFiles(snapshotId, querySpec, pageToken) }

  override fun queryTreeChildren(
    snapshotId: String,
    parentId: String?,
    querySpec: ReadableMap,
    pageToken: String?,
    promise: Promise,
  ) = runPage("queryTreeChildren", promise) { scans.queryTreeChildren(snapshotId, parentId, querySpec, pageToken) }

  override fun getRepositorySummary(promise: Promise) =
    runOperation("getRepositorySummary", promise) { repositories.summary() }

  override fun saveRepository(config: ReadableMap, transientPassword: String?, promise: Promise) =
    runOperation("saveRepository", promise) { repositories.save(config, transientPassword) }

  override fun testRepository(promise: Promise) =
    runOperation("testRepository", promise) { repositories.test() }

  override fun approveSftpHostKey(challengeId: String, promise: Promise) =
    runOperation("approveSftpHostKey", promise) {
      hostKeys.approve(challengeId)
      envelope.ok()
    }

  override fun rejectSftpHostKey(challengeId: String, promise: Promise) =
    runOperation("rejectSftpHostKey", promise) {
      hostKeys.reject(challengeId)
      envelope.ok()
    }

  override fun listSources(promise: Promise) = runOperation("listSources", promise) { sources.list() }

  /** Resolves when the picker closes; SOURCE_NOT_FOUND for an unknown [regrantSourceId] is decided first. */
  override fun launchSourcePicker(regrantSourceId: String?, promise: Promise) =
    runOperation("launchSourcePicker", promise) { picker.launch(regrantSourceId) }

  override fun removeSource(sourceId: String, promise: Promise) =
    runOperation("removeSource", promise) { sources.remove(sourceId) }

  override fun getSettings(promise: Promise) = notImplemented("getSettings", promise)

  override fun setIncludeHidden(includeHidden: Boolean, promise: Promise) =
    notImplemented("setIncludeHidden", promise)

  override fun startScan(mode: String?, promise: Promise) =
    runOperation("startScan", promise) { scans.start(mode) }

  override fun cancelScan(runId: String, promise: Promise) =
    runOperation("cancelScan", promise) { scans.cancel(runId) }

  override fun getScanState(promise: Promise) = runOperation("getScanState", promise) { scans.state() }

  override fun getLocalImageHandle(
    snapshotId: String,
    entryId: String,
    spec: ReadableMap,
    promise: Promise,
  ) = runOperation("getLocalImageHandle", promise) { scans.imageHandle(snapshotId, entryId, spec) }

  override fun listSelectableEntries(snapshotId: String, querySpec: ReadableMap, promise: Promise) =
    notImplemented("listSelectableEntries", promise)

  override fun prepareLocalDeletion(snapshotId: String, entryIds: ReadableArray, promise: Promise) =
    notImplemented("prepareLocalDeletion", promise)

  override fun executeLocalDeletion(planToken: String, includeUnsynced: Boolean, promise: Promise) =
    notImplemented("executeLocalDeletion", promise)

  private fun notImplemented(method: String, promise: Promise) =
    runOperation(method, promise) { envelope.notImplemented(method) }

  /**
   * Resolves an `OperationResultDto`; a [RemoteClientException] keeps its code, any other
   * throwable becomes an INTERNAL_ERROR envelope.
   */
  internal fun runOperation(method: String, promise: Promise, block: suspend () -> Any?) =
    run(method, promise, page = false, block)

  /** Resolves a `FilePageResultDto`; a throwable becomes a page-shaped INTERNAL_ERROR envelope. */
  internal fun runPage(method: String, promise: Promise, block: suspend () -> Any?) =
    run(method, promise, page = true, block)

  private fun run(method: String, promise: Promise, page: Boolean, block: suspend () -> Any?) {
    scope.launch {
      val result =
        try {
          block()
        } catch (e: RemoteClientException) {
          Log.w(TAG, "$method failed: ${e.code} reply=${e.replyCode}")
          envelope.remoteFailure(e, page)
        } catch (t: Throwable) {
          Log.e(TAG, "$method failed: ${CloudSyncEnvelope.redact(t.toString())}")
          envelope.internalError(t, page)
        }
      promise.resolve(result)
    }
  }

  companion object {
    private fun <T> memoize(factory: () -> T): () -> T {
      val value by lazy(factory)
      return { value }
    }

    const val NAME = CloudSyncContracts.MODULE_NAME
    private const val TAG = "CloudSync"
  }
}
