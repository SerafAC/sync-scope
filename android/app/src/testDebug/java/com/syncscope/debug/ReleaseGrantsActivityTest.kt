package com.syncscope.debug

import android.content.Intent
import android.net.Uri
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The debug-only grant-release seam (research R11): opening
 * `syncscope-debug://release-grants` releases every persisted URI grant and finishes, leaving
 * the same OS state a real revocation leaves.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class ReleaseGrantsActivityTest {

  private val flags =
    Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION

  private val camera =
    Uri.parse("content://com.android.externalstorage.documents/tree/primary%3ASyncScopeE2E%2FCamera")
  private val sdCamera =
    Uri.parse("content://com.android.externalstorage.documents/tree/1A2B-3C4D%3ASyncScopeE2E%2FCamera")

  private fun deepLink(): Intent =
    Intent(Intent.ACTION_VIEW, Uri.parse("syncscope-debug://release-grants"))

  @Test
  fun releasesEveryPersistedGrantAndFinishes() {
    val controller = Robolectric.buildActivity(ReleaseGrantsActivity::class.java, deepLink())
    val resolver = controller.get().contentResolver
    resolver.takePersistableUriPermission(camera, flags)
    resolver.takePersistableUriPermission(sdCamera, flags)
    assertEquals(2, resolver.persistedUriPermissions.size)

    controller.create()

    assertEquals(emptyList<Any>(), resolver.persistedUriPermissions)
    assertTrue(controller.get().isFinishing)
  }

  @Test
  fun finishesWhenThereAreNoGrants() {
    val controller = Robolectric.buildActivity(ReleaseGrantsActivity::class.java, deepLink())
    val resolver = controller.get().contentResolver
    assertEquals(emptyList<Any>(), resolver.persistedUriPermissions)

    controller.create()

    assertEquals(emptyList<Any>(), resolver.persistedUriPermissions)
    assertTrue(controller.get().isFinishing)
  }
}
