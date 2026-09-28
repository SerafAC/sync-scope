package com.syncscope.source

import android.net.Uri
import android.provider.DocumentsContract
import android.util.Log
import com.facebook.react.bridge.WritableMap
import com.syncscope.bridge.CloudSyncEnvelope
import com.syncscope.bridge.CloudSyncErrorCode
import com.syncscope.bridge.ConflictingSource
import com.syncscope.persistence.SourceRootDao
import com.syncscope.persistence.SourceRootEntity
import java.util.UUID
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * listSources / launchSourcePicker (the pick result) / removeSource, resolved as envelopes
 * (contracts/cloudsync-sources.md "Behaviour").
 *
 * Validation (data-model "Validation rules"): an add checks V1 (provider) then V2 (no overlap);
 * a re-grant checks V1 then V3 (same `canonicalRoot`) and never V2. A rejected pick persists
 * nothing and releases the grant just taken, unless that URI is an existing source's own grant.
 * Picks and removals are serialised so the overlap check and the insert cannot interleave.
 * `treeUri` and `canonicalRoot` never leave this class.
 */
class SourceOperations(
  private val saf: () -> SafAccess,
  private val sources: () -> SourceRootDao,
  private val envelope: CloudSyncEnvelope,
  private val clock: () -> Long = System::currentTimeMillis,
  private val newId: () -> String = { UUID.randomUUID().toString() },
) {
  private val lock = Mutex()

  /** Every source, oldest first, with availability computed now (one grant lookup per call). */
  suspend fun list(): WritableMap {
    val access = saf()
    val rows = sources().all()
    val grants = access.persistedGrants()
    val labels = HashMap<String, String>()
    val array = envelope.emptyArray()
    for (row in rows) {
      val label = labels.getOrPut(row.volumeId) { access.volumeLabel(row.volumeId) }
      array.pushMap(dto(row, SourceAvailability.of(row, grants, access), label))
    }
    return envelope.ok().apply { putArray("sources", array) }
  }

  /** The tree URI a re-grant of [sourceId] opens the picker at, or null for an unknown source. */
  suspend fun regrantTarget(sourceId: String): String? = sources().byId(sourceId)?.treeUri

  /** The picker was closed without a pick: nothing is persisted. */
  fun cancelled(): WritableMap = pickerOk(OUTCOME_CANCELLED, null)

  /** Handles a folder the picker returned; [regrantSourceId] names the source being re-granted. */
  suspend fun onPicked(treeUri: String, regrantSourceId: String?): WritableMap =
    lock.withLock {
      val access = saf()
      val dao = sources()
      val tree = parse(treeUri)
      val grant =
        try {
          access.takeGrant(treeUri)
        } catch (e: SecurityException) {
          // A provider we do not support may not offer a persistable grant at all.
          if (tree == null || !tree.isSupported) return@withLock envelope.sourceError(CloudSyncErrorCode.SOURCE_UNSUPPORTED)
          throw e
        }
      val existing = dao.all()

      fun reject(code: CloudSyncErrorCode, conflict: SourceRootEntity? = null): WritableMap {
        if (existing.none { it.treeUri == treeUri }) access.releaseGrant(treeUri)
        Log.i(TAG, "source pick rejected: ${code.name}")
        return envelope.sourceError(code, conflict?.let { ConflictingSource(it.sourceId, it.alias) })
      }

      val target =
        if (regrantSourceId == null) null
        else existing.firstOrNull { it.sourceId == regrantSourceId } ?: return@withLock reject(CloudSyncErrorCode.SOURCE_NOT_FOUND)

      // V1
      if (tree == null || !tree.isSupported) return@withLock reject(CloudSyncErrorCode.SOURCE_UNSUPPORTED)

      if (target != null) {
        // V3 (never V2: the target row already passed it when it was added)
        if (tree.canonicalRoot != target.canonicalRoot) {
          return@withLock reject(CloudSyncErrorCode.SOURCE_REGRANT_MISMATCH)
        }
        val updated = target.copy(treeUri = treeUri, canWrite = grant.canWrite)
        dao.update(updated)
        if (target.treeUri != treeUri) access.releaseGrant(target.treeUri)
        Log.i(TAG, "source re-granted: canWrite=${grant.canWrite}")
        return@withLock pickerOk(OUTCOME_REGRANTED, dto(updated, SourceAvailability.of(updated, access), access))
      }

      // V2: the first conflicting row, in list order.
      existing.firstOrNull { SourceTree.overlaps(it.tree(), tree) }?.let {
        return@withLock reject(CloudSyncErrorCode.SOURCE_OVERLAP, it)
      }

      val label = access.volumeLabel(tree.volumeId)
      val row =
        SourceRootEntity(
          sourceId = newId(),
          treeUri = treeUri,
          authority = tree.authority,
          volumeId = tree.volumeId,
          documentPath = tree.documentPath,
          canonicalRoot = tree.canonicalRoot,
          // V4: generated once, unique case-insensitively among current rows.
          alias = SourceAlias.generate(AliasCandidate(tree.volumeId, label, tree.documentPath), existing.map { it.alias }),
          canWrite = grant.canWrite,
          addedAtMillis = clock(),
        )
      dao.insert(row)
      Log.i(TAG, "source added: removable=${row.volumeId != PRIMARY} canWrite=${row.canWrite}")
      pickerOk(OUTCOME_ADDED, dto(row, SourceAvailability.of(row, access), label))
    }

  /** Deletes the source and its scan data in one transaction, then releases its grant (R7). */
  suspend fun remove(sourceId: String): WritableMap =
    lock.withLock {
      val dao = sources()
      val row = dao.byId(sourceId) ?: return@withLock envelope.sourceError(CloudSyncErrorCode.SOURCE_NOT_FOUND)
      dao.deleteWithScanData(sourceId)
      // After the commit: a crash in between leaves at worst an unused grant, never a row without one.
      saf().releaseGrant(row.treeUri)
      Log.i(TAG, "source removed")
      envelope.ok()
    }

  private fun pickerOk(outcome: String, source: WritableMap?): WritableMap =
    envelope.ok().apply {
      putString("outcome", outcome)
      if (source == null) putNull("source") else putMap("source", source)
    }

  private fun dto(row: SourceRootEntity, availability: SourceAvailability, access: SafAccess): WritableMap =
    dto(row, availability, access.volumeLabel(row.volumeId))

  /** SourceDto (data-model "SourceDto"): never carries `treeUri` or `canonicalRoot`. */
  private fun dto(row: SourceRootEntity, availability: SourceAvailability, volumeLabel: String): WritableMap =
    envelope.map().apply {
      putString("sourceId", row.sourceId)
      putString("alias", row.alias)
      putString("volumeLabel", volumeLabel)
      putString("displayPath", row.documentPath)
      putBoolean("isRemovable", row.volumeId != PRIMARY)
      putBoolean("canWrite", row.canWrite)
      putDouble("addedAtMillis", row.addedAtMillis.toDouble())
      putString("availability", availability.name)
    }

  private fun SourceRootEntity.tree(): SourceTree = SourceTree(authority, volumeId, documentPath)

  /** The picked tree's identity, or null when the URI is not a document tree URI. */
  private fun parse(treeUri: String): SourceTree? =
    try {
      val uri = Uri.parse(treeUri)
      val authority = uri.authority ?: return null
      SourceTree.parse(authority, DocumentsContract.getTreeDocumentId(uri))
    } catch (_: IllegalArgumentException) {
      null
    }

  companion object {
    const val OUTCOME_ADDED = "ADDED"
    const val OUTCOME_REGRANTED = "REGRANTED"
    const val OUTCOME_CANCELLED = "CANCELLED"

    private const val PRIMARY = ContentResolverSafAccess.PRIMARY_VOLUME_ID
    private const val TAG = "CloudSync"
  }
}
