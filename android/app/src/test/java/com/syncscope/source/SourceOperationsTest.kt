package com.syncscope.source

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.ReadableMap
import com.syncscope.bridge.CloudSyncEnvelope
import com.syncscope.persistence.LocalNodeEntity
import com.syncscope.persistence.SourceRootDao
import com.syncscope.persistence.SourceRootEntity
import com.syncscope.persistence.SyncScopeDatabase
import com.syncscope.persistence.localNode
import com.syncscope.persistence.scanRun
import com.syncscope.persistence.stagingSnapshot
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class SourceOperationsTest {

  private lateinit var db: SyncScopeDatabase
  private lateinit var dao: SourceRootDao
  private val saf = FakeSafAccess()
  private var now = 1_000L
  private var nextId = 0
  private lateinit var operations: SourceOperations

  private val camera = treeUri("primary:DCIM/Camera")
  private val dcim = treeUri("primary:DCIM")
  private val music = treeUri("primary:Music")
  private val sdCamera = treeUri("1234-ABCD:DCIM/Camera")

  @Before
  fun setUp() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    db = Room.inMemoryDatabaseBuilder(context, SyncScopeDatabase::class.java).allowMainThreadQueries().build()
    dao = db.sourceRootDao()
    saf.labels["1234-ABCD"] = "SDCARD"
    operations =
      SourceOperations(
        saf = { saf },
        sources = { dao },
        envelope = CloudSyncEnvelope({ JavaOnlyMap() }, { JavaOnlyArray() }),
        clock = { now++ },
        newId = { "id-${++nextId}" },
      )
  }

  @After
  fun tearDown() {
    db.close()
  }

  // --- list ---

  @Test
  fun listWithNoSourcesIsOkAndEmpty() = runBlocking {
    val result = operations.list()
    assertEquals("ok", result.getString("status"))
    assertEquals(2, result.getInt("contractVersion"))
    assertEquals(0, result.getArray("sources")!!.size())
  }

  @Test
  fun listIsOrderedByAddedAtAscending() = runBlocking {
    dao.insert(row("b", "primary", "Music", addedAt = 30L))
    dao.insert(row("a", "primary", "DCIM", addedAt = 10L))
    dao.insert(row("c", "primary", "Pictures", addedAt = 20L))

    assertEquals(listOf("a", "c", "b"), sources(operations.list()).map { it.getString("sourceId") })
  }

  @Test
  fun listEvaluatesAvailabilityInR5Order() = runBlocking {
    // No grant at all: GRANT_REVOKED, and the root is not even queried.
    dao.insert(row("revoked", "primary", "A", addedAt = 1L))
    // A grant without read permission does not count.
    dao.insert(row("writeOnly", "primary", "B", addedAt = 2L)).also { saf.hold(treeUri("primary:B"), canRead = false) }
    // Grant present, root query fails: STORAGE_MISSING.
    dao.insert(row("missing", "1234-ABCD", "C", addedAt = 3L))
    saf.hold(treeUri("1234-ABCD:C"))
    saf.missingRoots += treeUri("1234-ABCD:C")
    // Grant present and root reachable.
    dao.insert(row("ok", "primary", "D", addedAt = 4L))
    saf.hold(treeUri("primary:D"))

    val byId = sources(operations.list()).associate { it.getString("sourceId") to it.getString("availability") }
    assertEquals(
      mapOf(
        "revoked" to "GRANT_REVOKED",
        "writeOnly" to "GRANT_REVOKED",
        "missing" to "STORAGE_MISSING",
        "ok" to "AVAILABLE",
      ),
      byId,
    )
    assertFalse(treeUri("primary:A") in saf.rootQueries)
  }

  @Test
  fun listMapsTheSourceDtoFields() = runBlocking {
    dao.insert(row("int", "primary", "DCIM/Camera", addedAt = 5L, alias = "Camera", canWrite = true))
    dao.insert(row("sd", "1234-ABCD", "", addedAt = 6L, alias = "SDCARD", canWrite = false))
    dao.insert(row("gone", "9999-0000", "Photos", addedAt = 7L, alias = "Photos"))

    val (internal, sd, gone) = sources(operations.list())
    assertEquals("Camera", internal.getString("alias"))
    assertEquals("Internal shared storage", internal.getString("volumeLabel"))
    assertEquals("DCIM/Camera", internal.getString("displayPath"))
    assertFalse(internal.getBoolean("isRemovable"))
    assertTrue(internal.getBoolean("canWrite"))
    assertEquals(5.0, internal.getDouble("addedAtMillis"), 0.0)

    assertEquals("SDCARD", sd.getString("volumeLabel"))
    assertEquals("", sd.getString("displayPath"))
    assertTrue(sd.getBoolean("isRemovable"))
    assertFalse(sd.getBoolean("canWrite"))

    assertEquals("Removable storage", gone.getString("volumeLabel"))
    // treeUri and canonicalRoot never cross the bridge.
    for (dto in listOf(internal, sd, gone)) {
      assertFalse(dto.hasKey("treeUri"))
      assertFalse(dto.hasKey("canonicalRoot"))
    }
  }

  @Test
  fun listUsesOneGrantLookupAndAtMostOneRootQueryPerSource() = runBlocking {
    repeat(20) { i ->
      dao.insert(row("s$i", "primary", "Folder$i", addedAt = i.toLong()))
      if (i % 3 != 0) saf.hold(treeUri("primary:Folder$i"))
    }

    val result = operations.list()

    assertEquals(20, sources(result).size)
    assertEquals(1, saf.persistedGrantsCalls)
    assertTrue(saf.rootQueries.size <= 20)
    assertEquals(saf.rootQueries.size, saf.rootQueries.toSet().size)
  }

  // --- add ---

  @Test
  fun addPersistsANewSourceWithGeneratedIdAliasAndGrant() = runBlocking {
    val result = operations.onPicked(camera, regrantSourceId = null)

    assertEquals("ok", result.getString("status"))
    assertEquals("ADDED", result.getString("outcome"))
    val source = result.getMap("source")!!
    assertEquals("id-1", source.getString("sourceId"))
    assertEquals("Camera", source.getString("alias"))
    assertEquals("AVAILABLE", source.getString("availability"))
    assertEquals(listOf(camera), saf.taken)
    assertTrue(saf.grants.containsKey(camera))

    val stored = dao.byId("id-1")!!
    assertEquals(camera, stored.treeUri)
    assertEquals(SourceTree.EXTERNAL_STORAGE_AUTHORITY, stored.authority)
    assertEquals("primary", stored.volumeId)
    assertEquals("DCIM/Camera", stored.documentPath)
    assertEquals("com.android.externalstorage.documents/primary:DCIM/Camera", stored.canonicalRoot)
    assertTrue(stored.canWrite)
    assertEquals(1_000L, stored.addedAtMillis)
  }

  @Test
  fun addTakesCanWriteFromTheGrant() = runBlocking {
    saf.grantsWrite = false
    val result = operations.onPicked(camera, null)
    assertFalse(result.getMap("source")!!.getBoolean("canWrite"))
    assertFalse(dao.byId("id-1")!!.canWrite)
  }

  @Test
  fun addDisambiguatesTheAliasAgainstExistingSources() = runBlocking {
    operations.onPicked(camera, null)
    val second = operations.onPicked(sdCamera, null)
    assertEquals("Camera (SDCARD)", second.getMap("source")!!.getString("alias"))
  }

  @Test
  fun addFromAnotherProviderIsUnsupportedAndPersistsNothing() = runBlocking {
    val downloads = treeUri("downloads", authority = "com.android.providers.downloads.documents")

    val result = operations.onPicked(downloads, null)

    assertError("SOURCE_UNSUPPORTED", result)
    assertEquals(emptyList<SourceRootEntity>(), dao.all())
    assertEquals(listOf(downloads), saf.released)
  }

  @Test
  fun addOverlappingAnExistingSourceIsRejectedNamingTheFirstConflict() = runBlocking {
    dao.insert(row("music", "primary", "Music", addedAt = 1L, alias = "Music"))
    dao.insert(row("cam", "primary", "DCIM/Camera", addedAt = 2L, alias = "Camera"))
    dao.insert(row("shots", "primary", "DCIM/Screenshots", addedAt = 3L, alias = "Screenshots"))

    val result = operations.onPicked(dcim, null)

    assertError("SOURCE_OVERLAP", result)
    val conflict = result.getMap("error")!!.getMap("conflictingSource")!!
    assertEquals("cam", conflict.getString("sourceId"))
    assertEquals("Camera", conflict.getString("alias"))
    assertEquals(3, dao.all().size)
    assertEquals(listOf(dcim), saf.released)
  }

  @Test
  fun pickingAnExistingSourceAgainIsAnOverlapThatKeepsItsGrant() = runBlocking {
    operations.onPicked(camera, null)

    val result = operations.onPicked(camera, null)

    assertError("SOURCE_OVERLAP", result)
    assertEquals(1, dao.all().size)
    // The URI is the existing source's own grant: releasing it would revoke that source.
    assertTrue(saf.grants.containsKey(camera))
  }

  // --- re-grant ---

  @Test
  fun regrantTargetOfAnUnknownSourceIsNull() = runBlocking {
    assertNull(operations.regrantTarget("nope"))
    dao.insert(row("cam", "primary", "DCIM/Camera", addedAt = 1L))
    assertEquals(camera, operations.regrantTarget("cam"))
  }

  @Test
  fun regrantOfAnUnknownSourceIsNotFound() = runBlocking {
    val result = operations.onPicked(camera, regrantSourceId = "nope")
    assertError("SOURCE_NOT_FOUND", result)
    assertEquals(emptyList<SourceRootEntity>(), dao.all())
    assertEquals(listOf(camera), saf.released)
  }

  @Test
  fun regrantOfTheSameFolderRefreshesOnlyTreeUriAndCanWrite() = runBlocking {
    val original =
      row("cam", "primary", "DCIM/Camera", addedAt = 42L, alias = "Camera", canWrite = false)
        .copy(treeUri = "content://com.android.externalstorage.documents/tree/primary%3ADCIM%2FCamera%2F")
    dao.insert(original)

    val result = operations.onPicked(camera, regrantSourceId = "cam")

    assertEquals("ok", result.getString("status"))
    assertEquals("REGRANTED", result.getString("outcome"))
    val source = result.getMap("source")!!
    assertEquals("cam", source.getString("sourceId"))
    assertEquals("Camera", source.getString("alias"))
    assertEquals("AVAILABLE", source.getString("availability"))
    assertEquals(original.copy(treeUri = camera, canWrite = true), dao.byId("cam"))
    assertFalse(camera in saf.released)
  }

  @Test
  fun regrantOfADifferentFolderIsAMismatchAndLeavesTheRowUnchanged() = runBlocking {
    val original = row("cam", "primary", "DCIM/Camera", addedAt = 42L)
    dao.insert(original)

    val result = operations.onPicked(music, regrantSourceId = "cam")

    assertError("SOURCE_REGRANT_MISMATCH", result)
    assertEquals(original, dao.byId("cam"))
    assertEquals(listOf(music), saf.released)
  }

  @Test
  fun regrantOfAFolderOverlappingAnotherSourceIsStillAMismatch() = runBlocking {
    dao.insert(row("cam", "primary", "DCIM/Camera", addedAt = 1L, alias = "Camera"))
    dao.insert(row("music", "primary", "Music/Albums", addedAt = 2L, alias = "Albums"))

    // Music overlaps Music/Albums, but a re-grant never checks V2.
    val result = operations.onPicked(music, regrantSourceId = "cam")

    assertError("SOURCE_REGRANT_MISMATCH", result)
    assertFalse(result.getMap("error")!!.hasKey("conflictingSource"))
  }

  @Test
  fun regrantFromAnotherProviderIsUnsupported() = runBlocking {
    dao.insert(row("cam", "primary", "DCIM/Camera", addedAt = 1L))
    val other = treeUri("root", authority = "com.example.documents")

    assertError("SOURCE_UNSUPPORTED", operations.onPicked(other, regrantSourceId = "cam"))
    assertEquals(listOf(other), saf.released)
  }

  // --- remove ---

  @Test
  fun removeCascadesThenReleasesTheGrant() = runBlocking {
    operations.onPicked(camera, null)
    db.scanRunDao().insert(scanRun("run-1", 1L))
    db.snapshotDao().insert(stagingSnapshot("snap-1", "run-1"))
    db.localNodeDao().insertAll(listOf<LocalNodeEntity>(localNode("snap-1", "id-1", "e1", "a.jpg")))

    val result = operations.remove("id-1")

    assertEquals("ok", result.getString("status"))
    assertNull(dao.byId("id-1"))
    assertEquals(0L, db.localNodeDao().countFor("snap-1"))
    assertEquals(listOf(camera), saf.released)
    assertFalse(saf.grants.containsKey(camera))
  }

  @Test
  fun removeWorksWhenTheGrantIsAlreadyGone() = runBlocking {
    dao.insert(row("cam", "primary", "DCIM/Camera", addedAt = 1L))

    val result = operations.remove("cam")

    assertEquals("ok", result.getString("status"))
    assertNull(dao.byId("cam"))
  }

  @Test
  fun removeOfAnUnknownSourceIsNotFound() = runBlocking {
    assertError("SOURCE_NOT_FOUND", operations.remove("nope"))
    assertEquals(emptyList<String>(), saf.released)
  }

  @Test
  fun cancelledIsOkWithNullSource() {
    val result = operations.cancelled()
    assertEquals("ok", result.getString("status"))
    assertEquals("CANCELLED", result.getString("outcome"))
    assertTrue(result.isNull("source"))
  }

  // --- helpers ---

  private fun row(
    sourceId: String,
    volumeId: String,
    documentPath: String,
    addedAt: Long,
    alias: String = "Alias $sourceId",
    canWrite: Boolean = true,
  ): SourceRootEntity {
    val tree = SourceTree(SourceTree.EXTERNAL_STORAGE_AUTHORITY, volumeId, documentPath)
    return SourceRootEntity(
      sourceId = sourceId,
      treeUri = treeUri("$volumeId:$documentPath"),
      authority = tree.authority,
      volumeId = volumeId,
      documentPath = documentPath,
      canonicalRoot = tree.canonicalRoot,
      alias = alias,
      canWrite = canWrite,
      addedAtMillis = addedAt,
    )
  }

  private fun sources(result: ReadableMap): List<ReadableMap> {
    assertEquals("ok", result.getString("status"))
    val array = result.getArray("sources")!!
    return (0 until array.size()).map { array.getMap(it)!! }
  }

  private fun assertError(code: String, result: ReadableMap) {
    assertEquals("error", result.getString("status"))
    val error = result.getMap("error")!!
    assertEquals(code, error.getString("code"))
    assertNotEquals(null, error.getString("message"))
  }
}
