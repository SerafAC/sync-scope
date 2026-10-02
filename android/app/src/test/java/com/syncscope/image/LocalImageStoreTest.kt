package com.syncscope.image

import android.content.Context
import android.graphics.Bitmap
import androidx.test.core.app.ApplicationProvider
import java.io.File
import java.io.FileNotFoundException
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class LocalImageStoreTest {

  private lateinit var cacheDir: File
  private val source = FakeThumbnailSource()
  private lateinit var store: LocalImageStore

  @Before
  fun setUp() {
    cacheDir = ApplicationProvider.getApplicationContext<Context>().cacheDir
    File(cacheDir, "thumbnails").deleteRecursively()
    store = LocalImageStore(cacheDir, source)
  }

  @After
  fun tearDown() {
    File(cacheDir, "thumbnails").deleteRecursively()
  }

  @Test
  fun aFirstCallDecodesOnceAndASecondCallIsServedFromTheCache() = runBlocking {
    val first = store.handle(ENTRY_ID, DOCUMENT_URI, 256)

    val expected = File(File(cacheDir, "thumbnails"), sha256("$ENTRY_ID|256") + ".jpg")
    assertTrue("thumbnail written to $expected", expected.isFile)
    assertTrue(expected.length() > 0)
    assertEquals(1, source.loads.get())
    assertEquals(listOf(DOCUMENT_URI to 256), source.requests)

    val second = store.handle(ENTRY_ID, DOCUMENT_URI, 256)

    assertEquals(first, second)
    assertEquals("no second decode", 1, source.loads.get())
    // No temp file is left next to the thumbnail.
    assertEquals(listOf(expected.name), File(cacheDir, "thumbnails").list()!!.toList())
  }

  @Test
  fun theUriIsAFileUriThatCarriesNoDocumentIdentity() = runBlocking {
    val uri = store.handle(ENTRY_ID, DOCUMENT_URI, 256)

    assertTrue(uri, uri.startsWith("file://"))
    assertFalse(uri, uri.contains(DOCUMENT_URI))
    assertFalse(uri, uri.contains(DOCUMENT_ID))
    assertFalse(uri, uri.contains("secret"))
    assertFalse(uri, uri.contains(ENTRY_ID))
  }

  @Test
  fun theEdgeIsClampedToTheContractBounds() = runBlocking {
    store.handle(ENTRY_ID, DOCUMENT_URI, 10)
    store.handle(ENTRY_ID, DOCUMENT_URI, 5000)

    assertEquals(listOf(DOCUMENT_URI to 64, DOCUMENT_URI to 2048), source.requests)
    val names = File(cacheDir, "thumbnails").list()!!.toSet()
    assertEquals(setOf(sha256("$ENTRY_ID|64") + ".jpg", sha256("$ENTRY_ID|2048") + ".jpg"), names)
    // A clamped request hits the same cache entry as the bound itself.
    store.handle(ENTRY_ID, DOCUMENT_URI, 1)
    assertEquals(2, source.loads.get())
  }

  @Test
  fun sampleSizeIsTheLargestPowerOfTwoKeepingTheLongEdgeAtLeastTheTarget() {
    assertEquals(8, sampleSizeFor(4000, 3000, 256))
    assertEquals(1, sampleSizeFor(300, 200, 256))
    assertEquals(1, sampleSizeFor(256, 256, 256))
    assertEquals(8, sampleSizeFor(3000, 4000, 256))
    assertEquals(2, sampleSizeFor(512, 10, 256))
    assertEquals(1, sampleSizeFor(511, 10, 256))
  }

  @Test
  fun unreadableDocumentsAreImageUnavailable() {
    val failures =
      listOf<() -> Bitmap?>(
        { throw FileNotFoundException("content://gone") },
        { throw SecurityException("grant revoked") },
        { null },
      )
    for ((index, failure) in failures.withIndex()) {
      source.behaviour = failure
      assertThrows("failure $index", ImageUnavailable::class.java) {
        runBlocking { store.handle("entry-$index", DOCUMENT_URI, 256) }
      }
    }
    // A failed load leaves nothing in the cache, so a later call retries.
    assertEquals(0, File(cacheDir, "thumbnails").list()?.size ?: 0)
  }

  @Test
  fun atMostFourLoadsRunAtOnce() = runBlocking {
    val gate = CountDownLatch(1)
    val current = AtomicInteger()
    val peak = AtomicInteger()
    val entered = AtomicInteger()
    source.behaviour = {
      val now = current.incrementAndGet()
      peak.accumulateAndGet(now) { a, b -> maxOf(a, b) }
      entered.incrementAndGet()
      gate.await(10, TimeUnit.SECONDS)
      current.decrementAndGet()
      Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888)
    }

    val calls = (1..8).map { i -> async(Dispatchers.Default) { store.handle("entry-$i", DOCUMENT_URI, 256) } }
    val deadline = System.currentTimeMillis() + 10_000
    while (entered.get() < 4 && System.currentTimeMillis() < deadline) Thread.sleep(10)
    // Give a fifth load every chance to start before the gate opens.
    Thread.sleep(300)
    assertEquals(4, entered.get())
    gate.countDown()
    val uris = calls.awaitAll()

    assertEquals(8, uris.toSet().size)
    assertEquals(4, peak.get())
    assertEquals(8, source.loads.get())
  }

  /** Returns an `edge × edge/2` bitmap unless [behaviour] is set. */
  private class FakeThumbnailSource : ThumbnailSource {
    val loads = AtomicInteger()
    val requests: MutableList<Pair<String, Int>> = java.util.Collections.synchronizedList(mutableListOf())
    var behaviour: (() -> Bitmap?)? = null

    override fun load(documentUri: String, edgePx: Int): Bitmap? {
      loads.incrementAndGet()
      requests += documentUri to edgePx
      return behaviour?.invoke() ?: if (behaviour == null) Bitmap.createBitmap(edgePx, edgePx / 2, Bitmap.Config.ARGB_8888) else null
    }
  }

  private fun sha256(value: String): String =
    MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }

  private companion object {
    const val ENTRY_ID = "entry-1"
    const val DOCUMENT_ID = "primary:DCIM/secret.png"
    const val DOCUMENT_URI = "content://com.android.externalstorage.documents/document/primary%3ADCIM%2Fsecret.png"
  }
}
