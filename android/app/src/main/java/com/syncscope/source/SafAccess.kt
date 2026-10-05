package com.syncscope.source

import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.os.storage.StorageManager
import android.provider.DocumentsContract
import java.io.FileNotFoundException

/** A persisted SAF permission on one tree URI, as `ContentResolver.persistedUriPermissions` reports it. */
data class PersistedGrant(val uri: String, val canRead: Boolean, val canWrite: Boolean)

/**
 * A document's current size and modified time, read the same way the enumerator reads them: `null`
 * size for a provider that reports none, `null` time for 0 or nothing.
 */
data class DocumentStat(val sizeBytes: Long?, val modifiedUtcMillis: Long?)

/** The outcome of one `DocumentsContract.deleteDocument` call (research R13). */
enum class DeleteResult {
  /** The provider deleted the document. */
  DELETED,

  /** The provider reported the document missing ([FileNotFoundException]). */
  NOT_FOUND,

  /** The provider refused the deletion ([SecurityException]): the grant no longer allows it. */
  DENIED,

  /** Any other failure, including `deleteDocument` returning `false`. */
  FAILED,
}

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

  /**
   * The current size and modified time of [documentUri]; `null` when the document is absent (no row,
   * no cursor, or [FileNotFoundException], also when the provider's tree check wraps it in an
   * [IllegalArgumentException]). A [SecurityException] propagates, so a lost grant is never mistaken
   * for an absent file.
   */
  fun stat(documentUri: String): DocumentStat?

  /** Deletes [documentUri] through `DocumentsContract.deleteDocument`; never throws. */
  fun delete(documentUri: String): DeleteResult
}

/** Production [SafAccess]: a thin wrapper over [ContentResolver] and [StorageManager]. */
class ContentResolverSafAccess(
  private val context: Context,
  private val resolver: ContentResolver = context.contentResolver,
  private val storageManager: StorageManager = context.getSystemService(StorageManager::class.java),
  private val deleteDocument: (ContentResolver, Uri) -> Boolean = DocumentsContract::deleteDocument,
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

  override fun stat(documentUri: String): DocumentStat? =
    try {
      resolver.query(Uri.parse(documentUri), STAT_PROJECTION, null, null, null)?.use { cursor ->
        if (!cursor.moveToFirst()) {
          null
        } else {
          DocumentStat(
            sizeBytes = if (cursor.isNull(STAT_SIZE)) null else cursor.getLong(STAT_SIZE),
            modifiedUtcMillis = if (cursor.isNull(STAT_MODIFIED)) null else cursor.getLong(STAT_MODIFIED).takeIf { it != 0L },
          )
        }
      }
    } catch (_: FileNotFoundException) {
      null
    } catch (e: IllegalArgumentException) {
      // Through a tree URI, DocumentsProvider.enforceTree asks ExternalStorageProvider.isChildDocument,
      // which rethrows a missing file's FileNotFoundException as this exception; only its message
      // crosses Binder. Any other IllegalArgumentException still propagates.
      if (e.message?.contains(FileNotFoundException::class.java.name) == true) null else throw e
    }

  override fun delete(documentUri: String): DeleteResult =
    try {
      if (deleteDocument(resolver, Uri.parse(documentUri))) DeleteResult.DELETED else DeleteResult.FAILED
    } catch (_: FileNotFoundException) {
      DeleteResult.NOT_FOUND
    } catch (_: SecurityException) {
      DeleteResult.DENIED
    } catch (_: Exception) {
      DeleteResult.FAILED
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
    private val STAT_PROJECTION =
      arrayOf(DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED)
    private const val STAT_SIZE = 0
    private const val STAT_MODIFIED = 1
  }
}
