package com.syncscope.source

import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.os.storage.StorageManager
import android.provider.DocumentsContract

/** A persisted SAF permission on one tree URI, as `ContentResolver.persistedUriPermissions` reports it. */
data class PersistedGrant(val uri: String, val canRead: Boolean, val canWrite: Boolean)

/**
 * The Android calls the source logic needs (research R9). `SourceOperations` and the local enumerator
 * take this as a constructor parameter so JVM tests can inject a fake instead of depending on device
 * state. URIs are passed as strings, exactly as stored in `source_root.treeUri`.
 */
interface SafAccess {
  /** Every persisted URI permission this app holds. */
  fun persistedGrants(): List<PersistedGrant>

  /**
   * Persists the permission the picker granted on [uri]: read and write when write was granted,
   * read only otherwise. Throws [SecurityException] when not even read can be persisted.
   */
  fun takeGrant(uri: String): PersistedGrant

  /** Releases the persisted permission on [uri]. A grant that is already gone is not an error. */
  fun releaseGrant(uri: String)

  /** Whether the tree's root document can be queried and returns a row (R5 `STORAGE_MISSING` check). */
  fun rootExists(uri: String): Boolean

  /** The user-facing name of a storage volume, or [ContentResolverSafAccess.UNMOUNTED_VOLUME_LABEL]. */
  fun volumeLabel(volumeId: String): String
}

/** Production [SafAccess]: a thin wrapper over [ContentResolver] and [StorageManager]. */
class ContentResolverSafAccess(
  private val context: Context,
  private val resolver: ContentResolver = context.contentResolver,
  private val storageManager: StorageManager = context.getSystemService(StorageManager::class.java),
) : SafAccess {

  override fun persistedGrants(): List<PersistedGrant> =
    resolver.persistedUriPermissions.map {
      PersistedGrant(it.uri.toString(), canRead = it.isReadPermission, canWrite = it.isWritePermission)
    }

  override fun takeGrant(uri: String): PersistedGrant {
    val parsed = Uri.parse(uri)
    return try {
      resolver.takePersistableUriPermission(parsed, READ or WRITE)
      PersistedGrant(uri, canRead = true, canWrite = true)
    } catch (_: SecurityException) {
      resolver.takePersistableUriPermission(parsed, READ)
      PersistedGrant(uri, canRead = true, canWrite = false)
    }
  }

  override fun releaseGrant(uri: String) {
    val parsed = Uri.parse(uri)
    val held = resolver.persistedUriPermissions.firstOrNull { it.uri == parsed }
    val flags =
      if (held == null) READ or WRITE
      else (if (held.isReadPermission) READ else 0) or (if (held.isWritePermission) WRITE else 0)
    try {
      resolver.releasePersistableUriPermission(parsed, flags)
    } catch (_: SecurityException) {
      // The grant may already be gone (revoked, or the source was unavailable); nothing to release.
    }
  }

  override fun rootExists(uri: String): Boolean =
    try {
      val tree = Uri.parse(uri)
      val root = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
      resolver.query(root, ROOT_PROJECTION, null, null, null)?.use { it.moveToFirst() } ?: false
    } catch (_: Exception) {
      // Unmounted volume, removed card, deleted folder or revoked grant: the root is not reachable.
      false
    }

  override fun volumeLabel(volumeId: String): String {
    val volume =
      storageManager.storageVolumes.firstOrNull {
        if (volumeId == PRIMARY_VOLUME_ID) it.isPrimary else it.uuid.equals(volumeId, ignoreCase = true)
      }
    val mounted =
      volume?.state == Environment.MEDIA_MOUNTED || volume?.state == Environment.MEDIA_MOUNTED_READ_ONLY
    return if (volume != null && mounted) volume.getDescription(context) else UNMOUNTED_VOLUME_LABEL
  }

  companion object {
    const val PRIMARY_VOLUME_ID = "primary"
    const val UNMOUNTED_VOLUME_LABEL = "Removable storage"

    private const val READ = Intent.FLAG_GRANT_READ_URI_PERMISSION
    private const val WRITE = Intent.FLAG_GRANT_WRITE_URI_PERMISSION
    private val ROOT_PROJECTION = arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
  }
}
