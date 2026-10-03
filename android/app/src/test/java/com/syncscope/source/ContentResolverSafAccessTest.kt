package com.syncscope.source

import android.content.ContentProvider
import android.content.ContentResolver
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.os.Process
import android.os.storage.StorageManager
import android.provider.DocumentsContract
import androidx.test.core.app.ApplicationProvider
import java.io.File
import java.io.FileNotFoundException
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowStorageManager
import org.robolectric.shadows.StorageVolumeBuilder

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class ContentResolverSafAccessTest {

  private lateinit var context: Context
  private lateinit var provider: FakeDocumentsProvider
  private lateinit var access: ContentResolverSafAccess

  private val treeUri =
    "content://${SourceTree.EXTERNAL_STORAGE_AUTHORITY}/tree/primary%3ADCIM%2FCamera"
  private val documentUri =
    DocumentsContract.buildDocumentUriUsingTree(Uri.parse(treeUri), "primary:DCIM/Camera/beach.png").toString()

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    provider =
      Robolectric.setupContentProvider(
        FakeDocumentsProvider::class.java,
        SourceTree.EXTERNAL_STORAGE_AUTHORITY,
      )
    access = ContentResolverSafAccess(context)
  }

  @After
  fun tearDown() {
    ShadowStorageManager.reset()
  }

  @Test
  fun rootExistsWhenTheRootQueryReturnsARow() {
    provider.mode = FakeDocumentsProvider.Mode.ROW
    assertTrue(access.rootExists(treeUri))
    val queried = provider.lastQuery!!
    assertEquals(
      DocumentsContract.buildDocumentUriUsingTree(Uri.parse(treeUri), "primary:DCIM/Camera"),
      queried.first,
    )
    // Explicit projection, never `null` (all columns).
    assertEquals(listOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID), queried.second)
  }

  @Test
  fun rootMissingWhenTheRootQueryReturnsNoRow() {
    provider.mode = FakeDocumentsProvider.Mode.EMPTY
    assertFalse(access.rootExists(treeUri))
  }

  @Test
  fun rootMissingWhenTheRootQueryThrows() {
    provider.mode = FakeDocumentsProvider.Mode.THROW
    assertFalse(access.rootExists(treeUri))
  }

  @Test
  fun rootMissingWhenTheQueryReturnsNull() {
    provider.mode = FakeDocumentsProvider.Mode.NULL
    assertFalse(access.rootExists(treeUri))
  }

  @Test
  fun statReadsSizeAndModifiedTimeWithAnExplicitProjection() {
    provider.stat = FakeDocumentsProvider.Stat(size = 42, modified = 1_704_067_200_000L)
    assertEquals(DocumentStat(42, 1_704_067_200_000L), access.stat(documentUri))
    assertEquals(Uri.parse(documentUri), provider.lastQuery!!.first)
    assertEquals(
      listOf(DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED),
      provider.lastQuery!!.second,
    )
  }

  @Test
  fun statMapsAMissingSizeAndAZeroTimeToNull() {
    provider.stat = FakeDocumentsProvider.Stat(size = null, modified = 0L)
    assertEquals(DocumentStat(null, null), access.stat(documentUri))
    provider.stat = FakeDocumentsProvider.Stat(size = 7, modified = null)
    assertEquals(DocumentStat(7, null), access.stat(documentUri))
  }

  @Test
  fun statIsNullWhenTheDocumentIsAbsent() {
    provider.mode = FakeDocumentsProvider.Mode.EMPTY
    assertNull(access.stat(documentUri))
    provider.mode = FakeDocumentsProvider.Mode.NULL
    assertNull(access.stat(documentUri))
    provider.mode = FakeDocumentsProvider.Mode.NOT_FOUND
    assertNull(access.stat(documentUri))
  }

  @Test
  fun statLetsASecurityExceptionPropagate() {
    provider.mode = FakeDocumentsProvider.Mode.DENIED
    assertThrows(SecurityException::class.java) { access.stat(documentUri) }
  }

  @Test
  fun deleteGoesThroughDeleteDocument() {
    provider.deleteMode = FakeDocumentsProvider.DeleteMode.OK
    assertEquals(DeleteResult.DELETED, access.delete(documentUri))
    assertEquals(listOf(FakeDocumentsProvider.METHOD_DELETE_DOCUMENT to Uri.parse(documentUri)), provider.calls)
  }

  @Test
  fun deleteMapsProviderFailures() {
    provider.deleteMode = FakeDocumentsProvider.DeleteMode.DENIED
    assertEquals(DeleteResult.DENIED, access.delete(documentUri))
    provider.deleteMode = FakeDocumentsProvider.DeleteMode.CRASH
    assertEquals(DeleteResult.FAILED, access.delete(documentUri))
  }

  @Test
  fun deleteMapsFileNotFoundAndFalseFromDeleteDocument() {
    // DocumentsContract surfaces a missing document as FileNotFoundException (targetSdk >= O).
    val notFound = ContentResolverSafAccess(context, deleteDocument = { _, _ -> throw FileNotFoundException("Missing file") })
    assertEquals(DeleteResult.NOT_FOUND, notFound.delete(documentUri))
    val refused = ContentResolverSafAccess(context, deleteDocument = { _, _ -> false })
    assertEquals(DeleteResult.FAILED, refused.delete(documentUri))
    val denied = ContentResolverSafAccess(context, deleteDocument = { _, _ -> throw SecurityException("Permission Denial") })
    assertEquals(DeleteResult.DENIED, denied.delete(documentUri))
  }

  @Test
  fun volumeLabelUsesTheMountedVolumeDescription() {
    addVolume(uuid = "1234-ABCD", description = "SDCARD", state = Environment.MEDIA_MOUNTED)
    assertEquals("SDCARD", access.volumeLabel("1234-ABCD"))
  }

  @Test
  fun volumeLabelMatchesThePrimaryVolume() {
    addVolume(uuid = null, description = "Internal shared storage", state = Environment.MEDIA_MOUNTED, primary = true)
    assertEquals("Internal shared storage", access.volumeLabel("primary"))
  }

  @Test
  fun volumeLabelFallsBackForAnUnmountedVolume() {
    addVolume(uuid = "1234-ABCD", description = "SDCARD", state = Environment.MEDIA_UNMOUNTED)
    assertEquals(ContentResolverSafAccess.UNMOUNTED_VOLUME_LABEL, access.volumeLabel("1234-ABCD"))
    assertEquals("Removable storage", ContentResolverSafAccess.UNMOUNTED_VOLUME_LABEL)
  }

  @Test
  fun volumeLabelFallsBackForAnUnknownVolume() {
    assertEquals("Removable storage", access.volumeLabel("9999-0000"))
  }

  @Test
  fun takeGrantPersistsReadAndWriteAndIsListed() {
    val grant = access.takeGrant(treeUri)
    assertEquals(PersistedGrant(treeUri, canRead = true, canWrite = true), grant)
    assertEquals(listOf(grant), access.persistedGrants())
  }

  @Test
  fun releaseGrantRemovesAPersistedGrant() {
    access.takeGrant(treeUri)
    access.releaseGrant(treeUri)
    assertEquals(emptyList<PersistedGrant>(), access.persistedGrants())
  }

  @Test
  fun releaseGrantSwallowsSecurityException() {
    val throwing =
      object : ContentResolver(context) {
        override fun releasePersistableUriPermission(uri: Uri, modeFlags: Int) {
          throw SecurityException("No persistable permission grants found for UID")
        }
      }
    val accessWithThrowingResolver = ContentResolverSafAccess(context, resolver = throwing)
    accessWithThrowingResolver.releaseGrant(treeUri) // must not throw
  }

  private fun addVolume(uuid: String?, description: String, state: String, primary: Boolean = false) {
    val builder =
      StorageVolumeBuilder(
        uuid ?: "primary",
        File("/storage/${uuid ?: "emulated"}"),
        description,
        Process.myUserHandle(),
        state,
      )
        .setIsPrimary(primary)
        .setIsRemovable(!primary)
    if (uuid != null) builder.setFsUuid(uuid)
    shadowOf(context.getSystemService(StorageManager::class.java)).addStorageVolume(builder.build())
  }
}

/** Stands in for the external storage documents provider; its root query is configurable. */
class FakeDocumentsProvider : ContentProvider() {
  enum class Mode { ROW, EMPTY, THROW, NULL, NOT_FOUND, DENIED }

  enum class DeleteMode { OK, DENIED, CRASH }

  /** A stat row; only returned for a query whose projection asks for `COLUMN_SIZE`. */
  data class Stat(val size: Long?, val modified: Long?)

  var mode: Mode = Mode.ROW
  var stat: Stat = Stat(size = 1, modified = 1)
  var deleteMode: DeleteMode = DeleteMode.OK
  var lastQuery: Pair<Uri, List<String>?>? = null
  val calls = mutableListOf<Pair<String, Uri?>>()

  override fun onCreate(): Boolean = true

  override fun query(
    uri: Uri,
    projection: Array<out String>?,
    selection: String?,
    selectionArgs: Array<out String>?,
    sortOrder: String?,
  ): Cursor? {
    lastQuery = uri to projection?.toList()
    if (mode == Mode.ROW && projection?.contains(DocumentsContract.Document.COLUMN_SIZE) == true) {
      return MatrixCursor(projection).apply { addRow(arrayOf<Any?>(stat.size, stat.modified)) }
    }
    return when (mode) {
      Mode.ROW ->
        MatrixCursor(arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID)).apply {
          addRow(arrayOf<Any>("primary:DCIM/Camera"))
        }
      Mode.EMPTY -> MatrixCursor(arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID))
      Mode.THROW -> throw IllegalStateException("volume unmounted")
      Mode.NULL -> null
      Mode.NOT_FOUND -> throw FileNotFoundException("Missing file")
      Mode.DENIED -> throw SecurityException("Permission Denial")
    }
  }

  /** `DocumentsContract.deleteDocument` arrives here as `METHOD_DELETE_DOCUMENT`. */
  override fun call(method: String, arg: String?, extras: Bundle?): Bundle? {
    @Suppress("DEPRECATION")
    calls += method to extras?.getParcelable<Uri>(EXTRA_URI)
    return when (deleteMode) {
      DeleteMode.OK -> Bundle()
      DeleteMode.DENIED -> throw SecurityException("Permission Denial")
      DeleteMode.CRASH -> throw IllegalStateException("provider crashed")
    }
  }

  companion object {
    /** `DocumentsContract.METHOD_DELETE_DOCUMENT` and `EXTRA_URI` are hidden API; their stable values. */
    const val METHOD_DELETE_DOCUMENT = "android:deleteDocument"
    const val EXTRA_URI = "uri"
  }

  override fun getType(uri: Uri): String? = null

  override fun insert(uri: Uri, values: ContentValues?): Uri? = null

  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0
}
