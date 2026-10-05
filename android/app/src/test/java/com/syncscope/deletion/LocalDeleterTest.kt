package com.syncscope.deletion

import com.syncscope.source.DeleteResult
import com.syncscope.source.DocumentStat
import com.syncscope.source.FakeSafAccess
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Research R13, execute steps 1–3: one test per branch of [LocalDeleter.deleteOne]. */
class LocalDeleterTest {

  private val saf = FakeSafAccess()
  private val deleter = LocalDeleter(saf, clock = { NOW })
  private val row =
    DeletionRow(
      entryId = "e-1",
      sourceId = "src-1",
      parentId = null,
      documentUri = URI,
      name = "beach.png",
      sizeBytes = 120,
      modifiedUtcMillis = MTIME,
      status = "SYNCED",
    )

  @Test
  fun noWriteGrantIsAccessLostAndTouchesNothing() {
    saf.documents[URI] = DocumentStat(120, MTIME)
    assertEquals(DeletionState.ACCESS_LOST, deleter.deleteOne(row, sourceCanWrite = false).state)
    assertTrue(saf.statted.isEmpty())
    assertTrue(saf.deleted.isEmpty())
  }

  @Test
  fun anAbsentDocumentIsAlreadyGoneWithoutADelete() {
    assertEquals(DeletionState.ALREADY_GONE, deleter.deleteOne(row, sourceCanWrite = true).state)
    assertTrue(saf.deleted.isEmpty())
  }

  @Test
  fun aDifferentSizeIsChangedAndNotDeleted() {
    saf.documents[URI] = DocumentStat(121, MTIME)
    assertEquals(DeletionState.CHANGED, deleter.deleteOne(row, sourceCanWrite = true).state)
    assertTrue(saf.deleted.isEmpty())
    assertTrue(URI in saf.documents)
  }

  @Test
  fun aDifferentModifiedTimeIsChangedAndNotDeleted() {
    saf.documents[URI] = DocumentStat(120, MTIME + 1)
    assertEquals(DeletionState.CHANGED, deleter.deleteOne(row, sourceCanWrite = true).state)
    assertTrue(saf.deleted.isEmpty())
  }

  @Test
  fun aMatchingDocumentIsDeleted() {
    saf.documents[URI] = DocumentStat(120, MTIME)
    val outcome = deleter.deleteOne(row, sourceCanWrite = true)
    assertEquals(DeletionOutcome(row, DeletionState.DELETED, NOW), outcome)
    assertEquals(listOf(URI), saf.deleted)
    assertFalse(URI in saf.documents)
  }

  @Test
  fun unknownSizeAndTimeMatchWhenTheProviderStillReportsNone() {
    val noMeta = row.copy(sizeBytes = null, modifiedUtcMillis = null)
    saf.documents[URI] = DocumentStat(null, null)
    assertEquals(DeletionState.DELETED, deleter.deleteOne(noMeta, sourceCanWrite = true).state)
  }

  @Test
  fun notFoundConfirmedByAReQueryIsAlreadyGone() {
    saf.documents[URI] = DocumentStat(120, MTIME)
    saf.deleteResults[URI] = DeleteResult.NOT_FOUND
    saf.onDelete = { saf.documents.remove(it) } // vanished between the stat and the delete
    assertEquals(DeletionState.ALREADY_GONE, deleter.deleteOne(row, sourceCanWrite = true).state)
    assertEquals(2, saf.statted.size)
  }

  @Test
  fun notFoundWhileTheDocumentStillExistsIsFailed() {
    saf.documents[URI] = DocumentStat(120, MTIME)
    saf.deleteResults[URI] = DeleteResult.NOT_FOUND
    assertEquals(DeletionState.FAILED, deleter.deleteOne(row, sourceCanWrite = true).state)
  }

  @Test
  fun deniedIsAccessLost() {
    saf.documents[URI] = DocumentStat(120, MTIME)
    saf.deleteResults[URI] = DeleteResult.DENIED
    assertEquals(DeletionState.ACCESS_LOST, deleter.deleteOne(row, sourceCanWrite = true).state)
  }

  @Test
  fun aDeniedStatIsAccessLost() {
    saf.statDenied += URI
    assertEquals(DeletionState.ACCESS_LOST, deleter.deleteOne(row, sourceCanWrite = true).state)
    assertTrue(saf.deleted.isEmpty())
  }

  @Test
  fun anyOtherFailureIsFailed() {
    saf.documents[URI] = DocumentStat(120, MTIME)
    saf.deleteResults[URI] = DeleteResult.FAILED
    assertEquals(DeletionState.FAILED, deleter.deleteOne(row, sourceCanWrite = true).state)
    assertTrue(URI in saf.documents)
  }

  @Test
  fun aFailedDeleteOfADocumentThatIsNowAbsentIsAlreadyGone() {
    // deleteDocument returning false: R13 re-queries before calling it a failure.
    saf.documents[URI] = DocumentStat(120, MTIME)
    saf.deleteResults[URI] = DeleteResult.FAILED
    saf.onDelete = { saf.documents.remove(it) }
    assertEquals(DeletionState.ALREADY_GONE, deleter.deleteOne(row, sourceCanWrite = true).state)
  }

  @Test
  fun onlyDeletedAndAlreadyGoneRemoveTheRow() {
    assertEquals(
      setOf(DeletionState.DELETED, DeletionState.ALREADY_GONE),
      DeletionState.entries.filter { it.removesRow }.toSet(),
    )
  }

  private companion object {
    const val URI = "content://com.android.externalstorage.documents/tree/primary%3ASyncScopeE2E/document/primary%3ASyncScopeE2E%2Fbeach.png"
    const val MTIME = 1_704_067_200_000L
    const val NOW = 1_800_000_000_000L
  }
}
