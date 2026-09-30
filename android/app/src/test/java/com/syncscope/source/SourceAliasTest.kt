package com.syncscope.source

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class SourceAliasTest {

  private val internal = "Internal shared storage"

  private fun candidate(documentPath: String, volumeLabel: String = internal, volumeId: String = "primary") =
    AliasCandidate(volumeId = volumeId, volumeLabel = volumeLabel, documentPath = documentPath)

  @Test
  fun folderNameWinsWhenUnique() {
    assertEquals("Camera", SourceAlias.generate(candidate("DCIM/Camera"), emptyList()))
    assertEquals("Screenshots", SourceAlias.generate(candidate("Pictures/Screenshots"), listOf("Camera")))
  }

  @Test
  fun volumeRootUsesVolumeLabel() {
    assertEquals("SDCARD", SourceAlias.generate(candidate("", "SDCARD", "1A2B-3C4D"), emptyList()))
  }

  @Test
  fun addsVolumeLabelOnCollision() {
    assertEquals(
      "Camera (SDCARD)",
      SourceAlias.generate(candidate("DCIM/Camera", "SDCARD", "1A2B-3C4D"), listOf("Camera")),
    )
  }

  @Test
  fun cameraOnPrimaryThenSdGetsDistinctAliases() {
    val first = SourceAlias.generate(candidate("DCIM/Camera"), emptyList())
    val second = SourceAlias.generate(candidate("DCIM/Camera", "SDCARD", "1A2B-3C4D"), listOf(first))

    assertEquals("Camera", first)
    assertEquals("Camera (SDCARD)", second)
  }

  @Test
  fun addsParentThenMoreSegmentsUntilUnique() {
    val existing = mutableListOf<String>()
    fun add(path: String): String = SourceAlias.generate(candidate(path), existing).also { existing += it }

    assertEquals("Camera", add("DCIM/Camera"))
    assertEquals("Camera ($internal)", add("Backup/Camera"))
    assertEquals("Camera ($internal, Old)", add("Old/Camera"))
    assertEquals("Camera ($internal, A/Old)", add("A/Old/Camera"))
    assertEquals("Camera ($internal, B/A/Old)", add("B/A/Old/Camera"))
  }

  @Test
  fun uniquenessIsCaseInsensitive() {
    assertEquals(
      "camera ($internal)",
      SourceAlias.generate(candidate("Other/camera"), listOf("Camera")),
    )
    assertEquals(
      "Camera ($internal, DCIM)",
      SourceAlias.generate(candidate("DCIM/Camera"), listOf("CAMERA", "camera (internal shared storage)")),
    )
  }

  @Test
  fun walkTerminatesForDistinctRootsEvenWhenEveryReadableFormIsTaken() {
    // Two removable volumes with the same label and the same path: only the volume differs.
    val existing = mutableListOf<String>()
    val roots = listOf(
      candidate("DCIM/Camera", "USB drive", "AAAA-0001"),
      candidate("DCIM/Camera", "USB drive", "BBBB-0002"),
      candidate("DCIM/Camera", "USB drive", "CCCC-0003"),
      candidate("", "USB drive", "DDDD-0004"),
      candidate("", "USB drive", "EEEE-0005"),
    )
    for (root in roots) {
      val alias = SourceAlias.generate(root, existing)
      assertFalse(alias, existing.any { it.equals(alias, ignoreCase = true) })
      existing += alias
    }
    assertEquals(roots.size, existing.map { it.lowercase() }.toSet().size)
  }

  @Test
  fun manyDistinctRootsAllGetUniqueAliases() {
    val existing = mutableListOf<String>()
    val paths = listOf("", "DCIM", "DCIM/Camera", "A/Camera", "B/Camera", "A/B/Camera", "B/B/Camera", "Camera")
    for (volume in listOf("primary" to internal, "1A2B-3C4D" to "SDCARD")) {
      for (path in paths) {
        val alias = SourceAlias.generate(candidate(path, volume.second, volume.first), existing)
        assertFalse(alias, existing.any { it.equals(alias, ignoreCase = true) })
        existing += alias
      }
    }
  }
}
