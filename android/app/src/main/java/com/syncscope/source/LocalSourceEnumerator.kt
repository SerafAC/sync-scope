package com.syncscope.source

import android.content.ContentResolver
import android.database.Cursor
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import com.syncscope.persistence.SourceRootEntity

/**
 * Lists the files of one source for the scan (research R8, data-model "LocalFile and
 * SourceListing"). Native only; provided to feature 004.
 */
interface LocalSourceEnumerator {
  fun enumerate(source: SourceRootEntity): SourceListing
}

/** An unavailable source is always [Skipped], never [Available] with an empty sequence (FR-003). */
sealed interface SourceListing {
  data class Available(val files: Sequence<LocalFile>) : SourceListing

  /** [reason] is [SourceAvailability.GRANT_REVOKED] or [SourceAvailability.STORAGE_MISSING]. */
  data class Skipped(val reason: SourceAvailability) : SourceListing
}

data class LocalFile(
  /** SAF document ID, stable within the source. */
  val documentId: String,
  /** Null for direct children of the source root. */
  val parentDocumentId: String?,
  val name: String,
  val isDirectory: Boolean,
  /** The name starts with `.`. Hidden entries are returned; filtering belongs to `setIncludeHidden`. */
  val isHidden: Boolean,
  val mimeType: String?,
  /** Null for directories. */
  val sizeBytes: Long?,
  /** `COLUMN_LAST_MODIFIED`; null when the provider reports 0 or nothing. */
  val modifiedUtcMillis: Long?,
)

/**
 * Production [LocalSourceEnumerator]: a lazy breadth-first walk with one
 * `buildChildDocumentsUriUsingTree` query per directory and an explicit projection, never one
 * query per property. Each directory's rows are read and its cursor closed before they are
 * yielded, so abandoning the sequence leaks nothing.
 */
class DocumentsContractSourceEnumerator(
  private val saf: SafAccess,
  private val resolver: ContentResolver,
) : LocalSourceEnumerator {

  override fun enumerate(source: SourceRootEntity): SourceListing {
    val availability = SourceAvailability.of(source, saf)
    if (availability != SourceAvailability.AVAILABLE) return SourceListing.Skipped(availability)
    val tree = Uri.parse(source.treeUri)
    return SourceListing.Available(walk(tree, DocumentsContract.getTreeDocumentId(tree)))
  }

  private fun walk(tree: Uri, rootDocumentId: String): Sequence<LocalFile> = sequence {
    val pending = ArrayDeque<String>().apply { add(rootDocumentId) }
    while (pending.isNotEmpty()) {
      val directory = pending.removeFirst()
      val parent = directory.takeUnless { it == rootDocumentId }
      for (file in children(tree, directory, parent)) {
        yield(file)
        if (file.isDirectory) pending.addLast(file.documentId)
      }
    }
  }

  private fun children(tree: Uri, directory: String, parent: String?): List<LocalFile> {
    val uri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, directory)
    return resolver.query(uri, PROJECTION, null, null, null)?.use { cursor ->
      buildList { while (cursor.moveToNext()) add(cursor.toLocalFile(parent)) }
    } ?: emptyList()
  }

  private fun Cursor.toLocalFile(parent: String?): LocalFile {
    val name = getString(NAME) ?: ""
    val mimeType = if (isNull(MIME)) null else getString(MIME)
    val isDirectory = mimeType == Document.MIME_TYPE_DIR
    return LocalFile(
      documentId = getString(ID),
      parentDocumentId = parent,
      name = name,
      isDirectory = isDirectory,
      isHidden = name.startsWith("."),
      mimeType = mimeType,
      sizeBytes = if (isDirectory || isNull(SIZE)) null else getLong(SIZE),
      modifiedUtcMillis = if (isNull(MODIFIED)) null else getLong(MODIFIED).takeIf { it != 0L },
    )
  }

  private companion object {
    val PROJECTION =
      arrayOf(
        Document.COLUMN_DOCUMENT_ID,
        Document.COLUMN_DISPLAY_NAME,
        Document.COLUMN_MIME_TYPE,
        Document.COLUMN_SIZE,
        Document.COLUMN_LAST_MODIFIED,
      )
    const val ID = 0
    const val NAME = 1
    const val MIME = 2
    const val SIZE = 3
    const val MODIFIED = 4
  }
}
