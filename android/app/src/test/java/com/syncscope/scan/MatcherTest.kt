package com.syncscope.scan

import com.syncscope.bridge.CloudSyncErrorCode
import com.syncscope.bridge.FileIssueCode
import com.syncscope.remote.RemoteEntry
import com.syncscope.remote.RemoteEntryType
import com.syncscope.source.LocalFile
import org.junit.Assert.assertEquals
import org.junit.Test

/** One test per row of the data-model "Matching rules" table, plus the rule-order cases. */
class MatcherTest {

  private val incomplete = ListingState.Incomplete(CloudSyncErrorCode.DIRECTORY_UNREADABLE)

  @Test
  fun rule1NullSizeIsLocalUnavailableEvenWithAnExactKey() {
    val index = index(remote("exact.txt", 22, MTIME))
    val verdict = Matcher.verdict(local("exact.txt", null, MTIME), PRECISION, index, ListingState.Complete)
    assertEquals(Verdict(FileStatus.UNKNOWN, FileIssueCode.LOCAL_UNAVAILABLE.name), verdict)
  }

  @Test
  fun rule1NullMtimeIsLocalUnavailableEvenWithAnExactKey() {
    val index = index(remote("exact.txt", 22, MTIME))
    val verdict = Matcher.verdict(local("exact.txt", 22, null), PRECISION, index, ListingState.Complete)
    assertEquals(Verdict(FileStatus.UNKNOWN, FileIssueCode.LOCAL_UNAVAILABLE.name), verdict)
  }

  @Test
  fun rule2ExactKeyIsSynced() {
    val index = index(remote("exact.txt", 22, MTIME + 999))
    assertEquals(SYNCED, Matcher.verdict(local("exact.txt", 22, MTIME), PRECISION, index, ListingState.Complete))
  }

  @Test
  fun rule2ExactKeyStaysSyncedOnAnIncompleteListing() {
    val index = index(remote("exact.txt", 22, MTIME))
    assertEquals(SYNCED, Matcher.verdict(local("exact.txt", 22, MTIME), PRECISION, index, incomplete))
  }

  @Test
  fun rule2MatchesAcrossUnicodeNormalization() {
    val index = index(remote("é-decomposed.txt", 28, MTIME))
    assertEquals(
      SYNCED,
      Matcher.verdict(local("é-decomposed.txt", 28, MTIME), PRECISION, index, ListingState.Complete),
    )
  }

  @Test
  fun rule3OnlyAnUnknownMtimeKeyIsRemoteMtimeMissing() {
    val index = index(remote("exact.txt", 22, null))
    val verdict = Matcher.verdict(local("exact.txt", 22, MTIME), PRECISION, index, ListingState.Complete)
    assertEquals(Verdict(FileStatus.UNKNOWN, FileIssueCode.REMOTE_MTIME_MISSING.name), verdict)
  }

  @Test
  fun rule3ComesBeforeAnIncompleteListing() {
    val index = index(remote("exact.txt", 22, null))
    val verdict = Matcher.verdict(local("exact.txt", 22, MTIME), PRECISION, index, incomplete)
    assertEquals(Verdict(FileStatus.UNKNOWN, FileIssueCode.REMOTE_MTIME_MISSING.name), verdict)
  }

  @Test
  fun rule2ComesBeforeRule3() {
    val index = index(remote("exact.txt", 22, null), remote("exact.txt", 22, MTIME))
    assertEquals(SYNCED, Matcher.verdict(local("exact.txt", 22, MTIME), PRECISION, index, ListingState.Complete))
  }

  @Test
  fun rule4NoKeyOnAnIncompleteListingCarriesTheFirstFailureCode() {
    val verdict = Matcher.verdict(local("only-here.txt", 19, MTIME), PRECISION, index(), incomplete)
    assertEquals(Verdict(FileStatus.UNKNOWN, CloudSyncErrorCode.DIRECTORY_UNREADABLE.name), verdict)

    val lost = ListingState.Incomplete(CloudSyncErrorCode.CONNECTION_LOST)
    assertEquals(
      Verdict(FileStatus.UNKNOWN, CloudSyncErrorCode.CONNECTION_LOST.name),
      Matcher.verdict(local("only-here.txt", 19, MTIME), PRECISION, index(), lost),
    )
  }

  @Test
  fun rule4WithAnUnreadFolderIsRemoteFolderUnreadNeverUnsynced() {
    val folderGap = ListingState.Incomplete(CloudSyncErrorCode.REMOTE_ROOT_NOT_FOUND, folderUnread = true)
    assertEquals(
      Verdict(FileStatus.UNKNOWN, FileIssueCode.REMOTE_FOLDER_UNREAD.name),
      Matcher.verdict(local("only-here.txt", 19, MTIME), PRECISION, index(), folderGap),
    )
    // A subdirectory gap seen first does not hide the unread folder: the folder decides the issue.
    val mixed = ListingState.Incomplete(CloudSyncErrorCode.DIRECTORY_UNREADABLE, folderUnread = true)
    assertEquals(
      Verdict(FileStatus.UNKNOWN, FileIssueCode.REMOTE_FOLDER_UNREAD.name),
      Matcher.verdict(local("only-here.txt", 19, MTIME), PRECISION, index(remote("other.txt", 1, MTIME)), mixed),
    )
  }

  @Test
  fun anUnreadFolderKeepsExactMatchesSyncedAndRule3First() {
    val folderGap = ListingState.Incomplete(CloudSyncErrorCode.DIRECTORY_UNREADABLE, folderUnread = true)
    assertEquals(SYNCED, Matcher.verdict(local("exact.txt", 22, MTIME), PRECISION, index(remote("exact.txt", 22, MTIME)), folderGap))
    assertEquals(
      Verdict(FileStatus.UNKNOWN, FileIssueCode.REMOTE_MTIME_MISSING.name),
      Matcher.verdict(local("exact.txt", 22, MTIME), PRECISION, index(remote("exact.txt", 22, null)), folderGap),
    )
  }

  @Test
  fun rule5NoKeyOnACompleteListingIsUnsynced() {
    val index = index(remote("exact.txt", 22, MTIME))
    assertEquals(
      UNSYNCED,
      Matcher.verdict(local("local-only.txt", 19, MTIME), PRECISION, index, ListingState.Complete),
    )
  }

  @Test
  fun sizeMismatchIsUnsynced() {
    val index = index(remote("size-mismatch.txt", 30, MTIME))
    assertEquals(
      UNSYNCED,
      Matcher.verdict(local("size-mismatch.txt", 19, MTIME), PRECISION, index, ListingState.Complete),
    )
  }

  @Test
  fun adjacentBucketIsNotAMatch() {
    val index = index(remote("exact.txt", 22, MTIME + PRECISION))
    assertEquals(UNSYNCED, Matcher.verdict(local("exact.txt", 22, MTIME + 999), PRECISION, index, ListingState.Complete))
    val earlier = index(remote("exact.txt", 22, MTIME - 1))
    assertEquals(UNSYNCED, Matcher.verdict(local("exact.txt", 22, MTIME), PRECISION, earlier, ListingState.Complete))
  }

  @Test
  fun caseOnlyNameDifferenceIsNotAMatch() {
    val index = index(remote("IMG.jpg", 10, MTIME))
    assertEquals(UNSYNCED, Matcher.verdict(local("img.jpg", 10, MTIME), PRECISION, index, ListingState.Complete))
  }

  @Test
  fun caseOnlyMtimeUnknownKeyIsNotRule3() {
    val index = index(remote("IMG.jpg", 10, null))
    assertEquals(UNSYNCED, Matcher.verdict(local("img.jpg", 10, MTIME), PRECISION, index, ListingState.Complete))
  }

  private fun index(vararg entries: RemoteEntry) = MatchIndex(PRECISION).apply { entries.forEach { add(it, "/") } }

  private fun remote(name: String, size: Long, mtime: Long?) = RemoteEntry(name, size, mtime, RemoteEntryType.REGULAR_FILE)

  private fun local(name: String, size: Long?, mtime: Long?) =
    LocalFile(
      documentId = "doc:$name",
      parentDocumentId = null,
      name = name,
      isDirectory = false,
      isHidden = false,
      mimeType = null,
      sizeBytes = size,
      modifiedUtcMillis = mtime,
    )

  private companion object {
    const val PRECISION = 1_000L
    const val MTIME = 1_704_067_200_000L
    val SYNCED = Verdict(FileStatus.SYNCED, null)
    val UNSYNCED = Verdict(FileStatus.UNSYNCED, null)
  }
}
