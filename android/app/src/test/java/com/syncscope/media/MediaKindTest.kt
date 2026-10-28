package com.syncscope.media

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.syncscope.persistence.SyncScopeDatabase
import com.syncscope.persistence.localNode
import com.syncscope.persistence.scanRun
import com.syncscope.persistence.sourceRoot
import com.syncscope.persistence.stagingSnapshot
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The single media rule (research R6): a media file is a `FILE` whose MIME type starts with `image/` or
 * `video/`. [PARITY_CASES] is the same table as `src/files/__tests__/media.test.ts`, with the same answers.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class MediaKindTest {

  private lateinit var db: SyncScopeDatabase

  @Before
  fun setUp() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    db = Room.inMemoryDatabaseBuilder(context, SyncScopeDatabase::class.java).allowMainThreadQueries().build()
  }

  @After
  fun tearDown() {
    db.close()
  }

  @Test
  fun ofClassifiesImagesVideosAndEverythingElse() {
    for ((mimeType, expected) in PARITY_CASES) {
      assertEquals("of($mimeType)", expected, MediaKind.of(mimeType))
    }
  }

  @Test
  fun sqlMediaSelectsExactlyTheImageAndVideoFiles(): Unit = runBlocking {
    db.scanRunDao().insert(scanRun("run-1", 1L))
    db.snapshotDao().insert(stagingSnapshot("snap-1", "run-1"))
    db.sourceRootDao().insert(sourceRoot("src-1"))
    val files =
      listOf(
        "jpeg" to "image/jpeg",
        "png" to "image/png",
        "mp4" to "video/mp4",
        "mov" to "video/quicktime",
        "pdf" to "application/pdf",
        "none" to null,
        "empty" to "",
        "imagex" to "imagex/foo",
        "bare" to "image",
        "wild" to "image%x",
      )
    db.localNodeDao().insertAll(
      files.map { (id, mime) -> localNode("snap-1", "src-1", id, "$id.bin", mimeType = mime) } +
        // A directory is never media, whatever its MIME type says.
        localNode("snap-1", "src-1", "dir", "Album", kind = "DIRECTORY", sizeBytes = null, mimeType = "video/mp4"),
    )

    val selected =
      db.openHelper.readableDatabase
        .query("SELECT entryId FROM local_node WHERE ${MediaKind.SQL_MEDIA} ORDER BY entryId")
        .use { c -> buildList { while (c.moveToNext()) add(c.getString(0)) } }

    assertEquals(listOf("jpeg", "mov", "mp4", "png"), selected)
  }

  private companion object {
    /** Shared with `media.test.ts` (`PARITY_CASES`): the same MIME types, the same answers. */
    val PARITY_CASES: List<Pair<String?, MediaKind?>> =
      listOf(
        "image/jpeg" to MediaKind.IMAGE,
        "image/png" to MediaKind.IMAGE,
        "image/heic" to MediaKind.IMAGE,
        "video/mp4" to MediaKind.VIDEO,
        "video/quicktime" to MediaKind.VIDEO,
        null to null,
        "" to null,
        "application/pdf" to null,
        "imagex/foo" to null,
        "image" to null,
        "text/image/png" to null,
      )
  }
}
