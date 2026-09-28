package com.syncscope.source

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import androidx.test.core.app.ApplicationProvider
import com.syncscope.persistence.SourceRootEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class LocalSourceEnumeratorTest {

  private val saf = FakeSafAccess()
  private lateinit var provider: FakeTreeProvider
  private lateinit var enumerator: LocalSourceEnumerator

  private val root = "primary:DCIM"
  private val source =
    SourceRootEntity(
      sourceId = "src",
      treeUri = treeUri(root),
      authority = SourceTree.EXTERNAL_STORAGE_AUTHORITY,
      volumeId = "primary",
      documentPath = "DCIM",
      canonicalRoot = "${SourceTree.EXTERNAL_STORAGE_AUTHORITY}/primary:DCIM",
      alias = "DCIM",
      canWrite = true,
      addedAtMillis = 1L,
    )

  @Before
  fun setUp() {
    provider = Robolectric.setupContentProvider(FakeTreeProvider::class.java, SourceTree.EXTERNAL_STORAGE_AUTHORITY)
    provider.children[root] =
      listOf(
        row("$root/Camera", "Camera", Document.MIME_TYPE_DIR, size = 4096L, modified = 5L),
        row("$root/.thumbs.db", ".thumbs.db", "application/octet-stream", size = 10L, modified = 0L),
        row("$root/a.jpg", "a.jpg", "image/jpeg", size = 20L, modified = 1_234L),
      )
    provider.children["$root/Camera"] =
      listOf(
        row("$root/Camera/Nested", "Nested", Document.MIME_TYPE_DIR, size = null, modified = null),
        row("$root/Camera/b.jpg", "b.jpg", null, size = 30L, modified = 2_000L),
      )
    provider.children["$root/Camera/Nested"] = listOf(row("$root/Camera/Nested/c.jpg", "c.jpg", "image/jpeg", 40L, 3_000L))
    enumerator = DocumentsContractSourceEnumerator(saf, ApplicationProvider.getApplicationContext<Context>().contentResolver)
  }

  @Test
  fun aSourceWithoutAGrantIsSkippedNeverEmpty() {
    val listing = enumerator.enumerate(source)

    assertEquals(SourceListing.Skipped(SourceAvailability.GRANT_REVOKED), listing)
    assertTrue(provider.queries.isEmpty())
  }

  @Test
  fun aSourceWhoseStorageIsMissingIsSkippedNeverEmpty() {
    saf.hold(source.treeUri)
    saf.missingRoots += source.treeUri

    val listing = enumerator.enumerate(source)

    assertEquals(SourceListing.Skipped(SourceAvailability.STORAGE_MISSING), listing)
    assertTrue(provider.queries.isEmpty())
  }

  @Test
  fun anAvailableSourceYieldsEveryEntryBreadthFirst() {
    saf.hold(source.treeUri)

    val files = (enumerator.enumerate(source) as SourceListing.Available).files.toList()

    assertEquals(
      listOf(
        LocalFile("$root/Camera", null, "Camera", isDirectory = true, isHidden = false, Document.MIME_TYPE_DIR, null, 5L),
        LocalFile("$root/.thumbs.db", null, ".thumbs.db", false, isHidden = true, "application/octet-stream", 10L, null),
        LocalFile("$root/a.jpg", null, "a.jpg", false, false, "image/jpeg", 20L, 1_234L),
        LocalFile("$root/Camera/Nested", "$root/Camera", "Nested", true, false, Document.MIME_TYPE_DIR, null, null),
        LocalFile("$root/Camera/b.jpg", "$root/Camera", "b.jpg", false, false, null, 30L, 2_000L),
        LocalFile("$root/Camera/Nested/c.jpg", "$root/Camera/Nested", "c.jpg", false, false, "image/jpeg", 40L, 3_000L),
      ),
      files,
    )
  }

  @Test
  fun oneChildQueryPerDirectoryWithAnExplicitProjection() {
    saf.hold(source.treeUri)

    (enumerator.enumerate(source) as SourceListing.Available).files.toList()

    assertEquals(listOf(root, "$root/Camera", "$root/Camera/Nested"), provider.queries.map { it.first })
    for ((_, projection) in provider.queries) {
      assertTrue(projection != null && projection.isNotEmpty())
    }
  }

  @Test
  fun theWalkIsLazy() {
    saf.hold(source.treeUri)

    val listing = enumerator.enumerate(source) as SourceListing.Available
    assertTrue(provider.queries.isEmpty())

    listing.files.first()
    assertEquals(listOf(root), provider.queries.map { it.first })
  }

  private fun row(id: String, name: String, mime: String?, size: Long?, modified: Long?): Array<Any?> =
    arrayOf(id, name, mime, size, modified)
}

/** A documents provider over an in-memory tree; records each child query and its projection. */
class FakeTreeProvider : ContentProvider() {
  /** Rows per parent document ID, in [COLUMNS] order. */
  val children = mutableMapOf<String, List<Array<Any?>>>()
  val queries = mutableListOf<Pair<String, List<String>?>>()

  override fun onCreate(): Boolean = true

  override fun query(
    uri: Uri,
    projection: Array<out String>?,
    selection: String?,
    selectionArgs: Array<out String>?,
    sortOrder: String?,
  ): Cursor {
    val parent = DocumentsContract.getDocumentId(uri)
    check(uri.lastPathSegment == "children") { "only child-document queries are expected: $uri" }
    queries += parent to projection?.toList()
    val columns = projection ?: COLUMNS
    return MatrixCursor(columns).apply {
      for (row in children[parent].orEmpty()) {
        addRow(columns.map { row[COLUMNS.indexOf(it)] })
      }
    }
  }

  override fun getType(uri: Uri): String? = null

  override fun insert(uri: Uri, values: ContentValues?): Uri? = null

  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0

  companion object {
    val COLUMNS =
      arrayOf(
        Document.COLUMN_DOCUMENT_ID,
        Document.COLUMN_DISPLAY_NAME,
        Document.COLUMN_MIME_TYPE,
        Document.COLUMN_SIZE,
        Document.COLUMN_LAST_MODIFIED,
      )
  }
}
