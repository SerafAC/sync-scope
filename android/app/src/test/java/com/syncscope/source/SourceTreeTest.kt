package com.syncscope.source

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class SourceTreeTest {

  private val ext = SourceTree.EXTERNAL_STORAGE_AUTHORITY

  private fun tree(documentId: String, authority: String = ext) = SourceTree.parse(authority, documentId)

  @Test
  fun parsesVolumeIdAndDocumentPath() {
    val t = tree("primary:DCIM/Camera")

    assertEquals(ext, t.authority)
    assertEquals("primary", t.volumeId)
    assertEquals("DCIM/Camera", t.documentPath)
  }

  @Test
  fun trimsTrailingAndLeadingSlashes() {
    assertEquals("DCIM/Camera", tree("primary:DCIM/Camera/").documentPath)
    assertEquals("DCIM/Camera", tree("primary:DCIM/Camera//").documentPath)
    assertEquals("DCIM/Camera", tree("primary:/DCIM/Camera").documentPath)
  }

  @Test
  fun volumeRootHasEmptyDocumentPath() {
    val root = tree("1A2B-3C4D:")

    assertEquals("1A2B-3C4D", root.volumeId)
    assertEquals("", root.documentPath)
    assertTrue(root.isVolumeRoot)
    assertEquals("", tree("primary:/").documentPath)
    assertFalse(tree("primary:DCIM").isVolumeRoot)
  }

  @Test
  fun canonicalRootIsAuthorityVolumeAndPath() {
    assertEquals("$ext/primary:DCIM/Camera", tree("primary:DCIM/Camera/").canonicalRoot)
    assertEquals("$ext/1A2B-3C4D:", tree("1A2B-3C4D:").canonicalRoot)
  }

  @Test
  fun keepsCaseAsReturned() {
    val t = tree("primary:DCIM/Camera")
    val lower = tree("primary:dcim/camera")

    assertEquals("DCIM/Camera", t.documentPath)
    assertEquals("dcim/camera", lower.documentPath)
    assertFalse(t.canonicalRoot == lower.canonicalRoot)
    assertFalse(SourceTree.overlaps(t, lower))
  }

  @Test
  fun equalPathsOverlap() {
    assertTrue(SourceTree.overlaps(tree("primary:DCIM/Camera"), tree("primary:DCIM/Camera/")))
  }

  @Test
  fun parentAndChildOverlapInBothDirections() {
    val parent = tree("primary:DCIM")
    val child = tree("primary:DCIM/Camera")

    assertTrue(SourceTree.overlaps(parent, child))
    assertTrue(SourceTree.overlaps(child, parent))
    assertTrue(SourceTree.overlaps(parent, tree("primary:DCIM/Camera/Nested")))
  }

  @Test
  fun prefixWithoutSlashBoundaryDoesNotOverlap() {
    assertFalse(SourceTree.overlaps(tree("primary:DCIM"), tree("primary:DCIM2")))
    assertFalse(SourceTree.overlaps(tree("primary:DCIM2"), tree("primary:DCIM")))
    assertFalse(SourceTree.overlaps(tree("primary:DCIM/Cam"), tree("primary:DCIM/Camera")))
  }

  @Test
  fun volumeRootOverlapsEveryPathOnItsVolume() {
    val root = tree("primary:")

    assertTrue(SourceTree.overlaps(root, tree("primary:DCIM")))
    assertTrue(SourceTree.overlaps(tree("primary:Pictures/Screenshots"), root))
    assertTrue(SourceTree.overlaps(root, tree("primary:")))
  }

  @Test
  fun differentVolumesNeverOverlap() {
    assertFalse(SourceTree.overlaps(tree("primary:DCIM/Camera"), tree("1A2B-3C4D:DCIM/Camera")))
    assertFalse(SourceTree.overlaps(tree("primary:"), tree("1A2B-3C4D:DCIM")))
    assertFalse(SourceTree.overlaps(tree("primary:"), tree("1A2B-3C4D:")))
  }

  @Test
  fun differentAuthoritiesNeverOverlap() {
    assertFalse(
      SourceTree.overlaps(tree("primary:DCIM"), tree("primary:DCIM", authority = "com.example.docs")),
    )
  }

  @Test
  fun onlyExternalStorageAuthorityIsSupported() {
    assertTrue(SourceTree.isSupportedAuthority("com.android.externalstorage.documents"))
    assertFalse(SourceTree.isSupportedAuthority("com.android.providers.downloads.documents"))
    assertFalse(SourceTree.isSupportedAuthority("com.google.android.apps.docs.storage"))
    assertFalse(SourceTree.isSupportedAuthority(""))
    assertTrue(tree("primary:DCIM").isSupported)
    assertFalse(tree("primary:DCIM", authority = "com.android.providers.media.documents").isSupported)
  }

  @Test
  fun rejectsDocumentIdWithoutVolumeSeparator() {
    assertThrows(IllegalArgumentException::class.java) { tree("DCIM/Camera") }
    assertThrows(IllegalArgumentException::class.java) { tree(":DCIM") }
  }
}
